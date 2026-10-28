// Draws RPDB-style rating-source icons in square and round variants. Usage: node tools/make-rating-icons.js [outDir]
// Official SVGs (tools/logos): Wikimedia Commons public-domain logos (Rotten Tomatoes, IMDb, Metacritic, Common Sense,
// MyAnimeList, Letterboxd), simple-icons CC0 glyphs (Trakt, MDBList) and the RogerEbert.com logo; all trademarks of their owners.
// MUST-SEE, the Metacritic audience bucket, TMDB, US age and RPDB's overall/critics/audience icons have no public SVG and are drawn here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || path.join(root, 'static', 'icons', 'ratings');
const FONT = 'IconArimo';
GlobalFonts.registerFromPath(path.join(root, 'static', 'fonts', 'Arimo-Bold.ttf'), FONT);
const SIZE = 256, U = SIZE / 100;

async function svg(name, { viewBox, edit } = {}) {
  let s = fs.readFileSync(path.join(root, 'tools', 'logos', name), 'utf8');
  if (edit) s = edit(s);
  // Some files only declare width/height; turn those into a viewBox before resizing.
  const head = s.match(/<svg[^>]*>/)[0];
  if (!/viewBox=/.test(head)) {
    const dim = (k) => parseFloat(head.match(new RegExp(`\\s${k}="([\\d.]+)`))[1]);
    s = s.replace(/<svg\s/, `<svg viewBox="0 0 ${dim('width')} ${dim('height')}" `);
  }
  s = s.replace(/<svg([^>]*)>/, (m, attrs) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')}>`);
  if (viewBox) s = s.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
  const [, , vw, vh] = s.match(/viewBox="([^"]*)"/)[1].split(/[\s,]+/).map(Number);
  return loadImage(Buffer.from(s.replace(/<svg\s/, `<svg width="${(vw / vh) * 600}" height="600" `)));
}
// IMDb's spotlight backdrop: two widening light beams forming a lopsided X (bottom-right to top-left,
// bottom-middle to the right side) over a slightly darkened field, clipped to the logo shape.
function spotlight(clip, k) {
  const dir = (a) => [Math.cos((a * Math.PI) / 180), Math.sin((a * Math.PI) / 180)];
  // A beam starts from a base of half-width `b` at (ax, ay) and widens between angles a0..a1.
  const beam = (ax, ay, a0, a1, b) => {
    const [mx, my] = dir((a0 + a1) / 2);
    const [px, py] = [-my, mx];
    const side = (a) => Math.sign(dir(a)[0] * px + dir(a)[1] * py);
    const base = (a) => [ax + px * b * side(a), ay + py * b * side(a)];
    const far = (a) => { const [bx, by] = base(a); const [dx, dy] = dir(a); return [bx + dx * 200, by + dy * 200]; };
    const pts = [base(a0), far(a0), far(a1), base(a1)];
    return `<polygon points="${pts.map(([x, y]) => `${x * k},${y * k}`).join(' ')}"/>`;
  };
  // Values tuned against RPDB's IMDb icon (colour-match score).
  return `<defs><clipPath id="spot">${clip}</clipPath>`
    + `<radialGradient id="ctr" cx="44%" cy="56%" r="57%"><stop offset="0" stop-color="#fff4b0" stop-opacity="0.5"/><stop offset="1" stop-color="#fff4b0" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="rim" cx="50%" cy="50%" r="72%"><stop offset="0.55" stop-color="#9a6a00" stop-opacity="0"/><stop offset="1" stop-color="#9a6a00" stop-opacity="0.3"/></radialGradient></defs>`
    + `<g clip-path="url(#spot)"><rect width="${100 * k}" height="${100 * k}" fill="#b07800" fill-opacity="0.5"/>`
    + `<g fill="#ffe55c" fill-opacity="0.47">${beam(98, 104, 203, 247, 5)}${beam(34, 104, 309, 328, 5)}</g>`
    + `<rect width="${100 * k}" height="${100 * k}" fill="url(#ctr)"/><rect width="${100 * k}" height="${100 * k}" fill="url(#rim)"/></g>`;
}
// Light glow behind IMDb's letters (a blurred pale copy drawn first); RPDB's letters are also a bit larger and taller.
const glow = (s, letters, std, c) => s.replace(letters, (l) => `<filter id="glow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="${std}"/></filter>`
  + `<g transform="translate(${c} ${c}) scale(1.04 1.17) translate(${-c} ${-c})">`
  + `<g filter="url(#glow)" opacity="0.9">${l.replace(/<g transform/, '<g fill="#fff6c8" transform').replace('class="s1"', 'fill="#fff6c8"')}</g>${l}</g>`);
