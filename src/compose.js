import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { drawMediaBadges, layoutBadges, parseBadgePos, posterBadgeMetrics, backdropBadgeMetrics } from './media-badges.js';
import { sanitizeDesign, IMAGE_WIDTHS, DESIGN_DEFAULTS } from './look.js';

// Unified local renderer. One look drives every image: OpenPosterDB's split badges (badge.rs /
// generate.rs geometry, MIT) and RPDB's bars, blocks, boxes and stripes (geometry measured from RPDB
// renders) are tile/layout choices, and every option (icons, numbers, fill, corners, skew, stroke,
// spacing, position...) works with all of them.
const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static');
const INTER = 'RPDBInter';
const ROBOTO = 'RPDBRoboto';
GlobalFonts.registerFromPath(path.join(STATIC, 'fonts', 'Inter-Bold.ttf'), INTER);
GlobalFonts.registerFromPath(path.join(STATIC, 'fonts', 'Roboto.ttf'), ROBOTO);

export { DESIGN_DEFAULTS, sanitizeDesign };
const BASE = { poster: 580, backdrop: 1920, logo: 780 };

// ---------- ratings ----------
// MDBList source, native scale, OPDB colour (split badge label), RPDB accent (block stroke / box underline), labels
export const SOURCES = {
  imdb: { md: 'imdb', field: 'value', scale: 10, color: '#b4910f', accent: '#e2c55f', label: 'IMDb', short: 'IMDb' },
  tmdb: { md: 'tmdb', field: 'score', scale: 100, color: '#019b58', accent: '#01b4e4', label: 'TMDB', short: 'TMDB' },
  rt: { md: 'tomatoes', field: 'score', scale: 100, color: '#b92308', accent: '#d5472f', label: 'RT Critics', short: 'RTC' },
  rta: { md: 'popcorn', field: 'score', scale: 100, color: '#b92308', accent: '#d5472f', label: 'RT Audience', short: 'RTA' },
  mc: { md: 'metacritic', field: 'score', scale: 100, color: '#4b9626', accent: '#7283a1', label: 'Metacritic', short: 'MC' },
  mcu: { md: 'metacriticuser', field: 'score', scale: 100, color: '#4b9626', accent: '#7283a1', label: 'Metacritic Users', short: 'MCU' },
  trakt: { md: 'trakt', field: 'score', scale: 100, color: '#af0f2d', accent: '#ed1c24', label: 'Trakt', short: 'Trakt' },
  lb: { md: 'letterboxd', field: 'value', scale: 5, color: '#009b58', accent: '#00c030', label: 'Letterboxd', short: 'LB' },
  mal: { md: 'myanimelist', field: 'value', scale: 10, color: '#223c78', accent: '#2e51a2', label: 'MyAnimeList', short: 'MAL' },
  mdblist: { md: 'mdblist', field: 'score', scale: 100, color: '#4284ca', accent: '#4284ca', label: 'MDBList', short: 'MDB' },
  // RPDB prints Roger Ebert's 4-star value out of 5 ("4.0/5")
  ebert: { md: 'rogerebert', field: 'value', scale: 5, color: '#e8590c', accent: '#e8590c', label: 'Roger Ebert', short: 'Ebert' },
  // RPDB's own sources; accents not measured, taken from the icons
  commonsense: { scale: 100, color: '#2bb24c', accent: '#2bb24c', label: 'Common Sense', short: 'CSM' },
  usage: { scale: 100, color: '#2f8f83', accent: '#2f8f83', label: 'US Age', short: 'Age' },
  overall: { scale: 100, color: '#f7931e', accent: '#f7931e', label: 'Overall', short: 'All' },
  critics: { scale: 100, color: '#34495e', accent: '#34495e', label: 'Critics', short: 'Critics' },
  audience: { scale: 100, color: '#c99a06', accent: '#f5c518', label: 'Audience', short: 'Aud' },
};
// Sources shown when no rating order picks them; RPDB's own sources only appear when ordered.
const DEFAULT_ORDER = ['imdb', 'tmdb', 'rt', 'rta', 'mc', 'trakt', 'lb', 'mal', 'mdblist', 'ebert'];

const VALUE_SCALE = { imdb: 10, metacriticuser: 10, letterboxd: 20, myanimelist: 10 };
function pct(scores, md) {
  const s = scores?.[md];
  if (md === 'rogerebert') return Number(s?.value) * 20 || 0;
  return Number(s?.score) || Number(s?.value) * (VALUE_SCALE[md] || 1) || 0;
}
// RPDB aggregates, matched against RPDB renders: plain means of the available sources.
const AUDIENCE = ['imdb', 'metacriticuser', 'trakt', 'popcorn', 'tmdb', 'letterboxd'];
const CRITICS = ['metacritic', 'tomatoes', 'rogerebert'];
const AGGREGATE = { audience: AUDIENCE, critics: CRITICS, overall: [...AUDIENCE, ...CRITICS] };

function valueOf(key, s, scores, info) {
  if (key === 'commonsense') {
    const age = Math.round(Number(info?.commonsense));
    return age > 0 ? { n: age, text: `${age}+` } : null;
  }
  if (key === 'usage') return info?.certification ? { n: 1, text: String(info.certification) } : null;
  if (AGGREGATE[key]) {
    const vals = AGGREGATE[key].map((md) => pct(scores, md)).filter((v) => v > 0);
    return vals.length ? { n: vals.reduce((a, v) => a + v, 0) / vals.length } : null;
  }
  const v = Number(scores?.[s.md]?.[s.field]);
  return v > 0 ? { n: v } : null;
}

/** All available ratings for a title: MDBList scores (MDBList shape) + info (certification, Common Sense age). */
export function ratingItems({ scores = {}, info = {} } = {}) {
  const out = {};
  for (const [key, s] of Object.entries(SOURCES)) {
    const v = valueOf(key, s, scores, info);
    if (v) out[key] = { key, ...s, ...v };
  }
  return out;
}

/**
 * Create Poster query (ratings="imdb:9.0|rt:97", rtCert, mcCert, rtAudienceCert) -> MDBList-shaped scores
 * plus forced certification icons.
 */
export function createPosterScores(q) {
  const scores = {};
  const MAP = { mal: ['myanimelist', 'value', 1], imdb: ['imdb', 'value', 1], mc: ['metacritic', 'score', 1], rt: ['tomatoes', 'score', 1], rtaudience: ['popcorn', 'score', 1], mcaudience: ['metacriticuser', 'score', 10] };
  for (const part of String(q?.ratings || '').split('|')) {
    const [key, v] = part.split(':');
    const m = MAP[key?.trim()];
    const n = Number(v);
    if (m && n > 0) scores[m[0]] = { [m[1]]: n * m[2] };
  }
  const force = {};
  if (q?.rtCert === '1' || q?.rtCert === '-1') force.rt = Number(q.rtCert);
  if (q?.mcCert === '1') force.mc = 1;
  if (q?.rtAudienceCert === '1' || q?.rtAudienceCert === '-1') force.rta = Number(q.rtAudienceCert);
  return { scores, force };
}

