// ボードのタイムラプス: 描いた順に線を少しずつ描き直す
// 普通の速さ (1点あたり NATURAL_MS_PER_POINT) で30秒を超える量なら、全体が30秒になるよう倍速にする。
// 少ししか描いていない時は引き伸ばさず普通の速さ (ただし最短 MIN_DURATION_MS)。

export interface BoardStroke {
  id: number;
  color: string;
  width: number;
  points: { x: number; y: number }[];
  created_at?: string;
}

export interface BoardText {
  id: number;
  x: number;
  y: number;
  text: string;
  created_at?: string;
}

export const BOARD_TEXT_FONT = '18px "JetBrains Mono", monospace';
const TARGET_DURATION_MS = 30000;
const MIN_DURATION_MS = 2000;
const NATURAL_MS_PER_POINT = 8;
const TEXT_WEIGHT = 20; // 付箋1つを何点分の時間で出すか

type Item = { kind: 'stroke'; s: BoardStroke; weight: number } | { kind: 'text'; t: BoardText; weight: number };

export function drawStroke(ctx: CanvasRenderingContext2D, s: BoardStroke, from = 1, to = s.points.length) {
  if (!s.points || s.points.length < 2 || to <= from) return;
  ctx.save();
  if (s.color === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = s.width || 9;
  } else {
    ctx.strokeStyle = s.color || '#f59e0b';
    ctx.lineWidth = s.width || 3;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.points[from - 1].x, s.points[from - 1].y);
  for (let i = from; i < to; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
  ctx.stroke();
  ctx.restore();
}

export function drawText(ctx: CanvasRenderingContext2D, t: BoardText) {
  ctx.font = BOARD_TEXT_FONT;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(t.text, t.x, t.y);
}

const timeOf = (v: { created_at?: string; id: number }) => (v.created_at ? Date.parse(v.created_at) : 0) || 0;

// 描いた順 (作成時刻、同じなら ID 順) に並べる
function buildTimeline(strokes: BoardStroke[], texts: BoardText[]): Item[] {
  const items: (Item & { at: number; id: number })[] = [
    ...strokes.filter(s => s.points?.length >= 2).map(s => ({ kind: 'stroke' as const, s, weight: s.points.length, at: timeOf(s), id: s.id })),
    ...texts.map(t => ({ kind: 'text' as const, t, weight: TEXT_WEIGHT, at: timeOf(t), id: t.id })),
  ];
  return items.sort((a, b) => a.at - b.at || a.id - b.id);
}

export function timelapsePlan(strokes: BoardStroke[], texts: BoardText[]) {
  const items = buildTimeline(strokes, texts);
  const total = items.reduce((a, b) => a + b.weight, 0);
  const natural = total * NATURAL_MS_PER_POINT;
  const duration = natural > TARGET_DURATION_MS ? TARGET_DURATION_MS : Math.max(natural, MIN_DURATION_MS);
  return { items, total, duration, speed: natural / duration };
}

// 再生を始め、止める関数を返す
export function playTimelapse(
  canvas: HTMLCanvasElement,
  strokes: BoardStroke[],
  texts: BoardText[],
  cb: { onProgress: (ratio: number) => void; onDone: () => void }
): () => void {
  const ctx = canvas.getContext('2d');
  const { items, total, duration } = timelapsePlan(strokes, texts);
  if (!ctx || total === 0) {
    cb.onDone();
    return () => {};
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  let itemIdx = 0;
  let pointIdx = 1; // 描き終えた点 (ストローク内)
  let drawnWeight = 0; // 描き終えた分
  let raf = 0;
  let stopped = false;
  const start = performance.now();

  const step = (now: number) => {
    if (stopped) return;
    const target = Math.min(total, (total * (now - start)) / duration);
    while (itemIdx < items.length && drawnWeight < target) {
      const it = items[itemIdx];
      if (it.kind === 'text') {
        drawText(ctx, it.t);
        drawnWeight += it.weight;
        itemIdx++;
        continue;
      }
      const pts = it.s.points.length;
      const want = Math.min(pts, pointIdx + Math.ceil(target - drawnWeight));
      drawStroke(ctx, it.s, pointIdx, want);
      drawnWeight += want - pointIdx;
      pointIdx = want;
      if (pointIdx >= pts) {
        // ストロークの重みは点の数なので、最初の1点ぶんを足して揃える
        drawnWeight += 1;
        itemIdx++;
        pointIdx = 1;
      }
    }
    cb.onProgress(Math.min(1, (now - start) / duration));
    if (itemIdx >= items.length) {
      cb.onDone();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