// RPDB's audience icons reuse the RT popcorn bucket; the outline copy keeps white popcorn readable on yellow.
const popcorn = (s, bucket, corn, outline) => {
  let out = s.replace(/#fa3106/g, bucket);
  if (outline) out = out.replace(/<g fill="#ffd600">[\s\S]*?<\/g>/, (g) => `${g.replace('fill="#ffd600"', `fill="${outline}" stroke="${outline}" stroke-width="5"`)}${g}`);
  return out.replace(/#ffd600/g, corn);
};
const G = {
  // Trakt tile with the ring and check cut out.
  trakt: await svg('trakt-thesvg.svg', { edit: (s) => s.replace('#9F42C6', '#934cc1') }),
  mdblist: await svg('mdblist.svg'),
  imdbSquare: await svg('imdb-square.svg', { edit: (s) => glow(s, /<g transform="matrix\(2,0,0,2,16,46\)">[\s\S]*?<\/g>/, 3.8, 64).replace(/(<rect[^>]*\/>)/, (r) => r + spotlight('<rect width="128" height="128" rx="8"/>', 128 / 100)) }),
  imdbRound: await svg('imdb-rounded.svg', { edit: (s) => glow(s.replace('.s1 { fill: #000000 }', ''), /<path class="s1"[^>]*\/>/, 15.2, 256).replace(/(<path id="Forma 1"[^>]*\/>)/, (p) => p + spotlight('<circle cx="256" cy="256" r="256"/>', 512 / 100)) }),
  mal: await svg('myanimelist-favicon.svg'),
  // RPDB fills the roundel's centre navy rather than black, and its ring is thinner and a deeper yellow.
  metacritic: await svg('metacritic-roundel.svg', {
    edit: (s) => s.replace('<path d="M185.89', '<path fill="#011b36" d="M185.89')
      .replace('m-.455 21.37a78.325 78.325 0 0 1 78.395 78.235v.09a78.325 78.325 0 1 1-78.4-78.325z', 'm-.455 12a88 88 0 0 1 88 88v.09a88 88 0 1 1-88-88.09z')
      .replace('a87.45 87.45 0 1 1 0-.105', 'a89 89 0 1 1 0-.105').replace('#ffbd3f', '#fccc04')
      .replace('<path d="m87.045', '<path transform="translate(101 101) scale(1.12) translate(-101 -101)" d="m87.045'),
  }),
  mustsee: await svg('metacritic-mustsee.svg'),
  tmdbSquare: await svg('tmdb-square.svg', { edit: (s) => s.replace('fill="#000000"', 'fill="#02d475"') }),
  // Letters only: drop the first subpath (the speech-bubble outline).
  tmdbLetters: await svg('tmdb-square.svg', { edit: (s) => s.replace(/ d="([^"]*)"/, (m, d) => ` d="${d.slice(d.indexOf('zM') + 1)}"`) }),
  // Light check so it reads on RPDB's dark rating bar.
  commonsense: await svg('commonsense-check.svg', { edit: (s) => s.replace('fill="#000000"', 'fill="#e5e6e6"') }),
  letterboxd: await svg('letterboxd-vertical.svg', { viewBox: '118 46 262 97', edit: (s) => s.replace(/(id="Overlap" fill=)"#556677"/g, '$1"#ffffff"') }),
  // RE monogram and thumb, cropped away from the wordmark; RPDB swaps the colours (black thumb, gold RE).
  ebert: await svg('rogerebert.svg', {
    viewBox: '24 270 108 102',
    edit: (s) => s.replace('.st0{fill:#B99B68;}', '.st0{fill:#111111;}').replace('<path d="M57', '<path fill="#b99b68" d="M57'),
  }),
  rtFresh: await svg('rt-fresh.svg'),
  rtCertified: await svg('rt-fresh-alt.svg'),
  rtRotten: await svg('rt-rotten.svg'),
  rtPositive: await svg('rt-audience-positive.svg'),
  rtNegative: await svg('rt-audience-negative.svg'),
  mcAudience: await svg('rt-audience-positive.svg', { edit: (s) => popcorn(s, '#3a8bbb', '#ffd600') }),
  audience: await svg('rt-audience-positive.svg', { edit: (s) => popcorn(s, '#1a1a1a', '#fefefe', '#1a1a1a') }),
};

const layer = (w = SIZE, h = SIZE) => createCanvas(w, h).getContext('2d');

// Alpha bounds [x, y, w, h] of an image or canvas.
const boxCache = new Map();
function alphaBox(img) {
  if (boxCache.has(img)) return boxCache.get(img);
  const c = layer(img.width, img.height);
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, x1 = -1, y0 = img.height, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (d[(y * img.width + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const b = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  boxCache.set(img, b);
  return b;
}

// Draws an image fitted (aspect kept) and centred in box [x, y, w, h], tinted with `color` if given.
function put(ctx, img, box, color) {
  const [ix, iy, iw, ih] = alphaBox(img);
  const k = Math.min(box[2] / iw, box[3] / ih);
  const w = iw * k, h = ih * k;
  const l = layer();
  l.scale(U, U);
  l.drawImage(img, ix, iy, iw, ih, box[0] + (box[2] - w) / 2, box[1] + (box[3] - h) / 2, w, h);
  if (color) {
    l.globalCompositeOperation = 'source-in';
    l.fillStyle = color;
    l.fillRect(0, 0, 100, 100);
  }
  ctx.drawImage(l.canvas, 0, 0, 100, 100);
}

// The tile's transparent ring and check as a white mask; `checkOnly` drops the square ring.
function traktMask(checkOnly) {
  const img = G.trakt, w = img.width, h = img.height;
  const m = layer(w, h);
  rr(m, 0, 0, w, h, w * (5.634 / 24));
  m.fillStyle = '#fff';
  m.fill();
  m.globalCompositeOperation = 'destination-out';
  m.drawImage(img, 0, 0);
  // Drop anti-aliasing slivers along the SVG's outer edge (the ring starts ~10% in).
  m.globalCompositeOperation = 'destination-in';
  rr(m, w * 0.06, h * 0.06, w * 0.88, h * 0.88, w * 0.2);
  m.fill();
  // Split into the check (inner square plus the top-right gap it exits through) and the ring.
  const region = (c) => {
    c.beginPath();
    c.rect(w * 0.18, h * 0.18, w * 0.64, h * 0.64);
    c.rect(w * 0.72, 0, w * 0.28, h * 0.64);
  };
  const check = layer(w, h);
  check.drawImage(m.canvas, 0, 0);
  check.globalCompositeOperation = 'destination-in';
  region(check);
  check.fill();
  // The check's lines stop at the SVG's rounded corner; extend them along their 45° diagonal past the edge.
  check.globalCompositeOperation = 'source-over';
  const strip = layer(w, h);
  strip.drawImage(check.canvas, w * 0.72, h * 0.15, w * 0.2, h * 0.3, w * 0.72, h * 0.15, w * 0.2, h * 0.3);
  for (let s = 0; s <= w * 0.3; s += 2) check.drawImage(strip.canvas, s, -s);
  // RPDB's check lines are slightly heavier: dilate by unioning shifted copies.
  const thin = layer(w, h);
  thin.drawImage(check.canvas, 0, 0);
  const d = w * 0.003;
  for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) check.drawImage(thin.canvas, dx, dy);
  const out = layer(w, h);
  if (!checkOnly) {
    // RPDB's ring sits about half a unit up and right of the SVG's.
    out.drawImage(m.canvas, w * 0.005, -h * 0.005);
    out.globalCompositeOperation = 'destination-out';
    region(out);
    out.fill();
    out.globalCompositeOperation = 'source-over';
  }
  out.drawImage(check.canvas, 0, 0);
  return out.canvas;
}

// Keeps only the part of an image inside a centred circle (radius as a fraction of the shorter side).
function clipCircle(img, frac) {
  const c = layer(img.width, img.height);
  c.drawImage(img, 0, 0);
  c.globalCompositeOperation = 'destination-in';
  c.beginPath();
  c.arc(img.width / 2, img.height / 2, (Math.min(img.width, img.height) / 2) * frac, 0, Math.PI * 2);
  c.fill();
  return c.canvas;
}

// Keeps only the part of an image inside a centred inset rectangle.
function clipInset(img, frac) {
  const c = layer(img.width, img.height);
  const ix = img.width * frac, iy = img.height * frac;
  c.beginPath();
  c.rect(ix, iy, img.width - 2 * ix, img.height - 2 * iy);
  c.clip();
  c.drawImage(img, 0, 0);
  return c.canvas;
}

// The transparent holes of a glyph inside a centred inset rectangle (e.g. the "M" cut out of MDBList's square).
function holes(img, frac) {
  const c = layer(img.width, img.height);
  const ix = img.width * frac, iy = img.height * frac;
  c.fillStyle = '#fff';
  c.fillRect(ix, iy, img.width - 2 * ix, img.height - 2 * iy);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(img, 0, 0);
  return c.canvas;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Background: rounded square in the square style, circle in the round style.
function tile(ctx, round, fill, radius = 11) {
  ctx.beginPath();
  if (round) ctx.arc(50, 50, 50, 0, Math.PI * 2);
  else rr(ctx, 0, 0, 100, 100, radius);
  ctx.fillStyle = fill;
  ctx.fill();
}

function text(ctx, str, box, color) {
  const c = layer(2600, 400);
  c.font = `bold 300px ${FONT}`;
  c.textBaseline = 'middle';
  c.fillStyle = '#000';
  c.fillText(str, 20, 200);
  put(ctx, c.canvas, box, color);
}

function star(ctx, cx, cy, r, inner = 0.42, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i * Math.PI) / 5;
    const rad = i % 2 ? r * inner : r;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}

const ICONS = {
  imdb(ctx, round) {
    put(ctx, round ? G.imdbRound : G.imdbSquare, [0, 0, 100, 100]);
  },
  tmdb(ctx, round) {
    const green = '#02d475';
    if (!round) {
      put(ctx, G.tmdbSquare, [0, 0, 100, 100]);
      return;
    }
    ctx.strokeStyle = green;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(50, 50, 46.5, 0, Math.PI * 2);
    ctx.stroke();
    put(ctx, G.tmdbLetters, [31, 24, 38, 52], green);
  },
  trakt(ctx, round) {
    tile(ctx, round, '#934cc1', 20);
    if (!round) {
      ctx.save();
      rr(ctx, 0, 0, 100, 100, 20);
      ctx.clip();
      ctx.drawImage(traktMask(false), 0, 0, 100, 100);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(traktMask(true), 0, 0, 100, 100);
    ctx.restore();
    // Round ring opens at the top right, where the check passes through.
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4.4;
    ctx.beginPath();
    ctx.arc(50, 50, 37.6, (24 * Math.PI) / 180, (297 * Math.PI) / 180);
    ctx.stroke();
  },
  letterboxd(ctx) {
    ctx.fillStyle = '#1c2934';
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, Math.PI * 2);
    ctx.fill();
    put(ctx, G.letterboxd, [10, 33, 80, 34]);
  },
  rogerebert(ctx, round) {
    tile(ctx, round, '#fffffe', 0);
    put(ctx, G.ebert, round ? [9, 14, 82, 72] : [6, 10, 88, 80]);
  },
  mdblist(ctx, round) {
    tile(ctx, round, '#4284ca');
    put(ctx, holes(G.mdblist, 0.12), [22, 26, 56, 48], '#fff');
  },
  myanimelist(ctx, round) {
    put(ctx, round ? clipCircle(G.mal, 1) : G.mal, [0, 0, 100, 100]);
  },
  metacritic(ctx) {
    put(ctx, G.metacritic, [1, 1, 98, 98]);
  },
  'metacritic-mustsee'(ctx) {
    put(ctx, G.mustsee, [0, 0, 100, 100]);
  },
  'metacritic-audience'(ctx) {
    put(ctx, G.mcAudience, [0, 0, 100, 100]);
  },
  commonsense(ctx) {
    put(ctx, G.commonsense, [0, 0, 100, 100]);
  },
  'us-age'(ctx, round) {
    tile(ctx, round, '#3b877b');
    text(ctx, 'US', round ? [18, 30, 64, 40] : [14, 28, 72, 44], '#fcfefe');
  },
  'overall-rating'(ctx, round) {
    tile(ctx, round, '#f68621');
    ctx.fillStyle = '#2e2e2e';
    ctx.strokeStyle = '#2e2e2e';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    star(ctx, 50, 51, 37, 0.44, 0.31);
    ctx.fill();
    ctx.stroke();
  },
  'critics-rating'(ctx, round) {
    tile(ctx, round, '#34495d');
    const gem = [[26, 22], [74, 22], [91, 40], [50, 80], [9, 40]];
    ctx.beginPath();
    gem.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = '#fdfefe';
    ctx.fill();
    // Facets.
    ctx.strokeStyle = '#34495d';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(9, 40);
    ctx.lineTo(91, 40);
    ctx.moveTo(26, 22);
    ctx.lineTo(36, 40);
    ctx.lineTo(50, 22);
    ctx.lineTo(64, 40);
    ctx.lineTo(74, 22);
    ctx.moveTo(36, 40);
    ctx.lineTo(50, 80);
    ctx.lineTo(64, 40);
    ctx.stroke();
  },
  'audience-rating'(ctx, round) {
    tile(ctx, round, '#fec107');
    put(ctx, G.audience, round ? [19, 8, 62, 84] : [19, 7, 62, 86]);
  },
  'tomatoes-fresh'(ctx) {
    put(ctx, G.rtFresh, [0, 0, 100, 100]);
  },
  'tomatoes-certified'(ctx) {
    put(ctx, G.rtCertified, [0, 0, 100, 100]);
  },
  'tomatoes-rotten'(ctx) {
    put(ctx, G.rtRotten, [0, 0, 100, 100]);
  },
  'tomatoes-audience-positive'(ctx) {
    put(ctx, G.rtPositive, [0, 0, 100, 100]);
  },
  'tomatoes-audience-negative'(ctx) {
    put(ctx, G.rtNegative, [0, 0, 100, 100]);
  },
};

// Icons whose round variant differs; the rest are identical in both styles.
const ROUNDED = new Set(['imdb', 'tmdb', 'trakt', 'rogerebert', 'mdblist', 'myanimelist', 'us-age', 'overall-rating', 'critics-rating', 'audience-rating']);

for (const style of ['square', 'round']) {
  const dir = path.join(outDir, style);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, draw] of Object.entries(ICONS)) {
    const c = createCanvas(SIZE, SIZE);
    const ctx = c.getContext('2d');
    ctx.scale(U, U);
    draw(ctx, style === 'round' && ROUNDED.has(name));
    fs.writeFileSync(path.join(dir, `${name}.png`), c.toBuffer('image/png'));
  }
}
console.log(`${Object.keys(ICONS).length} icons x 2 styles -> ${outDir}`);
