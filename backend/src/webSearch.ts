// AI 用の Web 検索とページ読み取り (Gemini の検索機能は無料枠が少ないので外部の検索 API を使う)
// 優先順: Tavily (TAVILY_API_KEY) → Brave Search (BRAVE_SEARCH_API_KEY) → DuckDuckGo (キー不要) → Wikipedia
import dns from 'dns';
import net from 'net';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 asdfbase-ai';

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function searchTavily(query: string, limit: number, key: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    // 日本のサイトを優先 (country は topic: general の時に効く)
    body: JSON.stringify({ query, max_results: limit, search_depth: 'basic', topic: 'general', country: 'japan' }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.results || []).map((r: any) => ({ title: String(r.title || ''), url: String(r.url || ''), snippet: String(r.content || '').slice(0, 600) }));
}

async function searchBrave(query: string, limit: number, key: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query, count: String(limit), search_lang: 'jp', country: 'JP' });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.web?.results || []).map((r: any) => ({ title: stripTags(String(r.title || '')), url: String(r.url || ''), snippet: stripTags(String(r.description || '')) }));
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Accept-Language': 'ja,en;q=0.8' },
    body: new URLSearchParams({ q: query, kl: 'jp-jp' }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const html = await res.text();
  // サーバーからのアクセスはボット判定されることがある (202 + anomaly ページ)
  if (res.status === 202 || /anomaly/i.test(html.slice(0, 5000))) throw new Error('DuckDuckGo: ボット判定で拒否されました');
  const results: SearchResult[] = [];
  for (const block of html.split(/<div class="result results_links/).slice(1)) {
    if (/result--ad/.test(block.slice(0, 200))) continue;
    const a = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = decodeEntities(a[1]);
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith('//')) url = `https:${url}`;
    const snip = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    results.push({ title: stripTags(a[2]), url, snippet: snip ? stripTags(snip[1]) : '' });
    if (results.length >= limit) break;
  }
  if (results.length === 0) throw new Error('DuckDuckGo: 結果を読み取れませんでした');
  return results;
}

async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), format: 'json', utf8: '1' });
  const res = await fetch(`https://ja.wikipedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data: any = await res.json();
  return (data.query?.search || []).map((r: any) => ({
    title: String(r.title),
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, '_'))}`,
    snippet: stripTags(String(r.snippet || '')),
  }));
}

export async function webSearch(query: string, limit = 6): Promise<{ provider: string; results: SearchResult[] }> {
  const providers: { name: string; run: () => Promise<SearchResult[]> }[] = [];
  const tavily = process.env.TAVILY_API_KEY?.trim();
  const brave = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (tavily) providers.push({ name: 'Tavily', run: () => searchTavily(query, limit, tavily) });
  if (brave) providers.push({ name: 'Brave Search', run: () => searchBrave(query, limit, brave) });
  providers.push({ name: 'DuckDuckGo', run: () => searchDuckDuckGo(query, limit) });
  providers.push({ name: 'Wikipedia', run: () => searchWikipedia(query, limit) });

  const errors: string[] = [];
  for (const p of providers) {
    try {
      const results = (await p.run()).filter(r => /^https?:\/\//.test(r.url)).slice(0, limit);
      if (results.length > 0) return { provider: p.name, results };
      errors.push(`${p.name}: 0件`);
    } catch (err: any) {
      errors.push(`${p.name}: ${err.message}`);
    }
  }
  throw new Error(`検索に失敗しました (${errors.join(' / ')})`);
}

// ---------------- ページ読み取り ----------------
// サーバー内部やLAN (127.0.0.1 の DB/API など) を読ませないよう、接続先のIPを確認してから取得する
function isPrivateAddress(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('URL が正しくありません');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('http / https の URL だけ読めます');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('このポートは読めません');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some(a => isPrivateAddress(a.address))) throw new Error('このアドレスは読めません');
  return url;
}

function decodeBody(buf: ArrayBuffer, contentType: string) {
  const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
  const charset = (contentType.match(/charset=([\w-]+)/i)?.[1] || head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function htmlToText(html: string) {
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const main = html.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] || html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const text = decodeEntities(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return { title, text };
}

const MAX_PAGE_BYTES = 2 * 1024 * 1024;

export async function readWebPage(raw: string, maxChars = 8000): Promise<{ url: string; title: string; text: string; truncated: boolean }> {
  let url = await assertPublicUrl(raw);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'Accept-Language': 'ja,en;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = await assertPublicUrl(new URL(loc, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`ページを取得できませんでした (HTTP ${res?.status ?? '?'})`);
  const type = res.headers.get('content-type') || '';
  if (!/text\/|html|xml|json/.test(type)) throw new Error(`テキストではないページです (${type || '不明'})`);
  if (Number(res.headers.get('content-length') || 0) > MAX_PAGE_BYTES) throw new Error('ページが大きすぎます');
  const buf = await res.arrayBuffer();
  const body = decodeBody(buf.byteLength > MAX_PAGE_BYTES ? buf.slice(0, MAX_PAGE_BYTES) : buf, type);
  const { title, text } = /html|xml/.test(type) ? htmlToText(body) : { title: '', text: body };
  return { url: url.toString(), title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}
