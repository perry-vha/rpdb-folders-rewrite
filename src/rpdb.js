import { STYLE_SUFFIXES } from './config.js';

export const RPDB_BASE = () => (process.env.RPDB_BASE_URL || 'https://api.ratingposterdb.com').replace(/\/+$/, '');
export const DEFAULT_RPDB_BASE = 'https://api.ratingposterdb.com';

export const STYLE_PARAMS = {
  Size: 'imageSize', Theme: 'theme', BarPos: 'ratingBarPos', FontSize: 'fontScale', FontWeight: 'fontWeight',
  TextStyle: 'textStyle', LogoStyle: 'logoStyle', BarOpacity: 'ratingBarOpacity', BarColor: 'ratingBarColor',
  FontColor: 'fontColor', BarPadding: 'ratingBarPadding', BarMargin: 'ratingBarMargin',
  BarRoundness: 'ratingBarRoundness', BarStrokeColor: 'ratingBarStrokeColor', BarStrokeWidth: 'ratingBarStrokeWidth',
  BarStrokeSide: 'strokeSide', BarSkewDirection: 'ratingBarSkewDirection',
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const enc = encodeURIComponent;
const has = (v) => v !== undefined && v !== null && v !== '';

export function posterPathType(type, cfg) {
  const t = cfg[`${type}PosterType`] || 'poster-default';
  if (t !== 'rating-order' && cfg[`${type}Textless`]) return t.replace(/^poster-/, 'textless-');
  return t;
}

export function orderParam(type, cfg) {
  const t = cfg[`${type}PosterType`] || 'poster-default';
  if (t === 'poster-rt') return 'myanimelist,imdb,tomatoes-critics,tomatoes-audience';
  if (t === 'poster-mc') return 'myanimelist,imdb,metacritic-critics,metacritic-audience';
  if (t === 'rating-order') return cfg[`${type}RatingOrder`] || '';
  return '';
}

/** Item-level value (keyed by IMDb ID) wins over the media-folder-level value. */
export function pick(cfg, itemKey, folderKey, imdb, root) {
  const iv = cfg[itemKey]?.[imdb];
  if (has(iv)) return iv;
  const fv = cfg[folderKey]?.[root];
  return has(fv) ? fv : undefined;
}

function styleParams(cfg, kind, imdb, root) {
  const parts = [];
  for (const s of STYLE_SUFFIXES) {
    const v = pick(cfg, `item${cap(kind)}${s}`, `${kind}${s}`, imdb, root);
    if (has(v)) parts.push(`${STYLE_PARAMS[s]}=${enc(v)}`);
  }
  return parts;
}

/**
 * Build the query string (without "?") for an image.
 * kind: poster | backdrop | logo. opts.badges overrides stored manual badges (auto badge list).
 * opts.noLabel omits the label.
 */
export function buildQuery(cfg, { kind, type, imdb, root, badges, noLabel = false }) {
  const p = [];
  const lang = cfg.posterLang?.[type];
  const secLang = cfg.posterSecLang?.[type];
  const order = orderParam(type, cfg);
  const manual = pick(cfg, 'itemBadges', 'badges', imdb, root);
  const badgeList = has(badges) ? badges : manual;

  if (kind === 'poster') {
    if (has(lang) && lang !== 'en') p.push(`lang=${enc(lang)}`);
    if (has(secLang) && secLang !== 'en') p.push(`secLang=${enc(secLang)}`);
    const label = pick(cfg, 'itemLabels', 'labels', imdb, root);
    if (!noLabel && has(label)) p.push(`label=${enc(label)}`);
    if (has(badgeList)) p.push(`badges=${enc(badgeList)}`);
    const pos = pick(cfg, 'itemBadgePositions', 'badgePositions', imdb, root);
    if (has(pos)) p.push(`badgePos=${enc(pos)}`);
    const max = pick(cfg, 'itemMaxBadges', 'maxBadges', imdb, root);
    if (has(max)) p.push(`maxBadges=${enc(max)}`);
    const size = pick(cfg, 'itemBadgeSizes', 'badgeSizes', imdb, root);
    if (has(size)) p.push(`badgeSize=${enc(size)}`);
  } else if (kind === 'backdrop') {
    if (cfg.backdropsBadges) {
      if (has(badgeList)) p.push(`badges=${enc(badgeList)}`);
      const pos = pick(cfg, 'itemBackdropBadgePositions', 'backdropBadgePositions', imdb, root);
      if (has(pos)) p.push(`badgePos=${enc(pos)}`);
      const max = pick(cfg, 'itemBackdropMaxBadges', 'backdropMaxBadges', imdb, root);
      if (has(max)) p.push(`maxBadges=${enc(max)}`);
    }
  } else {
    if (has(lang) && lang !== 'en') p.push(`lang=${enc(lang)}`);
    if (has(secLang) && secLang !== 'en') p.push(`secLang=${enc(secLang)}`);
  }

  p.push(...styleParams(cfg, kind, imdb, root));
  if (kind === 'backdrop') {
    const cp = pick(cfg, 'itemBackdropCertPos', 'backdropCertPos', imdb, root);
    if (has(cp)) p.push(`certsPos=${enc(cp)}`);
  }
  if (order) p.push(`order=${enc(order)}`);
  return p.join('&');
}

const withQuery = (url, q) => (q ? `${url}${url.includes('?') ? '&' : '?'}${q}` : url);

/**
 * Build the download URL.
 * source: undefined | {kind:'tmdb', path} ; customTemplate: stored template string.
 */
export function buildImageUrl(cfg, { kind, type, imdb, root, badges, source, customTemplate }) {
  const base = RPDB_BASE();
  const key = cfg.apiKey;
  const q = buildQuery(cfg, { kind, type, imdb, root, badges });
  if (kind === 'backdrop') return withQuery(`${base}/${key}/imdb/backdrop-default/${imdb}.jpg`, q);
  if (kind === 'logo') return withQuery(`${base}/${key}/imdb/logo-default/${imdb}.png`, q);
  const pt = posterPathType(type, cfg);
  if (source?.kind === 'tmdb') return withQuery(`${base}/${key}/imdb/${pt}/tmdb-poster/${imdb}/${String(source.path).replace(/^\/+/, '')}`, q);
  if (customTemplate) return withQuery(fillTemplate(customTemplate, { base, key, pt, imdb }), q);
  return withQuery(`${base}/${key}/imdb/${pt}/${imdb}.jpg`, q);
}

function fillTemplate(template, { base, key, pt, imdb }) {
  return template
    .replace(DEFAULT_RPDB_BASE, base)
    .replaceAll('[[api-key]]', key)
    .replaceAll('[[poster-type]]', pt)
    .replaceAll('[[imdb-id]]', imdb);
}

/** Poster used for UI thumbnails: all current settings except the label, including a saved custom/TMDB poster choice. */
export function buildThumbnailUrl(cfg, { type, imdb, root, badges }) {
  const base = RPDB_BASE();
  const q = buildQuery(cfg, { kind: 'poster', type, imdb, root, badges, noLabel: true });
  const custom = cfg.customPosters?.[imdb];
  if (custom) return withQuery(fillTemplate(custom, { base, key: cfg.apiKey, pt: posterPathType(type, cfg), imdb }), q);
  return withQuery(`${base}/${cfg.apiKey}/imdb/${posterPathType(type, cfg)}/${imdb}.jpg`, q);
}

export function tmdbPosterTemplate(fileName) {
  const file = String(fileName).replace(/^\/+/, '').split('/').map(enc).join('/');
  return `${DEFAULT_RPDB_BASE}/[[api-key]]/imdb/[[poster-type]]/tmdb-poster/[[imdb-id]]/${file}`;
}

export function customPosterTemplate(imgUrl) {
  return `${DEFAULT_RPDB_BASE}/[[api-key]]/imdb/[[poster-type]]/custom-poster/[[imdb-id]].jpg?img=${enc(imgUrl)}`;
}

export function normalizeCreateImg(img) {
  if (!img) return img;
  const tm = /^https?:\/\/(?:www\.)?(?:image\.)?themoviedb\.org\/t\/p\/[^/]+(\/[^?#]+)/i.exec(img)
    || /^https?:\/\/image\.tmdb\.org\/t\/p\/[^/]+(\/[^?#]+)/i.exec(img);
  if (tm) return `https://image.tmdb.org/t/p/w780${tm[1]}`;
  return img.replace('._V1_.', '._V1_SX580.');
}

export function createPosterQuery({ ratings, img, extras, rtCert, mcCert, rtAudienceCert }) {
  const p = [`ratings=${enc(ratings || '')}`];
  if (has(img)) p.push(`img=${enc(normalizeCreateImg(img))}`);
  if (has(rtCert) && rtCert !== '0') p.push(`rtCert=${enc(rtCert)}`);
  if (has(mcCert) && mcCert !== '0') p.push(`mcCert=${enc(mcCert)}`);
  if (has(rtAudienceCert) && rtAudienceCert !== '0') p.push(`rtAudienceCert=${enc(rtAudienceCert)}`);
  if (has(extras)) p.push(String(extras).replace(/^[?&]/, ''));
  return p.join('&');
}

export function createPosterTemplate(posterType, imdb, query) {
  return `${DEFAULT_RPDB_BASE}/[[api-key]]/imdb/${posterType}/create-poster/${imdb}.jpg?${query}`;
}