/** Preferred sources first, then the default order; excluded ones dropped; at most `limit`. */
export function pickRatings(items, { order, exclude, limit }) {
  if (!limit) return [];
  const ex = String(exclude || '').split(',').filter(Boolean);
  const pref = String(order || '').split(',').filter(Boolean);
  return [...pref, ...DEFAULT_ORDER.filter((k) => !pref.includes(k))].filter((k) => !ex.includes(k) && items[k]).map((k) => items[k]).slice(0, limit);
}

// OpenPosterDB's per-source formatting (ratings.rs): IMDb 9.2, MAL 8.50, Metacritic 100, others 97%
const OPDB_DECIMALS = { imdb: 1, lb: 1, ebert: 1, mal: 2 };
export function valueText(it, mode) {
  if (it.text) return it.text;
  const p = it.n * (100 / it.scale);
  if (mode === 'opdb') {
    if (OPDB_DECIMALS[it.key]) return it.n.toFixed(OPDB_DECIMALS[it.key]);
    if (it.key === 'mc' || it.key === 'mdblist') return String(Math.round(it.n));
    return it.scale === 100 ? `${Math.round(it.n)}%` : it.n.toFixed(1);
  }
  if (mode === 'whole') return String(Math.round(p));
  if (it.scale === 100) return mode === 'bare' ? String(Math.round(it.n)) : `${Math.round(it.n)}%`;
  return mode === 'full' ? `${it.n.toFixed(1)}/${it.scale}` : it.n.toFixed(1);
}

/** Sample ratings for previews. */
export const SAMPLE_SCORES = {
  imdb: { value: 9.2, score: 92 }, tmdb: { score: 87 }, tomatoes: { score: 97 }, popcorn: { score: 98 }, metacritic: { score: 100 },
  metacriticuser: { value: 9.2, score: 92 }, trakt: { score: 91 }, letterboxd: { value: 4.5, score: 90 }, mdblist: { score: 95 }, rogerebert: { value: 4 },
};
export const SAMPLE_INFO = { certification: 'PG-13', commonsense: 13, language: 'it', country: 'IT' };
export const SAMPLE_ITEMS = ratingItems({ scores: SAMPLE_SCORES, info: SAMPLE_INFO });

// ---------- look helpers ----------
const familyOf = (look) => (look.layout === 'bar' ? 'bar' : look.tile);
const fontName = (look, fam) => (look.font === 'inter' || (look.font === 'auto' && fam === 'split') ? INTER : ROBOTO);
const font = (look, fam, px) => `${look.bold ? 'bold ' : ''}${px}px ${fontName(look, fam)}`;
const textColor = (look) => (look.text !== 'auto' ? look.text : look.fill === 'light' ? '#111' : '#fff');
const CAP = 0.711;

function numbersMode(look, fam, kind, column) {
  if (look.numbers !== 'auto') return look.numbers;
  if (fam === 'split') return 'opdb';
  if (fam === 'box') return 'whole';
  if (kind === 'logo' || column || look.content === 'above') return 'bare';
  if (fam === 'bar') return kind === 'poster' ? 'full' : 'bare';
  return 'short';
}

// Fills measured on RPDB renders: bar #1f2025 a0.94 (backdrop panel #1d1e26 a0.60), blocks/boxes #1f1e26 a0.70.
function fillOf(look, fam, kind, colorOf) {
  if (look.fill === 'none') return null;
  const alpha = look.opacity ?? (fam === 'bar' ? (kind === 'backdrop' ? 0.6 : 0.94) : fam === 'split' ? 1 : 0.7);
  let color;
  if (look.fill === 'dark') color = fam === 'bar' ? (kind === 'backdrop' ? '#1d1e26' : '#1f2025') : fam === 'split' ? '#000' : '#1f1e26';
  else if (look.fill === 'light') color = fam === 'bar' || fam === 'split' ? '#f4f4f4' : '#f5f4f4';
  else if (look.fill === 'source') color = colorOf || (fam === 'bar' ? '#1f2025' : '#1f1e26');
  else color = look.fill;
  return { color, alpha: look.fill === 'dark' && fam === 'split' && look.opacity == null ? 0.784 : alpha };
}
function strokeOf(look, fam, item, k) {
  if (look.stroke === 'none' || fam === 'box') return null;
  if (look.stroke === 'auto') return fam === 'block' ? { color: item.accent, alpha: 0.7, w: look.strokeWidth * k } : null;
  return { color: look.stroke === 'source' ? (fam === 'split' ? item.color : item.accent) : look.stroke, alpha: 1, w: look.strokeWidth * k };
}
function cornerOf(look, fam, h, k, span = 'fit') {
  if (look.corners === 'full') return h / 2;
  if (look.corners !== 'auto') return look.corners * k;
  return { split: 10, block: 12, box: 0, bar: span === 'full' ? 0 : 12 }[fam] * k;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
// RPDB stripes slant ~16 degrees
function tilePath(ctx, x, y, w, h, r, skew) {
  const slant = skew === 'none' ? 0 : Math.tan((16 * Math.PI) / 180) * h * (skew === 'right' ? 1 : -1);
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (slant) ctx.transform(1, 0, -slant / h, 1, 0, 0);
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.restore();
}
function paintFill(ctx, fill, fn) {
  if (!fill) return;
  ctx.save();
  ctx.globalAlpha = fill.alpha;
  ctx.fillStyle = fill.color;
  fn();
  ctx.restore();
}
function paintStroke(ctx, stroke, side, x, y, w, h, r, skew) {
  if (!stroke) return;
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.globalAlpha = stroke.alpha;
  ctx.lineWidth = stroke.w;
  if (side === 'all') {
    tilePath(ctx, x, y, w, h, r, skew);
  } else {
    ctx.beginPath();
    const [x0, y0, x1, y1] = { top: [x, y, x + w, y], bottom: [x, y + h, x + w, y + h], left: [x, y, x, y + h], right: [x + w, y, x + w, y + h] }[side];
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
  ctx.restore();
}
function withShadow(ctx, on, k, fn) {
  if (on) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.63)';
    ctx.shadowOffsetX = ctx.shadowOffsetY = Math.max(1, Math.round(2 * k));
  }
  fn();
  if (on) ctx.restore();
}

