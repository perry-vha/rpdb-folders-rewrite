import { mdblistRatings } from './ratings.js';
import { renderPoster, renderBackdrop, renderLogo, ratingItems, createPosterScores } from './compose.js';
import { sanitizeDesign, designFromRpdb, rpdbOrder, DESIGN_DEFAULTS } from './look.js';
import { resolveBadgeTags } from './media-badges.js';
import { pick } from './rpdb.js';
import { STYLE_SUFFIXES, IMAGE_KINDS } from './config.js';

const TMDB_IMG = 'https://image.tmdb.org/t/p/w780';
const TMDB_BASE = 'https://image.tmdb.org/t/p';

const cap = (s) => s[0].toUpperCase() + s.slice(1);
/** The item's RPDB Image Styles (item map beats folder map), keyed like the folder maps (posterTheme, backdropCertPos...). */
export function storedStyles(cfg, imdb, root) {
  const out = {};
  for (const kind of IMAGE_KINDS) {
    for (const s of [...STYLE_SUFFIXES, ...(kind === 'backdrop' ? ['CertPos'] : [])]) {
      const v = pick(cfg, `item${cap(kind)}${s}`, `${kind}${s}`, imdb, root);
      if (v !== undefined) out[`${kind}${s}`] = v;
    }
  }
  return out;
}

/** RPDB engine: the unified design equivalent of the stored Image Styles and Poster Settings. */
export function rpdbDesignFor(cfg, root, imdb, type = 'movie') {
  return designFromRpdb(storedStyles(cfg, imdb, root), cfg[`${type}PosterType`], cfg[`${type}RatingOrder`]);
}

/** Local design for an item: item override > folder override > global default (legacy designs converted on read). */
export function designFor(cfg, root, imdb, type = 'movie') {
  const raw = (imdb && cfg.itemDesigns?.[imdb]) || (root && cfg.folderDesigns?.[root]) || cfg.localDesign || DESIGN_DEFAULTS;
  return sanitizeDesign(raw, { fromRpdb: () => rpdbDesignFor(cfg, root, imdb, type) });
}

