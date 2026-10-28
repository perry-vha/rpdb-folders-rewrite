// Draws badge plates and flag badges in RPDB's layout. Usage: node tools/make-icons.js [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { BADGES } from './badge-manifest.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'static', 'icons');
const FONT = 'BadgeArimo';
GlobalFonts.registerFromPath(path.join(root, 'static', 'fonts', 'Arimo-Bold.ttf'), FONT);
GlobalFonts.registerFromPath(path.join(root, 'static', 'fonts', 'Arimo-Regular.ttf'), FONT);

// 1x layout measured from RPDB posters: plate 120x82; panel has rounded top corners and a square bottom.
const S = 2, W = 120, H = 82, R = 10;
const PANEL = { x: 8, y: 7, w: 104, h: 51, r: 6 };
const OUTLINE = 2.2, CAP_THIN = 0.22;
// Plate colours, main-text fills and caption inks measured from RPDB posters.
const TIER = {
  g: { plate: '#fccc44', text: '#f2ce5e', cap: '#2e2408' },
  s: { plate: '#cecece', text: '#d4d4d4', cap: '#333333' },
  b: { plate: '#cc8031', text: '#d28a45', cap: '#35200a' },
  m: { plate: null, text: '#eef27a', cap: '#222222' },
};
const FLAT_TEXT = '#e2eb62';
// Fallback multicolor gradient (crimson, yellow-green, blue) for tags without measured stops.
const MULTI = [[0, '#ac2043'], [0.12, '#ac2043'], [0.32, '#d8a549'], [0.5, '#d8e243'], [0.68, '#9ccc69'], [0.9, '#2079b5'], [1, '#2075ae']];
// Gradient stops and content boxes measured by tools/measure-badges.mjs.
const { plates: PLATES, boxes: BOXES } = JSON.parse(fs.readFileSync(path.join(root, 'tools', 'badge-metrics.json'), 'utf8'));
const DEFAULT_BOX = { main: [14, 15, 92, 36], cap: [10, 65, 100, 10] };
const scale = (hex, k) => `rgb(${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).join(',')})`;
let ink = '#222222';
let curTag = '';