// ---------- icons ----------
const iconCache = new Map();
function loadIcon(rel) {
  if (!iconCache.has(rel)) iconCache.set(rel, loadImage(path.join(STATIC, 'icons', rel)).catch(() => null));
  return iconCache.get(rel);
}
const OPDB_ICONS = new Set(['imdb', 'tmdb', 'rt', 'rta', 'mc', 'trakt', 'lb', 'mal', 'mdblist', 'ebert']);
const OFFICIAL = { imdb: 'imdb.png', tmdb: 'tmdb.png', mc: 'metacritic.png', trakt: 'trakt.png', lb: 'letterboxd.png', mal: 'mal.webp', mdblist: 'mdblist.png', ebert: 'ebert.png' };
const RPDB_FILE = {
  imdb: 'imdb', tmdb: 'tmdb', mc: 'metacritic', mcu: 'metacritic-audience', trakt: 'trakt', lb: 'letterboxd', mal: 'myanimelist', mdblist: 'mdblist',
  ebert: 'rogerebert', commonsense: 'commonsense', usage: 'us-age', overall: 'overall-rating', critics: 'critics-rating', audience: 'audience-rating',
};
// certs: Certified Fresh (75+) / Must-See (81+) icons; force: Create Poster choices. Sources missing from a pack use the RPDB-like icon.
function iconRel(it, look, force = {}) {
  if (look.icons === 'none' || look.icons === 'text') return null;
  if (look.icons === 'opdb' && OPDB_ICONS.has(it.key)) return `${it.key}.png`;
  if (look.icons === 'official') {
    if (it.key === 'rt' || it.key === 'rta') {
      const tier = it.n >= 75 ? 2 : it.n >= 60 ? 1 : 0;
      return `official/${it.key === 'rt'
        ? ['Rotten_Tomatoes_critic_rotten.png', 'Rotten_Tomatoes_critic_positive.png', 'Rotten_Tomatoes_critic_certified_fresh.png'][tier]
        : ['Rotten_Tomatoes_negative_audience.png', 'Rotten_Tomatoes_positive_audience.png', 'Rotten_Tomatoes_verified_hot_audience.png'][tier]}`;
    }
    if (OFFICIAL[it.key]) return `official/${OFFICIAL[it.key]}`;
  }
  let file = RPDB_FILE[it.key];
  if (it.key === 'rt') file = force.rt ? (force.rt > 0 ? 'tomatoes-certified' : 'tomatoes-rotten') : it.n >= 75 && look.certIcons ? 'tomatoes-certified' : it.n >= 60 ? 'tomatoes-fresh' : 'tomatoes-rotten';
  if (it.key === 'rta') file = (force.rta ? force.rta > 0 : it.n >= 60) ? 'tomatoes-audience-positive' : 'tomatoes-audience-negative';
  if (it.key === 'mc' && ((look.certIcons && it.n >= 81) || force.mc)) file = 'metacritic-mustsee';
  return `ratings/${look.icons === 'rpdb-round' ? 'round' : 'square'}/${file}.png`;
}
const iconOf = (it, look, force) => { const rel = iconRel(it, look, force); return rel ? loadIcon(rel) : Promise.resolve(null); };
// OPDB's icon strip keeps its aspect at the box height; the other packs fit a square box.
function iconW(img, box, look) {
  if (!img) return box;
  return look.icons === 'opdb' && img.width / img.height > 1.05 ? Math.ceil((img.width * box) / img.height) : box;
}
function drawIcon(ctx, img, x, y, w, h) {
  if (!img) return;
  const s = Math.min(w / img.width, h / img.height);
  ctx.drawImage(img, x + (w - img.width * s) / 2, y + (h - img.height * s) / 2, img.width * s, img.height * s);
}

// ---------- tiles (one per rating) ----------
// OpenPosterDB split badge: label section (icon or text) + value section; uniform widths across a group.
async function splitTiles(ctx, list, look, kind, k, force) {
  const fs = look.fontScale;
  const P = (v) => (look.padding != null ? look.padding : v) * k;
  const m = { h: 58 * k, padH: P(14), textPadH: P(8), valuePadH: P(10), icon: 48 * k, font: 34 * k * fs, labelFont: 26 * k * fs, vWidth: 88 * k, vPadV: P(8), gap: 4 * k };
  const pill = look.corners === 'full';
  const [pp, ppv] = pill ? [10 * k, 6 * k] : [0, 0];
  const mode = numbersMode(look, 'split', kind, look.arrange === 'column');
  const label = look.icons !== 'none';
  const text = look.icons === 'text';
  const imgs = await Promise.all(list.map((it) => (label && !text ? iconOf(it, look, force) : null)));
  const vals = list.map((it) => valueText(it, mode));
  ctx.font = font(look, 'split', m.labelFont);
  const labelWs = list.map((it, i) => (text ? Math.ceil(ctx.measureText(it.short).width) : iconW(imgs[i], m.icon, look)));
  ctx.font = font(look, 'split', m.font);
  const valueWs = vals.map((v) => Math.ceil(ctx.measureText(v).width));
  const tiles = [];
  if (look.content === 'beside') {
    const labelW = label ? Math.max(...labelWs) : 0;
    const valueW = Math.max(...valueWs);
    const labelPad = text ? m.textPadH : m.padH;
    const h = m.h + ppv;
    const valueX = label ? pp + labelW + labelPad * 2 : pp;
    const w = valueX + valueW + m.valuePadH + Math.floor(m.valuePadH / 2) + 2 + pp;
    list.forEach((it, i) => tiles.push({ it, w, h, paint: (x, y) => paintSplit(ctx, { it, img: imgs[i], val: vals[i], x, y, w, h, look, kind, k, m, horizontal: true, split: valueX, labelBox: [x + pp + labelPad, labelW], valueBox: [x + valueX + m.valuePadH, valueW] }) }));
  } else {
    const padV = m.vPadV + pp;
    const labelArea = !label ? 0 : text ? Math.round(m.labelFont) : m.icon;
    const w = Math.max(m.vWidth, Math.max(...valueWs) + 16 * k, label && !text ? Math.max(...labelWs) + 8 * k : 0);
    const h = padV + labelArea + (label ? m.gap : 0) + Math.round(m.font) + padV;
    const split = label ? padV + labelArea + Math.floor(m.gap / 2) : 0;
    list.forEach((it, i) => tiles.push({ it, w, h, paint: (x, y) => paintSplit(ctx, { it, img: imgs[i], val: vals[i], x, y, w, h, look, kind, k, m, horizontal: false, split, labelArea }) }));
  }
  return tiles;
}
function paintSplit(ctx, o) {
  const { it, look, kind, k, m, x, y, w, h } = o;
  const fill = fillOf(look, 'split', kind, it.color);
  const r = cornerOf(look, 'split', h, k);
  if (fill) {
    const valueFill = look.fill === 'light' ? { color: '#f4f4f4', alpha: look.opacity ?? 0.92 } : { color: '#000', alpha: look.opacity ?? 0.784 };
    ctx.save();
    tilePath(ctx, x, y, w, h, r, look.skew);
    ctx.clip();
    paintFill(ctx, fill, () => (o.horizontal ? ctx.fillRect(x - h, y, o.split + h, h) : ctx.fillRect(x - h, y, w + 2 * h, o.split)));
    paintFill(ctx, valueFill, () => (o.horizontal ? ctx.fillRect(x + o.split, y, w - o.split + h, h) : ctx.fillRect(x - h, y + o.split, w + 2 * h, h - o.split)));
    ctx.restore();
  }
  paintStroke(ctx, strokeOf(look, 'split', it, k), look.strokeSide, x, y, w, h, r, look.skew);
  withShadow(ctx, !fill, k, () => {
    ctx.fillStyle = textColor(look);
    ctx.textBaseline = 'middle';
    const text = look.icons === 'text';
    if (o.horizontal) {
      const [lx, lw] = o.labelBox;
      if (text) {
        ctx.font = font(look, 'split', m.labelFont);
        ctx.fillText(it.short, lx + (lw - ctx.measureText(it.short).width) / 2, y + h / 2);
      } else if (o.img) {
        const iw = iconW(o.img, m.icon, look);
        drawIcon(ctx, o.img, lx + (lw - iw) / 2, y + (h - m.icon) / 2, iw, m.icon);
      }
      ctx.font = font(look, 'split', m.font);
      const [vx, vw] = o.valueBox;
      ctx.fillText(o.val, vx + (vw - ctx.measureText(o.val).width) / 2, y + h / 2);
    } else {
      if (text) {
        ctx.font = font(look, 'split', m.labelFont);
        ctx.fillText(it.short, x + (w - ctx.measureText(it.short).width) / 2, y + o.split / 2);
      } else if (o.img) {
        let iw = iconW(o.img, m.icon, look);
        let ih = m.icon;
        if (iw > w - 8 * k) { ih = Math.round((ih * (w - 8 * k)) / iw); iw = w - 8 * k; }
        drawIcon(ctx, o.img, x + (w - iw) / 2, y + (o.split - ih) / 2, iw, ih);
      }
      ctx.font = font(look, 'split', m.font);
      ctx.fillText(o.val, x + (w - ctx.measureText(o.val).width) / 2, o.split ? y + o.split + (h - o.split) / 2 : y + h / 2);
    }
  });
}

