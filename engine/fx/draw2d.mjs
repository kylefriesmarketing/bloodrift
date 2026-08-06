// Shared Canvas2D primitives for the art layer. Pure drawing helpers — no state.

export function rr(cx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  const rad = Math.min(r, w / 2, h / 2);
  cx.beginPath();
  cx.moveTo(x + rad, y);
  cx.arcTo(x + w, y, x + w, y + h, rad);
  cx.arcTo(x + w, y + h, x, y + h, rad);
  cx.arcTo(x, y + h, x, y, rad);
  cx.arcTo(x, y, x + w, y, rad);
  cx.closePath();
  cx.fill();
}

export function rrs(cx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  const rad = Math.min(r, w / 2, h / 2);
  cx.beginPath();
  cx.moveTo(x + rad, y);
  cx.arcTo(x + w, y, x + w, y + h, rad);
  cx.arcTo(x + w, y + h, x, y + h, rad);
  cx.arcTo(x, y + h, x, y, rad);
  cx.arcTo(x, y, x + w, y, rad);
  cx.closePath();
  cx.fill();
  cx.stroke();
}

// two-segment limb as a lit cylinder: outline → tube → top-lit core → underside shadow
export function limb(cx, x1, y1, x2, y2, x3, y3, w, col, outlineCol) {
  cx.lineCap = 'round';
  cx.lineJoin = 'round';
  cx.strokeStyle = outlineCol;
  cx.lineWidth = w + 4;
  cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.lineTo(x3, y3); cx.stroke();
  cx.strokeStyle = col;
  cx.lineWidth = w;
  cx.beginPath(); cx.moveTo(x1, y1); cx.lineTo(x2, y2); cx.lineTo(x3, y3); cx.stroke();
  cx.strokeStyle = shadeCss(col, 26);
  cx.lineWidth = Math.max(2, w * 0.4);
  cx.beginPath();
  cx.moveTo(x1 - w * 0.16, y1 - w * 0.18);
  cx.lineTo(x2 - w * 0.16, y2 - w * 0.18);
  cx.lineTo(x3 - w * 0.16, y3 - w * 0.18);
  cx.stroke();
  cx.strokeStyle = 'rgba(0,0,0,0.24)';
  cx.lineWidth = Math.max(1.5, w * 0.28);
  cx.beginPath();
  cx.moveTo(x1 + w * 0.24, y1 + w * 0.22);
  cx.lineTo(x2 + w * 0.24, y2 + w * 0.22);
  cx.lineTo(x3 + w * 0.24, y3 + w * 0.22);
  cx.stroke();
  cx.lineCap = 'butt';
  cx.lineJoin = 'miter';
}

// a lit sphere (joints, heads, pauldrons)
export function ball(cx, x, y, r, col, outlineCol, lightX = -0.35, lightY = -0.4) {
  const g = cx.createRadialGradient(x + r * lightX, y + r * lightY, r * 0.08, x, y, r * 1.12);
  g.addColorStop(0, shade(col, 38));
  g.addColorStop(0.55, col);
  g.addColorStop(1, shade(col, -48));
  cx.fillStyle = g;
  cx.beginPath();
  cx.arc(x, y, r, 0, Math.PI * 2);
  cx.fill();
  if (outlineCol) {
    cx.strokeStyle = outlineCol;
    cx.lineWidth = Math.max(1.5, r * 0.16);
    cx.stroke();
  }
}

export function shade(hex, amt) {
  if (!hex || hex[0] !== '#') return shadeCss(hex, amt);
  const n = parseInt(hex.slice(1), 16);
  const c = v => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 0xff)},${c(n & 0xff)})`;
}

export function shadeCss(col, amt) {
  if (typeof col !== 'string') return col;
  if (col[0] === '#') return shade(col, amt);
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(col);
  if (!m) return col;
  const c = v => Math.max(0, Math.min(255, +v + amt));
  return m[4] !== undefined
    ? `rgba(${c(m[1])},${c(m[2])},${c(m[3])},${m[4]})`
    : `rgb(${c(m[1])},${c(m[2])},${c(m[3])})`;
}

export function withAlpha(col, a) {
  if (typeof col !== 'string') return col;
  if (col[0] === '#') {
    const n = parseInt(col.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 0xff},${n & 0xff},${a})`;
  }
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(col);
  return m ? `rgba(${m[1]},${m[2]},${m[3]},${a})` : col;
}
