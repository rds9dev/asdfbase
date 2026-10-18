// Realtime client: WebSocket / SSE / Long-polling / Polling を同じインターフェースで扱う。
// サーバーは全イベントに連番(seq)を振っているので、どのトランスポートでも
// after=lastSeq で取りこぼしなく追いつける。重複は seq で排除する。
import { getApiBaseUrl, getWsUrl, type RealtimeTransport } from './config';

export type ConcreteTransport = Exclude<RealtimeTransport, 'auto'>;
export type RealtimeStatus = 'connecting' | 'online' | 'reconnecting' | 'offline';

export interface RealtimeOptions {
  token: string;
  transport: RealtimeTransport;
  pollInterval: number;
  onEvent: (msg: any) => void;
  onStatus: (status: RealtimeStatus, transport: ConcreteTransport | null) => void;
  // サーバー再起動・バッファ切れでイベント列が途切れた時 (アプリ側で全再取得する)
  onReset: () => void;
}

const AUTO_ORDER: ConcreteTransport[] = ['ws', 'sse', 'longpoll', 'poll'];
const LAST_GOOD_KEY = 'asdf_rt_last_good';
const READY_TIMEOUT_MS = 5000;
const STALE_TIMEOUT_MS = 40000;

function makeConnId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class RealtimeClient {
  readonly connId = makeConnId();
  private opts: RealtimeOptions;
  private stopped = false;
  private lastSeq = 0;
  private boot = '';
  private seen = new Set<number>();

  private current: ConcreteTransport | null = null;
  private ready = false;
  private failStreak = 0;
  private generation = 0; // 古いトランスポートのコールバックを無効化するため

  private ws: WebSocket | null = null;
  private es: EventSource | null = null;
  private abort: AbortController | null = null;
  private timers: any[] = [];
  private lastActivity = Date.now();
  private safetyTimer: any = null;
  private probeTimer: any = null;

  constructor(opts: RealtimeOptions) {
    this.opts = opts;
  }

  get transport() {
    return this.current;
  }

  start() {
    this.stopped = false;
    let first: ConcreteTransport;
    if (this.opts.transport !== 'auto') {
      first = this.opts.transport;
    } else {
      let lastGood: string | null = null;
      try {
        lastGood = localStorage.getItem(LAST_GOOD_KEY);
      } catch (_) {}
      first = AUTO_ORDER.includes(lastGood as ConcreteTransport) ? (lastGood as ConcreteTransport) : 'ws';
    }
    this.connect(first);
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibility);
    // ws/sse 使用中でも30秒ごとに取りこぼし確認 (seqで重複排除されるので安全)
    this.safetyTimer = setInterval(() => {
      if (this.ready && (this.current === 'ws' || this.current === 'sse')) this.catchUp();
    }, 30000);
  }

  stop() {
    this.stopped = true;
    this.teardown();
    clearInterval(this.safetyTimer);
    clearTimeout(this.probeTimer);
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibility);
  }

  // 即座に取りこぼしを確認
  async catchUp() {
    try {
      const data = await this.fetchPoll(0, 10000);
      this.handlePollResult(data);
    } catch (_) {}
  }

  async send(msg: object): Promise<void> {
    if (this.current === 'ws' && this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return;
    }
    await fetch(`${getApiBaseUrl()}/api/rt/send?connId=${encodeURIComponent(this.connId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.opts.token}` },
      body: JSON.stringify(msg),
    });
  }

  // ---------------------------------------------------------------------------

  private handleOnline = () => {
    if (!this.stopped) this.reconnect(true);
  };

  private handleOffline = () => {
    this.opts.onStatus('offline', this.current);
  };

  private handleVisibility = () => {
    if (document.hidden || this.stopped) return;
    if (!this.ready) this.reconnect(true);
    else this.catchUp();
  };

  private setTimer(fn: () => void, ms: number) {
    const t = setTimeout(fn, ms);
    this.timers.push(t);
    return t;
  }

  private teardown() {
    this.generation++;
    this.timers.forEach(t => {
      clearTimeout(t);
      clearInterval(t);
    });
    this.timers = [];
    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null;
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.ready = false;
  }

  private connect(t: ConcreteTransport) {
    if (this.stopped) return;
    this.teardown();
    this.current = t;
    this.opts.onStatus(this.failStreak === 0 && this.lastSeq === 0 ? 'connecting' : 'reconnecting', t);
    const gen = this.generation;
    if (t === 'ws') this.connectWs(gen);
    else if (t === 'sse') this.connectSse(gen);
    else if (t === 'longpoll') this.loopPoll(gen, true);
    else this.loopPoll(gen, false);
  }

  private markReady(gen: number) {
    if (gen !== this.generation) return;
    if (!this.ready) {
      this.ready = true;
      this.failStreak = 0;
      this.opts.onStatus('online', this.current);
      if (this.opts.transport === 'auto' && this.current) {
        try {
          localStorage.setItem(LAST_GOOD_KEY, this.current);
        } catch (_) {}
        // 下位トランスポートで動作中なら、裏で WebSocket が使えるか時々確認
        if (this.current !== 'ws') this.scheduleWsProbe();
      }
    }
  }

  // 失敗時: 一度も ready にならずに失敗したら(auto時)次のトランスポートへ
  private fail(gen: number) {
    if (gen !== this.generation || this.stopped) return;
    const wasReady = this.ready;
    this.teardown();
    this.failStreak++;
    let next: ConcreteTransport = this.current || 'ws';
    if (this.opts.transport === 'auto' && (!wasReady || this.failStreak >= 2)) {
      const idx = AUTO_ORDER.indexOf(next);
      if (idx < AUTO_ORDER.length - 1) {
        next = AUTO_ORDER[idx + 1];
        this.failStreak = 0;
      }
    }
    const delay = wasReady ? 300 : Math.min(500 * 2 ** Math.min(this.failStreak, 4), 8000);
    this.opts.onStatus('reconnecting', next);
    this.current = next;
    this.setTimer(() => this.connect(next), delay);
  }

  private reconnect(immediate: boolean) {
    const t = this.current || 'ws';
    this.teardown();
    this.setTimer(() => this.connect(t), immediate ? 0 : 1000);
  }

  private scheduleWsProbe() {
    clearTimeout(this.probeTimer);
    this.probeTimer = setTimeout(() => this.probeWs(), 120000);
  }

  // 別ソケットで WS の疎通だけ確認し、通れば WS へ切り替える
  private probeWs() {
    if (this.stopped || this.opts.transport !== 'auto' || this.current === 'ws') return;
    let done = false;
    let ws: WebSocket;
    try {
      ws = new WebSocket(getWsUrl());
    } catch (_) {
      this.scheduleWsProbe();
      return;
    }
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try { ws.close(); } catch (_) {}
      if (ok && !this.stopped) this.connect('ws');
      else this.scheduleWsProbe();
    };
    const timer = setTimeout(() => finish(false), READY_TIMEOUT_MS);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'PING', t: Date.now() }));
    ws.onmessage = ev => {
      try {
        if (JSON.parse(ev.data).type === 'PONG') {
          clearTimeout(timer);
          finish(true);
        }
      } catch (_) {}
    };
    ws.onerror = ws.onclose = () => {
      clearTimeout(timer);
      finish(false);
    };
  }

  private dispatch(msg: any) {
    if (!msg || typeof msg !== 'object') return;
    if (typeof msg.seq === 'number') {
      if (this.seen.has(msg.seq)) return;
      this.seen.add(msg.seq);
      if (this.seen.size > 5000) {
        // 古いものから間引く
        const arr = Array.from(this.seen).sort((a, b) => a - b).slice(-2500);
        this.seen = new Set(arr);
      }
      if (msg.seq > this.lastSeq) this.lastSeq = msg.seq;
    }
    try {
      this.opts.onEvent(msg);
    } catch (err) {
      console.error('Realtime event handler error:', err);
    }
  }

  private applyServerState(boot: string, seq: number, reset: boolean) {
    const bootChanged = Boolean(this.boot && boot && boot !== this.boot);
    if (boot) this.boot = boot;
    if (reset || bootChanged) {
      this.lastSeq = seq;
      this.seen.clear();
      this.opts.onReset();
    } else if (this.lastSeq === 0) {
      // 初回: 現在位置から購読開始 (初期データはREST APIで取得済み)
      this.lastSeq = seq;
    }
  }

  // ---------------- WebSocket ----------------
  private connectWs(gen: number) {
    let ws: WebSocket;
    try {
      ws = new WebSocket(getWsUrl());
    } catch (_) {
      this.fail(gen);
      return;
    }
    this.ws = ws;
    this.lastActivity = Date.now();
    this.setTimer(() => {
      if (!this.ready) this.fail(gen);
    }, READY_TIMEOUT_MS);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'AUTH', token: this.opts.token, connId: this.connId, after: this.lastSeq, boot: this.boot }));
    };
    ws.onmessage = event => {
      if (gen !== this.generation) return;
      this.lastActivity = Date.now();
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }
      if (msg.type === 'PONG') return;
      if (msg.type === 'AUTH_OK') {
        const p = msg.payload || {};
        this.applyServerState(p.boot, p.seq, p.reset);
        this.markReady(gen);
        return;
      }
      if (msg.type === 'AUTH_ERROR') return;
      this.dispatch(msg);
    };
    ws.onclose = () => this.fail(gen);
    ws.onerror = () => {
      try { ws.close(); } catch (_) {}
    };

    const hb = setInterval(() => {
      if (gen !== this.generation || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastActivity > STALE_TIMEOUT_MS) {
        this.fail(gen);
        return;
      }
      ws.send(JSON.stringify({ type: 'PING', t: Date.now() }));
    }, 15000);
    this.timers.push(hb);
  }

  // ---------------- Server-Sent Events ----------------
  private connectSse(gen: number) {
    if (typeof EventSource === 'undefined') {
      this.fail(gen);
      return;
    }
    const params = new URLSearchParams({
      token: this.opts.token,
      connId: this.connId,
      after: String(this.lastSeq),
      boot: this.boot,
    });
    const es = new EventSource(`${getApiBaseUrl()}/api/rt/stream?${params.toString()}`);
    this.es = es;
    this.lastActivity = Date.now();
    this.setTimer(() => {
      if (!this.ready) this.fail(gen);
    }, READY_TIMEOUT_MS);

    const touch = () => {
      this.lastActivity = Date.now();
    };
    es.addEventListener('hello', (ev: MessageEvent) => {
      if (gen !== this.generation) return;
      touch();
      try {
        const p = JSON.parse(ev.data);
        this.applyServerState(p.boot, p.seq, false);
      } catch (_) {}
      this.markReady(gen);
    });
    es.addEventListener('reset', (ev: MessageEvent) => {
      if (gen !== this.generation) return;
      touch();
      try {
        const p = JSON.parse(ev.data);
        this.applyServerState(p.boot, p.seq, true);
      } catch (_) {}
    });
    es.addEventListener('ping', touch);
    es.onmessage = ev => {
      if (gen !== this.generation) return;
      touch();
      try {
        this.dispatch(JSON.parse(ev.data));
      } catch (_) {}
    };
    // EventSource の自動再接続は after が古いままなので使わず、自前で張り直す
    es.onerror = () => this.fail(gen);

    const watchdog = setInterval(() => {
      if (gen !== this.generation) return;
      if (Date.now() - this.lastActivity > STALE_TIMEOUT_MS) this.fail(gen);
    }, 10000);
    this.timers.push(watchdog);
  }

  // ---------------- Long-poll / Poll ----------------
  private async fetchPoll(wait: number, timeoutMs: number, signal?: AbortSignal) {
    const params = new URLSearchParams({
      after: String(this.lastSeq),
      boot: this.boot,
      wait: String(wait),
      connId: this.connId,
    });
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/rt/poll?${params.toString()}`, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private handlePollResult(data: any) {
    if (!data) return;
    this.applyServerState(data.boot, data.seq, data.reset);
    if (!data.reset && Array.isArray(data.events)) {
      for (const ev of data.events) this.dispatch(ev);
    }
  }

  private async loopPoll(gen: number, long: boolean) {
    const ctrl = new AbortController();
    this.abort = ctrl;
    let errors = 0;
    while (gen === this.generation && !this.stopped) {
      const started = Date.now();
      try {
        const data = await this.fetchPoll(long ? 20 : 0, long ? 30000 : 10000, ctrl.signal);
        if (gen !== this.generation) return;
        this.handlePollResult(data);
        this.markReady(gen);
        errors = 0;
      } catch (_) {
        if (gen !== this.generation) return;
        errors++;
        if (!this.ready || errors >= 3) {
          this.fail(gen);
          return;
        }
      }
      // ロングポーリングは即次へ、ポーリングは設定間隔で
      const wait = long ? (errors > 0 ? 1000 : 0) : Math.max(0, this.opts.pollInterval - (Date.now() - started));
      if (document.hidden && !long) {
        // 非表示タブは負荷軽減のため間隔を延ばす
        await new Promise(r => this.setTimer(() => r(null), Math.max(wait, 5000)));
      } else if (wait > 0) {
        await new Promise(r => this.setTimer(() => r(null), wait));
      }
    }
  }
}