// RPDB block (icon + value on one fill) and box (value + accent underline); poster geometry at 580 wide,
// backdrop columns measured at 1920 wide. Row blocks on backdrops are scaled up (not measured on RPDB).
function blockDims(look, kind, k) {
  const fs = look.fontScale;
  const P = (v) => (look.padding != null ? look.padding * k : v * k);
  if (look.content === 'beside') {
    const b = kind === 'backdrop' ? 1.775 : 1;
    return { padX: P(10 * b), padY: P(10 * b), icon: 40 * k * b, iconGap: 18 * k * b, font: 40 * k * b * fs, widen: look.skew !== 'none' ? 12 * k * b : 0 };
  }
  if (kind === 'backdrop') return { padX: P(13), padT: P(13), padB: P(14), icon: 71 * k, gapIT: 16 * k, font: 36.6 * k * fs, minW: (look.tile === 'box' ? 101 : 97) * k };
  return { padX: P(10), padT: P(10), padB: P(18), icon: 40 * k, gapIT: 24 * k, font: 33 * k * fs, minW: 0 };
}
async function blockTiles(ctx, list, look, kind, k, force) {
  const fam = look.tile;
  const d = blockDims(look, kind, k);
  const column = look.arrange === 'column';
  const mode = numbersMode(look, fam, kind, column);
  const showIcon = look.icons !== 'none';
  const text = look.icons === 'text';
  const imgs = await Promise.all(list.map((it) => (showIcon && !text ? iconOf(it, look, force) : null)));
  const vals = list.map((it) => valueText(it, mode));
  const under = fam === 'box' && look.stroke !== 'none' ? 4 * k : 0;
  ctx.font = font(look, fam, d.font);
  const tws = vals.map((v) => ctx.measureText(v).width);
  const labelFont = d.font * 0.65;
  const lws = list.map((it, i) => {
    if (!showIcon) return 0;
    if (text) { ctx.font = font(look, fam, labelFont); return ctx.measureText(it.short).width; }
    return iconW(imgs[i], d.icon, look);
  });
  let tiles;
  if (look.content === 'beside') {
    const h = Math.max(showIcon ? d.icon : 0, d.font * 0.8) + d.padY * 2 + 1 * k;
    tiles = list.map((it, i) => ({ it, img: imgs[i], val: vals[i], lw: lws[i], tw: tws[i], w: d.padX * 2 + (showIcon ? lws[i] + d.iconGap : 0) + tws[i] + d.widen, h }));
  } else {
    const cap = d.font * CAP;
    tiles = list.map((it, i) => ({ it, img: imgs[i], val: vals[i], lw: lws[i], tw: tws[i], w: Math.max(d.minW, d.padX * 2 + Math.max(lws[i], tws[i])), h: d.padT + (showIcon ? d.icon + d.gapIT : 0) + cap + d.padB }));
    if (column) { const w = Math.max(...tiles.map((t) => t.w)); for (const t of tiles) t.w = w; }
  }
  for (const t of tiles) {
    t.extraH = under;
    t.paint = (x, y) => paintBlock(ctx, t, x, y, { look, kind, k, d, fam, text, showIcon, labelFont, under });
  }
  return tiles;
}
function paintBlock(ctx, t, x, y, o) {
  const { look, kind, k, d, fam } = o;
  const { w, h, it } = t;
  const fill = fillOf(look, fam, kind, it.accent);
  const r = cornerOf(look, fam, h, k);
  paintFill(ctx, fill, () => { tilePath(ctx, x, y, w, h, r, look.skew); ctx.fill(); });
  if (o.under) {
    ctx.fillStyle = look.stroke === 'auto' || look.stroke === 'source' ? it.accent : look.stroke;
    ctx.fillRect(x, y + h, w, o.under);
  }
  paintStroke(ctx, strokeOf(look, fam, it, k), look.strokeSide, x, y, w, h, r, look.skew);
  withShadow(ctx, !fill, k, () => {
    ctx.fillStyle = textColor(look);
    if (look.content === 'beside') {
      ctx.textBaseline = 'middle';
      let tx = x + d.padX + d.widen / 2;
      if (o.showIcon) {
        if (o.text) { ctx.font = font(look, fam, o.labelFont); ctx.fillText(it.short, tx, y + h / 2); } else drawIcon(ctx, t.img, tx, y + (h - d.icon) / 2, t.lw, d.icon);
        tx += t.lw + d.iconGap;
      }
      ctx.font = font(look, fam, d.font);
      // Value-only tiles centre their number
      ctx.fillText(t.val, o.showIcon ? tx : x + (w - t.tw) / 2, y + h / 2);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      let ty = y + d.padT;
      if (o.showIcon) {
        if (o.text) { ctx.font = font(look, fam, o.labelFont); ctx.fillText(it.short, x + w / 2, ty + d.icon * 0.7); } else drawIcon(ctx, t.img, x + (w - t.lw) / 2, ty, t.lw, d.icon);
        ty += d.icon + d.gapIT;
      }
      ctx.font = font(look, fam, d.font);
      ctx.fillText(t.val, x + w / 2, ty + d.font * CAP);
      ctx.textAlign = 'left';
    }
  });
}