/** Saved poster choice (RPDB URL template): a TMDB file, a custom image URL or Create Poster ratings. */
export function parsePosterTemplate(template) {
  if (!template) return null;
  const tm = /\/tmdb-poster\/\[\[imdb-id\]\]\/([^?#]+)/.exec(template);
  if (tm) return { kind: 'tmdb', file: tm[1].split('/').map(decodeURIComponent).join('/') };
  let u;
  try { u = new URL(template.replace(/\[\[[\w-]+\]\]/g, 'x')); } catch { return null; }
  const img = u.searchParams.get('img');
  const safeImg = img && /^https?:\/\//i.test(img) ? img : null;
  if (u.pathname.includes('/custom-poster/')) return safeImg ? { kind: 'custom', img: safeImg } : null;
  const cp = /\/imdb\/([\w-]+)\/create-poster\//.exec(u.pathname);
  if (cp) return { kind: 'create', posterType: cp[1], img: safeImg, query: Object.fromEntries(u.searchParams) };
  return null;
}

const toW780 = (url) => (/^https:\/\/image\.tmdb\.org\/t\/p\/[^/]+\//.test(url) ? url.replace(/\/t\/p\/[^/]+\//, '/t/p/w780/') : url);

const artCache = new Map();
async function fetchArt(url) {
  if (artCache.has(url)) return artCache.get(url);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Artwork HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  artCache.set(url, buf);
  if (artCache.size > 40) artCache.delete(artCache.keys().next().value);
  return buf;
}

// Saved choice > textless > preferred / secondary poster language (TMDB) > MDBList's default poster.
async function artUrlFor({ cfg, matcher, type, imdb, data, design }) {
  const saved = parsePosterTemplate(cfg.customPosters?.[imdb]);
  if (saved?.kind === 'tmdb') return `${TMDB_IMG}/${saved.file.replace(/^\/+/, '')}`;
  if (saved?.img) return saved.img;
  const textless = design.textless || cfg[`${type}Textless`];
  const langs = [cfg.posterLang?.[type], cfg.posterSecLang?.[type]].filter((l) => l && l !== 'en');
  if ((textless || langs.length) && matcher?.hasTmdb()) {
    try {
      const choices = await matcher.posterChoices(type, imdb);
      const best = (list) => [...list].sort((a, b) => (b.vote || 0) - (a.vote || 0))[0];
      const hit = (textless && best(choices.filter((p) => !p.code)))
        || langs.map((l) => { const [base, region] = l.split('-'); return best(choices.filter((p) => p.code === base && (!region || p.region === region.toUpperCase()))); }).find(Boolean);
      if (hit) return `${TMDB_IMG}${hit.file_path}`;
    } catch { /* fall back to the default poster */ }
  }
  return data.poster ? toW780(data.poster) : null;
}

/**
 * The item's Badges / Label settings resolved to icon files. badgeCsv: auto badges from probing;
 * otherwise the stored manual badges apply (same precedence as the RPDB query). over: unsaved dialog values.
 */
export function mediaFor(cfg, { kind = 'poster', imdb, root, badgeCsv, info, over = {} }) {
  const csv = over.badges ?? (badgeCsv || pick(cfg, 'itemBadges', 'badges', imdb, root));
  const small = (over.badgeSize ?? pick(cfg, 'itemBadgeSizes', 'badgeSizes', imdb, root)) === 'small';
  if (kind === 'backdrop') {
    if (!cfg.backdropsBadges) return null;
    return { files: resolveBadgeTags(csv, info), small, pos: pick(cfg, 'itemBackdropBadgePositions', 'backdropBadgePositions', imdb, root), max: pick(cfg, 'itemBackdropMaxBadges', 'backdropMaxBadges', imdb, root) };
  }
  return {
    files: resolveBadgeTags(csv, info), small,
    pos: over.badgePos ?? pick(cfg, 'itemBadgePositions', 'badgePositions', imdb, root),
    max: over.maxBadges ?? pick(cfg, 'itemMaxBadges', 'maxBadges', imdb, root),
  };
}

/**
 * Render a poster for an item with local data (MDBList ratings + TMDB artwork) and its design.
 * Create Poster choices use their own ratings, certifications and poster type's rating order.
 */
export async function renderLocalPoster({ cfg, matcher, type, imdb, root, design, width, badgeCsv, over = {} }) {
  if (!cfg.mdblistKey) throw new Error('Local posters need an MDBList API key (API Keys).');
  let d = sanitizeDesign(design || designFor(cfg, root, imdb, type));
  const data = await mdblistRatings(cfg.mdblistKey, type, imdb);
  const url = await artUrlFor({ cfg, matcher, type, imdb, data, design: d });
  if (!url) return null;
  const art = await fetchArt(url);
  const media = mediaFor(cfg, { imdb, root, badgeCsv, info: data.info, over });
  const label = over.label ?? pick(cfg, 'itemLabels', 'labels', imdb, root);
  const saved = parsePosterTemplate(cfg.customPosters?.[imdb]);
  if (saved?.kind === 'create') {
    const { scores, force } = createPosterScores(saved.query);
    const o = rpdbOrder(saved.posterType);
    d = sanitizeDesign({ ...d, order: o.order, exclude: o.exclude, poster: { ...d.poster, certIcons: o.certIcons } });
    return renderPoster({ art, items: ratingItems({ scores, info: data.info }), design: d, width, media, label, force });
  }
  return renderPoster({ art, items: ratingItems(data), design: d, width, media, label });
}

/** Backdrop (JPEG) or logo (PNG) for an item from TMDB artwork + MDBList ratings; null when TMDB has none. */
export async function renderLocalArt({ cfg, matcher, kind, type, imdb, root, design, width, badgeCsv }) {
  if (!cfg.mdblistKey) throw new Error('Local images need an MDBList API key (API Keys).');
  if (!matcher?.hasTmdb()) throw new Error('Local backdrops and logos need a TMDB API key (API Keys).');
  const d = sanitizeDesign(design || designFor(cfg, root, imdb, type));
  const data = await mdblistRatings(cfg.mdblistKey, type, imdb);
  const choice = await matcher.artChoices(type, imdb, kind === 'logo' ? cfg.posterLang?.[type] || 'en' : 'en');
  const file = kind === 'logo' ? choice.logo : choice.backdrop;
  if (!file) return null;
  const buf = await fetchArt(`${TMDB_BASE}/original${file}`);
  const items = ratingItems(data);
  if (kind === 'logo') return renderLogo({ logo: buf, items, design: d, width });
  return renderBackdrop({ art: buf, items, design: d, width, media: mediaFor(cfg, { kind, imdb, root, badgeCsv, info: data.info }) });
}
