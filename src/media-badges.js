import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImage } from '@napi-rs/canvas';
import { countryForLang, normLang } from './badges.js';

// RPDB media badges (4K, HDR, flags...) drawn from the recreated icon pack in static/icons.
const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
const list = (dir) => { try { return new Set(fs.readdirSync(path.join(ICONS, dir)).map((f) => f.replace(/\.png$/, ''))); } catch { return new Set(); } };
const BADGE_FILES = list('badges');
const FLAG_FILES = list('flags');

const US_CERTS = {
  G: 'g', PG: 'pg', 'PG-13': 'pg_13', R: 'r', 'NC-17': 'nc_17', NR: 'nr', 'NOT RATED': 'nr', UNRATED: 'nr',
  'TV-Y': 'tv_y', 'TV-Y7': 'tv_y7', 'TV-G': 'tv_g', 'TV-PG': 'tv_pg', 'TV-14': 'tv_14', 'TV-MA': 'tv_ma',
};

const flag = (cc) => (cc && FLAG_FILES.has(cc.toLowerCase()) ? `flags/${cc.toLowerCase()}.png` : null);

/**
 * Badge tags (RPDB "badges" CSV) -> icon files relative to static/icons.
 * info: { certification, commonsense, language, country } from MDBList, for RPDB's server-side tags.
 */
export function resolveBadgeTags(csv, info = {}) {
  const out = [];
  for (const raw of String(csv || '').split(',')) {
    const tag = raw.trim();
    if (!tag) continue;
    let file = null;
    if (tag === 'us_age_rating' || tag === 'us_age_rating_gold') {
      const c = US_CERTS[String(info.certification || '').trim().toUpperCase()];
      if (c) file = `badges/${c}${tag.endsWith('_gold') ? '_gold' : ''}.png`;
    } else if (tag === 'commonsense' || tag === 'commonsensegold') {
      const age = Math.round(Number(info.commonsense));
      if (age > 0) file = `badges/age${Math.min(18, Math.max(2, age))}${tag.endsWith('gold') ? 'gold' : ''}.png`;
    } else if (tag === 'auto_lang' || tag === 'auto_lang_no_en') {
      const lang = normLang(info.language);
      if (lang && !(tag === 'auto_lang_no_en' && lang === 'en')) file = flag(countryForLang(lang, info.country));
    } else if (tag.startsWith('country.')) {
      // Auto badges give "country.US", the manual picker "country.en_US"
      file = flag(tag.slice(8).split('_').pop());
    } else if (BADGE_FILES.has(tag)) {
      file = `badges/${tag}.png`;
    }
    if (file && !out.includes(file)) out.push(file);
  }
  return out;
}

const tiles = new Map();
export function loadTile(file) {
  if (!tiles.has(file)) tiles.set(file, loadImage(path.join(ICONS, file)).catch(() => null));
  return tiles.get(file);
}

// Measured from RPDB renders: 580px poster tiles 121x82, gap 20, margin 15; "small" is x0.72.
export function posterBadgeMetrics(W, small) {
  const k = W / 580;
  const t = small ? 0.72 : 1;
  return { w: 121 * k * t, h: 82 * k * t, gap: 20 * k * t, margin: 15 * k };
}
// RPDB backdrops (1920 wide): tiles 115x78, pitch 108, left margin 40.
export function backdropBadgeMetrics(W, small) {
  const k = W / 1920;
  const t = small ? 0.72 : 1;
  return { w: 115 * k * t, h: 78 * k * t, gap: 30 * k * t, margin: 40 * k };
}

/** Poster ("left", "bottom|center") or backdrop ("right-top", "center-bottom") position -> anchors. */
export function parseBadgePos(pos, kind = 'poster') {
  const p = String(pos || '');
  if (kind === 'backdrop') {
    const [hz, vt] = p.split('-');
    const h = ['left', 'center', 'right'].includes(hz) ? hz : 'left';
    const v = ['top', 'center', 'bottom'].includes(vt) ? vt : 'top';
    return { h, v, row: h === 'center' };
  }
  const bottom = p.startsWith('bottom|');
  const hz = bottom ? p.slice(7) : p;
  const h = ['left', 'center', 'right'].includes(hz) ? hz : 'left';
  return { h, v: bottom ? 'bottom' : 'top', row: h === 'center' };
}

/** Rectangles for n tiles; inset keeps them clear of the rating overlay on each side. */
export function layoutBadges(n, { W, H, metrics, anchor, inset = {} }) {
  const { w, h, gap, margin } = metrics;
  const L = margin + (inset.left || 0);
  const R = W - margin - (inset.right || 0);
  const T = margin + (inset.top || 0);
  const B = H - margin - (inset.bottom || 0);
  const totalW = anchor.row ? n * w + (n - 1) * gap : w;
  const totalH = anchor.row ? h : n * h + (n - 1) * gap;
  const x0 = anchor.h === 'left' ? L : anchor.h === 'right' ? R - totalW : (L + R - totalW) / 2;
  const y0 = anchor.v === 'top' ? T : anchor.v === 'bottom' ? B - totalH : (T + B - totalH) / 2;
  return Array.from({ length: n }, (_, i) => ({
    x: Math.round(anchor.row ? x0 + i * (w + gap) : x0),
    y: Math.round(anchor.row ? y0 : y0 + i * (h + gap)),
    w: Math.round(w),
    h: Math.round(h),
  }));
}

/** Draw resolved badge files; returns the rectangles used (empty when nothing drawn). */
export async function drawMediaBadges(ctx, files, opts) {
  const max = Number(opts.max) > 0 ? Number(opts.max) : files.length;
  const imgs = (await Promise.all(files.slice(0, max).map(loadTile))).filter(Boolean);
  if (!imgs.length) return [];
  const rects = layoutBadges(imgs.length, opts);
  imgs.forEach((img, i) => ctx.drawImage(img, rects[i].x, rects[i].y, rects[i].w, rects[i].h));
  return rects;
}