// ---------- placement ----------
const anchorOf = (pos) => ({
  h: ['tl', 'l', 'bl'].includes(pos) ? 'left' : ['tr', 'r', 'br'].includes(pos) ? 'right' : 'center',
  v: pos.startsWith('t') ? 'top' : pos.startsWith('b') ? 'bottom' : 'center',
});
// Edge margins: OPDB 20 top / 10 bottom / 15 side (20 on backdrops); RPDB blocks 11 (boxes 10), side columns 18, backdrop columns 35 / 41.
function badgeMargins(look, fam, kind, k) {
  if (look.margin != null) return { top: look.margin * k, bottom: look.margin * k, side: look.margin * k };
  if (kind === 'logo') return { top: 0, bottom: 0, side: 0 };
  if (fam === 'split') return { top: 20 * k, bottom: 10 * k, side: (kind === 'backdrop' ? 20 : 15) * k };
  if (kind === 'backdrop') return fam === 'box' ? { top: 33 * k, bottom: 33 * k, side: 39 * k } : { top: 35 * k, bottom: 35 * k, side: 41 * k };
  if (look.arrange === 'column') return { top: 18 * k, bottom: 18 * k, side: 18 * k };
  const e = (fam === 'box' ? 10 : 11) * k;
  return { top: e, bottom: e, side: 11 * k };
}
function badgeGaps(look, fam, kind, k) {
  if (look.gap != null) return { x: look.gap * k, y: look.gap * k, spread: false };
  if (fam === 'split') return { x: 10 * k, y: 7 * k, spread: false };
  if (look.arrange === 'column') return { x: 12 * k, y: (kind === 'backdrop' ? (fam === 'box' ? 22 : 23) : 24) * k, spread: false };
  if (look.skew !== 'none') return { x: 24 * k, y: 12 * k, spread: false };
  // RPDB spreads blocks evenly along the edge
  return { x: 12 * k, y: 12 * k, spread: true };
}
function rowsOf(tiles, look, fam, kind, avail, gapX) {
  if (look.arrange === 'column') return tiles.map((t) => [t]);
  let per;
  if (fam === 'split') per = kind === 'backdrop' ? tiles.length : kind === 'logo' ? (look.content === 'beside' ? 3 : 5) : look.content === 'beside' ? (look.size >= 1.2 ? 2 : 3) : (look.size >= 1.2 ? 4 : 5);
  const rows = [];
  let row = [];
  let wSum = 0;
  for (const t of tiles) {
    const full = per ? row.length >= per : row.length && wSum + gapX + t.w > avail;
    if (full) { rows.push(row); row = []; wSum = 0; }
    wSum += (row.length ? gapX : 0) + t.w;
    row.push(t);
  }
  if (row.length) rows.push(row);
  return rows;
}
/** Place tiles at an anchor inside W x H with margins; returns the drawn bbox. */
function placeTiles(tiles, look, fam, kind, k, W, H, env) {
  const m = env.margins || badgeMargins(look, fam, kind, k);
  const g = badgeGaps(look, fam, kind, k);
  const anchor = env.anchor || anchorOf(look.position);
  const ix = env.insetX || 0;
  const iy = env.insetY || 0;
  const L = m.side + (anchor.h === 'left' ? ix : 0);
  const R = W - m.side - (anchor.h === 'right' ? ix : 0);
  const rows = rowsOf(tiles, look, fam, kind, R - L, g.x);
  const rowH = rows.map((r) => Math.max(...r.map((t) => t.h + (t.extraH || 0))));
  const total = rowH.reduce((a, h) => a + h, 0) + (rows.length - 1) * g.y;
  const T = m.top + (anchor.v === 'top' ? iy : 0);
  const B = H - m.bottom - (anchor.v === 'bottom' ? iy : 0);
  let y = anchor.v === 'top' ? T : anchor.v === 'bottom' ? B - total : (T + B - total) / 2;
  const box = { x: W, y, w: 0, h: total };
  const column = look.arrange === 'column';
  const colW = Math.max(...tiles.map((t) => t.w));
  rows.forEach((row, ri) => {
    const sum = row.reduce((a, t) => a + t.w, 0);
    const spread = g.spread && !column && anchor.h === 'center';
    const gap = spread ? Math.max(10 * k, (W - sum) / (row.length + 1)) : g.x;
    const rw = sum + gap * (row.length - 1);
    let x = anchor.h === 'left' ? L : anchor.h === 'right' ? R - rw : spread ? (W - rw) / 2 : (L + R - rw) / 2;
    for (const t of row) {
      // Stacked tiles line up on the anchored side
      const tx = column ? (anchor.h === 'left' ? L : anchor.h === 'right' ? R - t.w : (L + R - colW) / 2 + (colW - t.w) / 2) : x;
      t.x = tx;
      t.y = y + (rowH[ri] - t.h - (t.extraH || 0)) / 2;
      box.x = Math.min(box.x, tx);
      box.w = Math.max(box.w, tx + t.w);
      x += t.w + gap;
    }
    y += rowH[ri] + g.y;
  });
  box.w -= box.x;
  return box;
}