// Logos are trademarks of their owners: Dolby (simple-icons, CC0), Criterion (Wikimedia Commons, PD-textlogo),
// Masters of Cinema (our recreation, tools/logos/masters-of-cinema.svg).
async function svgImage(file, viewBox) {
  let svg = fs.readFileSync(file, 'utf8');
  if (viewBox) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  const [, , vw, vh] = svg.match(/viewBox="([^"]*)"/)[1].split(/[\s,]+/).map(Number);
  return loadImage(Buffer.from(svg.replace(/<svg /, `<svg width="${(vw / vh) * 400}" height="400" `)));
}
const LOGOS = {
  dolby: await svgImage(path.join(root, 'tools', 'logos', 'dolby.svg'), '0 3.564 24 16.872'),
  criterion: await svgImage(path.join(root, 'tools', 'logos', 'criterion.svg'), '406.64 229.96 34.85 34.85'),
  moc: await svgImage(path.join(root, 'tools', 'logos', 'masters-of-cinema.svg')),
};

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Rounded top corners, square bottom.
function topRound(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function starPath(ctx, cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.42 : r;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}

function plateFill(ctx, tier, k = 1, x0 = 0, x1 = W, reverse = false) {
  if (TIER[tier].plate) return k === 1 ? TIER[tier].plate : scale(TIER[tier].plate, k);
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  (PLATES[curTag] || MULTI).forEach(([o, c]) => g.addColorStop(reverse ? 1 - o : o, k === 1 ? c : scale(c, k)));
  return g;
}

// Ink bounds [x, y, w, h] of a paint function's fill, in its own units.
function inkBox(paint) {
  const P = 2, cw = 400 * P, ch = 200 * P;
  const c = createCanvas(cw, ch).getContext('2d');
  c.setTransform(P, 0, 0, P, cw / 2, ch / 2);
  paint(c, 'fill', 1);
  const d = c.getImageData(0, 0, cw, ch).data;
  let x0 = cw, x1 = -1, y0 = ch, y1 = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (d[(y * cw + x) * 4 + 3] >= 115) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return [(x0 - cw / 2) / P, (y0 - ch / 2) / P, (x1 - x0 + 1) / P, (y1 - y0 + 1) / P];
}

// Draws `paint` so its ink lands on `box` (stretching to match RPDB's proportions), then colours the fill.
function place(ctx, box, paint, fill, keepAspect) {
  const [bx, by, bw, bh] = inkBox(paint);
  let sx = box[2] / bw, sy = box[3] / bh, ox = box[0], oy = box[1];
  if (keepAspect) {
    const k = Math.min(sx, sy);
    ox += (box[2] - bw * k) / 2;
    oy += (box[3] - bh * k) / 2;
    sx = sy = k;
  }
  const apply = (c) => c.transform(sx, 0, 0, sy, ox - bx * sx, oy - by * sy);
  const k = Math.sqrt(sx * sy);
  ctx.save();
  apply(ctx);
  paint(ctx, 'stroke', k);
  ctx.restore();
  const layer = createCanvas(W * S, H * S).getContext('2d');
  layer.scale(S, S);
  layer.save();
  apply(layer);
  paint(layer, 'fill', k);
  layer.restore();
  layer.globalCompositeOperation = 'source-in';
  layer.fillStyle = typeof fill === 'function' ? fill(layer) : fill;
  layer.fillRect(0, 0, W, H);
  ctx.drawImage(layer.canvas, 0, 0, W, H);
}

// Paint functions draw white fills ('fill') or the dark outline ('stroke'); `k` is the placement scale.
const outline = (c, k) => {
  c.lineJoin = 'round';
  c.lineWidth = OUTLINE / k;
  c.strokeStyle = ink;
};

const textPaint = (lines) => (c, mode, k) => {
  c.font = `bold 40px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  lines.forEach((l, i) => {
    if (mode === 'stroke') {
      outline(c, k);
      c.strokeText(l, 0, i * 38);
    } else {
      c.fillStyle = '#fff';
      c.fillText(l, 0, i * 38);
    }
  });
};

const starsPaint = (n) => (c, mode, k) => {
  c.font = `bold 40px ${FONT}`;
  c.textAlign = 'right';
  c.textBaseline = 'alphabetic';
  starPath(c, 21, -14.5, 17);
  if (mode === 'stroke') {
    outline(c, k);
    c.stroke();
    c.strokeText(n, -3, 0);
  } else {
    c.fillStyle = '#fff';
    c.fill();
    c.fillText(n, -3, 0);
  }
};

const imagePaint = (img, w, h, hole) => (c, mode) => {
  if (mode !== 'fill') return;
  if (!hole) {
    c.drawImage(img, -w / 2, -h / 2, w, h);
    return;
  }
  // Solid block with the logo knocked out.
  c.fillStyle = '#fff';
  c.fillRect(-w / 2, -h / 2, w, h);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(img, ...hole);
  c.globalCompositeOperation = 'source-over';
};

// Captions are regular weight, with "HD" bold when it follows another word ("ULTRA HD").
const captionPaint = (cap) => (c, mode, k) => {
  if (mode !== 'fill') return;
  const parts = cap.split(' ').map((w, i, a) => [w + (i < a.length - 1 ? ' ' : ''), w === 'HD' && i > 0 ? 'bold' : 'normal']);
  const width = parts.reduce((t, [w, weight]) => { c.font = `${weight} 40px ${FONT}`; return t + c.measureText(w).width; }, 0);
  let x = -width / 2;
  c.fillStyle = '#fff';
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  for (const [w, weight] of parts) {
    c.font = `${weight} 40px ${FONT}`;
    c.fillText(w, x, 0);
    // RPDB's caption strokes are lighter than Arimo Regular; erode them slightly.
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = CAP_THIN / k;
    c.strokeText(w, x, 0);
    c.globalCompositeOperation = 'source-over';
    x += c.measureText(w).width;
  }
};

function mainPaint(tag, main) {
  if (main.endsWith(' ✯')) return starsPaint(main.slice(0, -2));
  if (tag === 'criterion') return imagePaint(LOGOS.criterion, 40, 40);
  if (tag === 'mastersofthecinema') return imagePaint(LOGOS.moc, 176, 62);
  // Dolby Vision: gradient block with the double-D knocked out, or a bare gradient double-D for the alt variant.
  if (tag === 'dolbyvisioncoloralt') return imagePaint(LOGOS.dolby, 57, 39);
  if (main === 'DV') return imagePaint(LOGOS.dolby, 59, 41, [-22.5, -16, 45, 30]);
  const words = main.split(' ');
  if (words.length > 1 && main.length > 8) {
    const mid = Math.ceil(words.length / 2);
    return textPaint([words.slice(0, mid).join(' '), words.slice(mid).join(' ')]);
  }
  return textPaint([main]);
}

function mainFill(tag, tier, box) {
  if (tag === 'criterion') return '#a8a8a8';
  if (tag === 'mastersofthecinema') return '#f2f2f2';
  if (tag.startsWith('dolbyvision')) return (c) => plateFill(c, 'm', 1, box[0], box[0] + box[2], tag === 'dolbyvision');
  if (tier !== 'm') return TIER[tier].text;
  return tag === 'hdrcolor' || tag === 'hdr10plus_colorful' ? FLAT_TEXT : (c) => plateFill(c, 'm');
}

function renderBadge([tag, main, cap, tier]) {
  curTag = tag;
  const c = createCanvas(W * S, H * S);
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  ink = plateFill(ctx, tier, 0.25);
  rr(ctx, 0, 0, W, H, R);
  ctx.fillStyle = plateFill(ctx, tier);
  ctx.fill();
  topRound(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, PANEL.r);
  ctx.fillStyle = '#333333';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink;
  ctx.stroke();
  const measured = BOXES[tag];
  const box = measured || DEFAULT_BOX;
  place(ctx, box.main, mainPaint(tag, main), mainFill(tag, tier, box.main), !measured);
  place(ctx, box.cap, captionPaint(cap), tier === 'm' ? (l) => plateFill(l, tier, 0.28) : TIER[tier].cap, !measured);
  return c.toBuffer('image/png');
}

// flag-icons places the US/UM stars with SVG markers, which Skia skips; replace them with explicit star paths.
function expandStars(svg) {
  if (!svg.includes('marker-mid')) return svg;
  const star = svg.match(/<marker[\s\S]*?<path[^>]*d="([^"]+)"/)[1];
  const rows = [11, 37, 63, 89, 115, 141, 166, 192, 218];
  const stars = rows.flatMap((y, i) => (i % 2 ? [47, 108, 169, 229, 290] : [16, 77, 138, 199, 260, 320])
    .map((x) => `<path transform="translate(${x} ${y})" d="${star}"/>`));
  return svg.replace(/<marker[\s\S]*?<\/marker>\s*<path[^>]*marker-mid[^>]*\/>/, `<g fill="#fff">${stars.join('')}</g>`);
}

// RPDB stretches the 4:3 flag to the full badge tile.
async function renderFlag(svgPath) {
  const img = await loadImage(Buffer.from(expandStars(fs.readFileSync(svgPath, 'utf8'))));
  const c = createCanvas(W * S, H * S);
  const ctx = c.getContext('2d');
  ctx.scale(S, S);
  rr(ctx, 0, 0, W, H, R);
  ctx.clip();
  ctx.drawImage(img, 0, 0, W, H);
  return c.toBuffer('image/png');
}

const badgeDir = path.join(outDir, 'badges');
const flagDir = path.join(outDir, 'flags');
fs.mkdirSync(badgeDir, { recursive: true });
fs.mkdirSync(flagDir, { recursive: true });

for (const b of BADGES) fs.writeFileSync(path.join(badgeDir, `${b[0]}.png`), renderBadge(b));

const flagSrc = path.join(root, 'node_modules', 'flag-icons', 'flags', '4x3');
let flags = 0;
for (const f of fs.readdirSync(flagSrc).filter((n) => n.endsWith('.svg'))) {
  fs.writeFileSync(path.join(flagDir, f.replace(/\.svg$/, '.png')), await renderFlag(path.join(flagSrc, f)));
  flags++;
}
console.log(`badges: ${BADGES.length}, flags: ${flags} -> ${outDir}`);
