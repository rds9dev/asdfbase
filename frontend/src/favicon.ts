// タブのアイコンにメンション数のバッジを描く
let baseImage: HTMLImageElement | null = null;
let lastCount = -1;

function getLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

function draw(count: number) {
  const link = getLink();
  if (count <= 0) {
    link.type = 'image/svg+xml';
    link.href = '/favicon.svg';
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx || !baseImage) return;
  ctx.drawImage(baseImage, 0, 0, 64, 64);
  const label = count > 99 ? '99+' : String(count);
  const w = label.length >= 3 ? 44 : label.length === 2 ? 38 : 34;
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.roundRect(64 - w, 0, w, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${label.length >= 3 ? 20 : 26}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64 - w / 2, 18);
  link.type = 'image/png';
  link.href = canvas.toDataURL('image/png');
}

export function setFaviconBadge(count: number) {
  if (count === lastCount) return;
  lastCount = count;
  if (count > 0 && !baseImage) {
    const img = new Image();
    img.onload = () => {
      baseImage = img;
      draw(lastCount);
    };
    img.src = '/favicon.svg';
    return;
  }
  draw(count);
}