// ---------- shared bar / panel ----------
// RPDB bar: one strip (full edge) or panel (fit) holding every rating. Poster bars measured at 580 wide, backdrop
// panels at 1920, logo strips at 780; row bars on backdrops are scaled up (not measured on RPDB).
function barDims(look, kind, k, column) {
  const fs = look.fontScale;
  const P = (v) => (look.padding != null ? look.padding * k : v);
  if (!column) {
    const b = kind === 'backdrop' ? 1.775 : 1;
    return { h: 84 * k * b, icon: 40 * k * b, iconGap: 18 * k * b, font: 40 * k * b * fs, gap: 34 * k * b, padX: P(kind === 'logo' ? 0 : 20 * k * b) };
  }
  if (kind === 'backdrop') return { w: 113 * k, icon: 71 * k, font: 36.6 * k * fs, gapIT: 16 * k, gapTI: 28 * k, padT: P(22 * k), padB: P(23 * k), side: 21 * k, mx: 33 * k, my: 26 * k };
  if (kind === 'logo') return { w: 85 * k, icon: 47 * k, font: 36.6 * k * fs, gapIT: 18 * k, gapTI: 29 * k, padT: P(8 * k), padB: P(8 * k), side: 14 * k, mx: 0, my: 0 };
  return { w: 85 * k, icon: 42 * k, font: 33 * k * fs, gapIT: 28 * k, gapTI: 31 * k, padT: P(17 * k), padB: P(17 * k), side: 14 * k, mx: 15 * k, my: 15 * k };
}
async function drawBar(ctx, list, look, kind, k, W, H, env) {
  const anchor = env.anchor || anchorOf(look.position);
  // Side bars need a left/right anchor; l/r positions are always side bars
  const column = look.arrange === 'column' ? anchor.h !== 'center' : look.position === 'l' || look.position === 'r';
  const d = barDims(look, kind, k, column);
  const mode = numbersMode(look, 'bar', kind, column);
  const showIcon = look.icons !== 'none';
  const text = look.icons === 'text';
  const imgs = await Promise.all(list.map((it) => (showIcon && !text ? iconOf(it, look, env.force) : null)));
  const vals = list.map((it) => valueText(it, mode));
  const fill = fillOf(look, 'bar', kind);
  const tc = textColor(look);
  const margin = look.margin != null ? look.margin * k : null;
  if (!column) {
    let groups = list.map((it, i) => {
      ctx.font = font(look, 'bar', d.font);
      const tw = ctx.measureText(vals[i]).width;
      const lw = !showIcon ? 0 : text ? (ctx.font = font(look, 'bar', d.font * 0.65), ctx.measureText(it.short).width) : iconW(imgs[i], d.icon, look);
      return { lw, tw, w: (showIcon ? lw + d.iconGap : 0) + tw };
    });
    // As on RPDB: nothing shrinks. Logo strips drop the ratings that do not fit; poster bars let long rows run off the edges.
    if (kind === 'logo') {
      let used = 0;
      groups = groups.filter((g, i) => (used += g.w + (i ? d.gap : 0)) <= W - 2 * d.padX || i === 0);
    }
    const total = groups.reduce((a, g) => a + g.w, 0) + d.gap * (groups.length - 1);
    const full = look.span === 'full';
    const mY = margin ?? (full ? 0 : 15 * k);
    const mX = margin ?? (full ? 0 : 15 * k);
    const pw = full ? W - 2 * (margin ?? 0) : total + 2 * Math.max(d.padX, 20 * k);
    const px = full ? margin ?? 0 : anchor.h === 'left' ? mX : anchor.h === 'right' ? W - mX - pw : (W - pw) / 2;
    const py = anchor.v === 'top' ? mY : anchor.v === 'bottom' ? H - mY - d.h : (H - d.h) / 2;
    const r = cornerOf(look, 'bar', d.h, k, full ? 'full' : 'fit');
    const skew = full ? 'none' : look.skew;
    paintFill(ctx, fill, () => { tilePath(ctx, px, py, pw, d.h, r, skew); ctx.fill(); });
    paintStroke(ctx, look.stroke === 'auto' || look.stroke === 'source' ? null : look.stroke === 'none' ? null : { color: look.stroke, alpha: 1, w: look.strokeWidth * k }, look.strokeSide, px, py, pw, d.h, r, skew);
    const inner = full ? [px + d.padX, px + pw - d.padX] : [px + (pw - total) / 2, px + (pw + total) / 2];
    let x = anchor.h === 'left' ? inner[0] : anchor.h === 'right' ? inner[1] - total : (inner[0] + inner[1] - total) / 2;
    ctx.textBaseline = 'middle';
    groups.forEach((g, i) => {
      if (showIcon) {
        if (text) { ctx.font = font(look, 'bar', d.font * 0.65); ctx.fillStyle = tc; ctx.fillText(list[i].short, x, py + d.h / 2); } else drawIcon(ctx, imgs[i], x, py + (d.h - d.icon) / 2, g.lw, d.icon);
      }
      ctx.font = font(look, 'bar', d.font);
      ctx.fillStyle = tc;
      ctx.fillText(vals[i], x + (showIcon ? g.lw + d.iconGap : 0), py + d.h / 2);
      x += g.w + d.gap;
    });
    return { x: px, y: py, w: pw, h: d.h };
  }
  // Column (side bar / panel): icon above value; ratings that do not fit are dropped, as on RPDB
  const cap = d.font * CAP;
  ctx.font = font(look, 'bar', d.font);
  const tws = vals.map((v) => ctx.measureText(v).width);
  const iconSize = showIcon ? (text ? d.font * 0.65 : d.icon) : 0;
  const lws = list.map((it, i) => (!showIcon ? 0 : text ? (ctx.font = font(look, 'bar', d.font * 0.65), ctx.measureText(it.short).width) : iconW(imgs[i], d.icon, look)));
  const itemH = (showIcon ? iconSize + d.gapIT : 0) + cap;
  const full = look.span === 'full';
  const mX = margin ?? (full ? 0 : d.mx);
  const mY = margin ?? (full ? 0 : d.my);
  const space = H - (full ? 0 : 2 * mY) - d.padT - d.padB;
  const n = Math.max(1, Math.min(list.length, Math.floor((space + d.gapTI) / (itemH + d.gapTI))));
  const stack = n * itemH + (n - 1) * d.gapTI;
  const pw = Math.max(d.w, ...tws.slice(0, n).map((t) => t + 2 * d.side), ...lws.slice(0, n).map((l) => l + 2 * d.side));
  const left = anchor.h === 'left';
  const px = left ? mX : W - mX - pw;
  const ph = full ? H : d.padT + stack + d.padB;
  const py = full ? 0 : anchor.v === 'top' ? mY : anchor.v === 'bottom' ? H - mY - ph : (H - ph) / 2;
  const r = cornerOf(look, 'bar', ph, k, full ? 'full' : 'fit');
  const skew = full ? 'none' : look.skew;
  paintFill(ctx, fill, () => { tilePath(ctx, px, py, pw, ph, r > pw / 2 ? pw / 2 : r, skew); ctx.fill(); });
  paintStroke(ctx, ['auto', 'source', 'none'].includes(look.stroke) ? null : { color: look.stroke, alpha: 1, w: look.strokeWidth * k }, look.strokeSide, px, py, pw, ph, r, skew);
  let y = full ? (anchor.v === 'top' ? d.padT : anchor.v === 'bottom' ? H - d.padB - stack : (H - stack) / 2) : py + d.padT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const cx = px + pw / 2;
  for (let i = 0; i < n; i++) {
    if (showIcon) {
      if (text) { ctx.font = font(look, 'bar', d.font * 0.65); ctx.fillStyle = tc; ctx.fillText(list[i].short, cx, y + iconSize); } else drawIcon(ctx, imgs[i], cx - lws[i] / 2, y, lws[i], d.icon);
    }
    ctx.font = font(look, 'bar', d.font);
    ctx.fillStyle = tc;
    ctx.fillText(vals[i], cx, y + itemH);
    y += itemH + d.gapTI;
  }
  ctx.textAlign = 'left';
  return { x: px, y: py, w: pw, h: ph, side: left ? 'left' : 'right' };
}

/** Draw the picked ratings with a look; returns the bbox of the drawn overlay (null when nothing drawn). */
async function drawRatings(ctx, list, look, kind, k, W, H, env = {}) {
  if (!list.length) return null;
  const fam = familyOf(look);
  if (fam === 'bar') return drawBar(ctx, list, look, kind, k, W, H, env);
  const tiles = fam === 'split' ? await splitTiles(ctx, list, look, kind, k, env.force) : await blockTiles(ctx, list, look, kind, k, env.force);
  const box = placeTiles(tiles, look, fam, kind, k, W, H, env);
  for (const t of tiles) t.paint(t.x, t.y);
  return box;
}

// ---------- media badges and labels ----------
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// Media badges (RPDB layout) move clear of the ratings when they would overlap, on the edge the ratings sit on.
async function drawMedia(ctx, media, box, look, kind, W, H, extraInset = {}) {
  if (!media?.files?.length) return [];
  const metrics = kind === 'backdrop' ? backdropBadgeMetrics(W, media.small) : posterBadgeMetrics(W, media.small);
  const anchor = parseBadgePos(media.pos || (kind === 'backdrop' ? 'left-top' : ''), kind);
  const max = Number(media.max) > 0 ? Number(media.max) : media.files.length;
  const opts = { W, H, metrics, anchor, max, inset: { ...extraInset } };
  if (box && layoutBadges(Math.min(max, media.files.length), opts).some((r) => overlaps(r, box))) {
    const a = anchorOf(look.position);
    const side = look.arrange === 'column' || look.position === 'l' || look.position === 'r';
    if (side && a.h === 'left') opts.inset.left = box.x + box.w;
    else if (side && a.h === 'right') opts.inset.right = W - box.x;
    else if (a.v === 'top') opts.inset.top = box.y + box.h;
    else if (a.v === 'bottom') opts.inset.bottom = H - box.y;
  }
  return drawMediaBadges(ctx, media.files, opts);
}
// Label: RPDB draws a full-width strip on the side away from the bar; OPDB a dark pill.
function drawLabel(ctx, text, look, k, W, H) {
  const atBottom = anchorOf(look.position).v === 'top';
  if (look.layout === 'bar') {
    const bh = 84 * k;
    const y = atBottom ? H - bh : 0;
    paintFill(ctx, fillOf({ ...look, fill: look.fill === 'none' ? 'dark' : look.fill }, 'bar', 'poster'), () => ctx.fillRect(0, y, W, bh));
    ctx.font = font(look, 'bar', 40 * k);
    ctx.fillStyle = textColor(look);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, y + bh / 2, W - 20 * k);
    ctx.textAlign = 'left';
    return;
  }
  ctx.font = `${30 * k}px ${INTER}`;
  const tw = ctx.measureText(text).width;
  const padX = Math.round(18 * k);
  const h = Math.round(50 * k);
  const w = Math.min(W - 20 * k, tw + padX * 2);
  const x = (W - w) / 2;
  const y = atBottom ? H - h - Math.round(14 * k) : Math.round(14 * k);
  roundRect(ctx, x, y, w, h, Math.round(10 * k));
  ctx.fillStyle = 'rgba(0,0,0,0.75)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, (W - Math.min(tw, w - padX * 2)) / 2, y + h / 2, w - padX * 2);
}

// ---------- images ----------
function placeholder(ctx, W, H) {
  const grad = ctx.createLinearGradient(0, 0, W * 0.3, H);
  grad.addColorStop(0, '#2b3245');
  grad.addColorStop(1, '#0e1016');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}
function drawCover(ctx, img, W, H) {
  const s = Math.max(W / img.width, H / img.height);
  ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
}
/** Poster frame: native shape, OPDB 2:3 fits (cover / pad / blur) or RPDB's 1:1.481 cover. */
function posterCanvas(art, W, frame) {
  if (!art) {
    const c = createCanvas(W, Math.round(W * (frame === 'rpdb' ? 1.481 : 1.5)));
    placeholder(c.getContext('2d'), c.width, c.height);
    return c;
  }
  if (frame === 'native') {
    const c = createCanvas(W, Math.max(1, Math.round((art.height * W) / art.width)));
    c.getContext('2d').drawImage(art, 0, 0, c.width, c.height);
    return c;
  }
  const H = Math.round(W * (frame === 'rpdb' ? 1.481 : 1.5));
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  if (frame === 'cover' || frame === 'rpdb') { drawCover(ctx, art, W, H); return c; }
  const cover = Math.max(W / art.width, H / art.height);
  const contain = Math.min(W / art.width, H / art.height);
  if (frame === 'pad') {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  } else {
    // Blur: a heavily downscaled cover copy, scaled back up, fills the bars
    const small = createCanvas(Math.max(1, Math.round(W / 24)), Math.max(1, Math.round(H / 24)));
    small.getContext('2d').drawImage(art, (small.width - (art.width * cover) / 24) / 2, (small.height - (art.height * cover) / 24) / 2, (art.width * cover) / 24, (art.height * cover) / 24);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
  }
  ctx.drawImage(art, (W - art.width * contain) / 2, (H - art.height * contain) / 2, art.width * contain, art.height * contain);
  return c;
}
const widthOf = (kind, look, width) => Math.round(width || IMAGE_WIDTHS[kind][look.imageSize]);

/**
 * Poster: art (Buffer or null) + ratings (items from ratingItems) drawn with design.poster.
 * media: RPDB media badges { files, pos, small, max }; label: Badges / Label text (not drawn with badges, as on RPDB).
 * force: Create Poster certification icons. Returns a JPEG buffer.
 */
export async function renderPoster({ art, items = {}, design, width, quality = 90, media = null, label, force = {} }) {
  const d = sanitizeDesign(design);
  const look = d.poster;
  const W = Math.max(200, Math.min(2000, widthOf('poster', look, width)));
  const canvas = posterCanvas(art ? await loadImage(art) : null, W, look.frame);
  const H = canvas.height;
  const ctx = canvas.getContext('2d');
  const k = (W / BASE.poster) * look.size;
  const text = label ?? d.label;
  const withMedia = Boolean(media?.files?.length);
  if (text && !withMedia && look.layout === 'bar') drawLabel(ctx, String(text).slice(0, 40), look, W / BASE.poster, W, H);
  const list = pickRatings(items, { order: d.order, exclude: d.exclude, limit: look.limit });
  const box = await drawRatings(ctx, list, look, 'poster', k, W, H, { force });
  const drawn = await drawMedia(ctx, media, box, look, 'poster', W, H);
  if (text && !drawn.length && look.layout !== 'bar') drawLabel(ctx, String(text).slice(0, 40), look, k, W, H);
  return canvas.encode('jpeg', quality);
}

// Must-See / Certified Fresh badges in a top corner (order mirrors on the right, clear of a panel on that side).
async function drawCertBadges(ctx, items, look, force, k, W, box) {
  if (look.certBadges === 'none') return null;
  const files = [];
  if ((items.mc?.n || 0) >= 81 || force.mc) files.push('metacritic-mustsee');
  if (((items.rt?.n || 0) >= 75 && force.rt !== -1) || force.rt > 0) files.push('tomatoes-certified');
  if (!files.length) return null;
  const size = 118 * k;
  const top = 27 * k;
  const gap = 40 * k;
  const right = look.certBadges === 'right';
  if (right) files.reverse();
  const width = files.length * size + (files.length - 1) * gap;
  const overlap = box && box.y < top + size && box.y + box.h > top;
  const x0 = right
    ? (overlap && box.x + box.w > W / 2 ? box.x : W) - gap - width
    : (overlap && box.x < W / 2 ? box.x + box.w : 0) + gap;
  for (let i = 0; i < files.length; i++) drawIcon(ctx, await loadIcon(`ratings/square/${files[i]}.png`), x0 + i * (size + gap), top, size, size);
  return { x: x0, y: top, w: width, h: size, side: right ? 'right' : 'left' };
}

/** Backdrop: art (native aspect or RPDB's 16:9) + ratings with design.backdrop + optional certification and media badges. */
export async function renderBackdrop({ art, items = {}, design, width, quality = 90, media = null, force = {} }) {
  const d = sanitizeDesign(design);
  const look = d.backdrop;
  const img = art ? await loadImage(art) : null;
  const W = Math.max(640, Math.min(3840, widthOf('backdrop', look, width)));
  const H = img && look.frame === 'native' ? Math.max(1, Math.round((img.height * W) / img.width)) : Math.round((W * 9) / 16);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (!img) placeholder(ctx, W, H);
  else if (look.frame === 'native') ctx.drawImage(img, 0, 0, W, H);
  else drawCover(ctx, img, W, H);
  const k = (W / BASE.backdrop) * look.size;
  const list = pickRatings(items, { order: d.order, exclude: d.exclude, limit: look.limit });
  const box = await drawRatings(ctx, list, look, 'backdrop', k, W, H, { force, insetX: Math.round((W * look.insetX) / 100), insetY: Math.round((H * look.insetY) / 100) });
  const certs = await drawCertBadges(ctx, items, look, force, W / BASE.backdrop, W, box);
  const inset = {};
  // RPDB stacks media badges below the certification badges (first tile at y=173 on 1920 wide)
  const anchor = parseBadgePos(media?.pos || 'left-top', 'backdrop');
  if (certs && anchor.v === 'top' && anchor.h === certs.side) inset.top = certs.y + certs.h + 28 * (W / BASE.backdrop) - backdropBadgeMetrics(W, media?.small).margin;
  await drawMedia(ctx, media, box, look, 'backdrop', W, H, inset);
  return canvas.encode('jpeg', quality);
}

function placeholderLogo() {
  const c = createCanvas(780, 200);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = `150px ${INTER}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TITLE', 390, 105);
  return c;
}

/**
 * Logo: transparent PNG, logo plus ratings above / below / beside it (design.logo).
 * Frame "fit" sizes the canvas to the content (OpenPosterDB); "fixed" is RPDB's W x 0.3128W canvas.
 */
export async function renderLogo({ logo, items = {}, design, width, force = {} }) {
  const d = sanitizeDesign(design);
  const look = d.logo;
  const W = Math.max(200, Math.min(2689, widthOf('logo', look, width)));
  const k = (W / BASE.logo) * look.size;
  const img = logo ? await loadImage(logo) : placeholderLogo();
  const list = pickRatings(items, { order: d.order, exclude: d.exclude, limit: look.limit });
  const a = anchorOf(look.position);
  const side = look.arrange === 'column' && a.h !== 'center';
  const fam = familyOf(look);
  // Ratings region: measured on a scratch canvas with the region's own anchor
  const scratch = createCanvas(1, 1).getContext('2d');
  let rw = 0;
  let rh = 0;
  if (list.length) {
    if (fam === 'bar') {
      const bd = barDims(look, 'logo', k, side);
      rw = side ? bd.w : W;
      rh = side ? 0 : bd.h;
    } else {
      const tiles = fam === 'split' ? await splitTiles(scratch, list, look, 'logo', k, force) : await blockTiles(scratch, list, look, 'logo', k, force);
      const box = placeTiles(tiles, look, fam, 'logo', k, side ? 100000 : W, 100000, { anchor: { h: 'left', v: 'top' }, margins: { top: 0, bottom: 0, side: 0 } });
      rw = box.w;
      rh = box.h + (fam === 'split' ? 0 : 22 * k);
    }
  }
  const spacing = list.length ? (look.frame === 'fit' ? 15 * k : 0) : 0;
  let cw;
  let ch;
  let area;
  let region;
  if (look.frame === 'fixed') {
    cw = W;
    ch = Math.round(W * 0.3128);
    if (side) { region = { x: a.h === 'left' ? 0 : W - rw, y: 0, w: rw, h: ch }; area = { x: a.h === 'left' ? rw : 0, y: 0, w: W - rw, h: ch }; } else {
      region = { x: 0, y: a.v === 'top' ? 0 : ch - rh, w: W, h: rh };
      area = { x: 0, y: a.v === 'top' ? rh : 0, w: W, h: ch - rh };
    }
    if (!list.length) area = { x: 0, y: 0, w: cw, h: ch };
  } else {
    const lh = Math.max(1, Math.round((img.height * W) / img.width));
    if (side) {
      const sideH = fam === 'bar' ? lh : Math.max(lh, rh);
      cw = W + rw + spacing;
      ch = Math.max(lh, sideH);
      region = { x: a.h === 'left' ? 0 : W + spacing, y: 0, w: rw, h: ch };
      area = { x: a.h === 'left' ? rw + spacing : 0, y: (ch - lh) / 2, w: W, h: lh };
    } else {
      cw = Math.max(W, Math.ceil(rw));
      ch = Math.ceil(lh + spacing + rh);
      region = { x: 0, y: a.v === 'top' ? 0 : lh + spacing, w: cw, h: rh };
      area = { x: (cw - W) / 2, y: a.v === 'top' ? rh + spacing : 0, w: W, h: lh };
    }
  }
  const canvas = createCanvas(Math.max(1, Math.round(cw)), Math.max(1, Math.round(ch)));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const s = Math.min(area.w / img.width, area.h / img.height);
  ctx.drawImage(img, area.x + (area.w - img.width * s) / 2, area.y + (area.h - img.height * s) / 2, img.width * s, img.height * s);
  if (list.length && region.w > 0 && region.h > 0) {
    ctx.save();
    ctx.translate(region.x, region.y);
    const anchor = side ? { h: a.h, v: a.v } : { h: a.h, v: fam === 'bar' ? 'top' : 'center' };
    await drawRatings(ctx, list, look, 'logo', k, region.w, region.h, { force, anchor, margins: { top: 0, bottom: 0, side: 0 } });
    ctx.restore();
  }
  return canvas.encode('png');
}
