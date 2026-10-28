// Unified local design: one set of rating-look options per image (poster / backdrop / logo).
// OpenPosterDB's badge look and RPDB's themes are presets of these options, and the RPDB engine
// converts to and from RPDB's Image Styles (only the options RPDB supports).

export const KINDS = ['poster', 'backdrop', 'logo'];
export const POSITIONS = ['tl', 'tc', 'tr', 'l', 'r', 'bl', 'bc', 'br'];
export const ICON_PACKS = ['opdb', 'official', 'rpdb', 'rpdb-round', 'text', 'none'];
export const NUMBER_FORMATS = ['auto', 'full', 'short', 'whole', 'bare'];
export const FRAMES = { poster: ['native', 'cover', 'pad', 'blur', 'rpdb'], backdrop: ['native', 'wide'], logo: ['fit', 'fixed'] };
export const IMAGE_SIZES = { poster: ['medium', 'large', 'verylarge'], backdrop: ['small', 'medium', 'large'], logo: ['medium', 'large', 'verylarge'] };
export const IMAGE_WIDTHS = {
  poster: { medium: 580, large: 1280, verylarge: 2000 },
  backdrop: { small: 1280, medium: 1920, large: 3840 },
  logo: { medium: 780, large: 1722, verylarge: 2689 },
};
export const RATING_KEYS = ['imdb', 'tmdb', 'rt', 'rta', 'mc', 'mcu', 'trakt', 'lb', 'mal', 'mdblist', 'ebert', 'commonsense', 'usage', 'overall', 'critics', 'audience'];

const BASE_LOOK = {
  layout: 'badges', tile: 'split', position: 'bc', arrange: 'row', content: 'beside', icons: 'opdb', certIcons: false,
  size: 1, font: 'auto', fontScale: 1, bold: false, text: 'auto', numbers: 'auto', fill: 'source', opacity: null,
  corners: 'auto', skew: 'none', stroke: 'auto', strokeWidth: 2, strokeSide: 'all', padding: null, margin: null, gap: null,
  span: 'full', limit: 3, frame: 'native', imageSize: 'medium', insetX: 0, insetY: 0, certBadges: 'none',
};

// OpenPosterDB defaults (db.rs RenderSettings::default) for each image.
export const LOOK_DEFAULTS = {
  poster: { ...BASE_LOOK },
  backdrop: { ...BASE_LOOK, position: 'tr', arrange: 'column', content: 'above', icons: 'official', limit: 5, span: 'fit' },
  logo: { ...BASE_LOOK, content: 'above', icons: 'official', limit: 5, frame: 'fit' },
};
export const DESIGN_DEFAULTS = { order: '', exclude: '', textless: false, label: '', poster: LOOK_DEFAULTS.poster, backdrop: LOOK_DEFAULTS.backdrop, logo: LOOK_DEFAULTS.logo };

const COLOR = /^[a-z]{3,24}$/;
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);
const numIn = (v, lo, hi, dflt) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
const csvKeys = (v) => String(v || '').split(',').map((s) => s.trim()).filter((k) => RATING_KEYS.includes(k)).join(',');

export function sanitizeLook(raw, kind) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const D = LOOK_DEFAULTS[kind];
  const named = (v, extra, dflt) => (extra.includes(v) || COLOR.test(String(v || '')) ? v : dflt);
  return {
    layout: pick(r.layout, ['badges', 'bar'], D.layout),
    tile: pick(r.tile, ['split', 'block', 'box'], D.tile),
    position: pick(r.position, POSITIONS, D.position),
    arrange: pick(r.arrange, ['row', 'column'], D.arrange),
    content: pick(r.content, ['beside', 'above'], D.content),
    icons: pick(r.icons, ICON_PACKS, D.icons),
    certIcons: r.certIcons == null ? D.certIcons : bool(r.certIcons),
    size: numIn(r.size, 0.5, 2, D.size),
    font: pick(r.font, ['auto', 'inter', 'roboto'], D.font),
    fontScale: numIn(r.fontScale, 0.7, 1.6, D.fontScale),
    bold: r.bold == null ? D.bold : bool(r.bold),
    text: named(r.text, ['auto'], D.text),
    numbers: pick(r.numbers, NUMBER_FORMATS, D.numbers),
    fill: named(r.fill, ['source', 'dark', 'light', 'none'], D.fill),
    opacity: numIn(r.opacity, 0, 1, null),
    corners: r.corners === 'auto' || r.corners === 'full' ? r.corners : numIn(r.corners, 0, 130, D.corners),
    skew: pick(r.skew, ['none', 'left', 'right'], D.skew),
    stroke: named(r.stroke, ['auto', 'none', 'source'], D.stroke),
    strokeWidth: numIn(r.strokeWidth, 1, 30, D.strokeWidth),
    strokeSide: pick(r.strokeSide, ['all', 'top', 'bottom', 'left', 'right'], D.strokeSide),
    padding: numIn(r.padding, 0, 60, null),
    margin: numIn(r.margin, 0, 60, null),
    gap: numIn(r.gap, 0, 60, null),
    span: pick(r.span, ['full', 'fit'], D.span),
    limit: Math.round(numIn(r.limit, 0, 10, D.limit)),
    frame: pick(r.frame, FRAMES[kind], D.frame),
    imageSize: pick(r.imageSize, IMAGE_SIZES[kind], D.imageSize),
    insetX: numIn(r.insetX, 0, 50, 0),
    insetY: numIn(r.insetY, 0, 50, 0),
    certBadges: kind === 'backdrop' ? pick(r.certBadges, ['none', 'left', 'right'], D.certBadges) : 'none',
  };
}

// ---------- legacy designs (before the unified looks) ----------
const LEGACY_SIZE = { xs: 0.7, s: 0.85, m: 1, l: 1.2, xl: 1.45 };
function fromLegacyLook(o, kind, top = {}) {
  const icons = { icon: 'opdb', official: 'official', text: 'text', rpdb: o.logoShape === 'r' ? 'rpdb-round' : 'rpdb' }[o.labelStyle];
  const bg = { d: { fill: 'source' }, k: { fill: 'dark' }, t: { fill: 'source', opacity: 0.47 }, n: { fill: 'none' } }[o.background] || {};
  return sanitizeLook({
    position: o.position, arrange: o.direction === 'v' ? 'column' : o.direction === 'h' ? 'row' : undefined,
    content: o.style === 'v' ? 'above' : o.style === 'h' ? 'beside' : undefined, icons, size: LEGACY_SIZE[o.size],
    corners: o.shape === 'p' ? 'full' : undefined, ...bg, limit: o.limit, insetX: o.insetX, insetY: o.insetY,
    frame: kind === 'poster' ? top.fit : undefined,
  }, kind);
}
const isLegacy = (d) => d && typeof d === 'object' && !d.poster && ('position' in d || 'labelStyle' in d || 'style' in d || 'fit' in d || 'ratingStyle' in d);

/**
 * Whitelist and normalise a design. Legacy flat OPDB designs are converted; legacy "RPDB styles"
 * designs need the stored Image Styles (rpdbStyles) and poster settings (rpdbOrder) to convert.
 */
export function sanitizeDesign(raw, legacy = {}) {
  const d = raw && typeof raw === 'object' ? raw : {};
  if (isLegacy(d)) {
    const out = {
      order: csvKeys(d.order), exclude: csvKeys(d.exclude), textless: bool(d.textless), label: String(d.label || '').slice(0, 40),
      poster: fromLegacyLook(d, 'poster', d), backdrop: fromLegacyLook(d.backdrop || {}, 'backdrop'), logo: fromLegacyLook(d.logo || {}, 'logo'),
    };
    if (d.ratingStyle === 'rpdb' && legacy.fromRpdb) Object.assign(out, legacy.fromRpdb());
    return sanitizeDesign(out);
  }
  return {
    order: csvKeys(d.order),
    exclude: csvKeys(d.exclude),
    textless: bool(d.textless),
    label: String(d.label || '').slice(0, 40),
    poster: sanitizeLook(d.poster, 'poster'),
    backdrop: sanitizeLook(d.backdrop, 'backdrop'),
    logo: sanitizeLook(d.logo, 'logo'),
  };
}

// ---------- RPDB themes as presets / RPDB Image Styles conversion ----------
// RPDB shows at most 3 ratings in poster rows; side bars, backdrop columns and logo strips take the full rating order (max 6).
const RPDB_BASE = {
  poster: { layout: 'bar', tile: 'block', position: 'bc', arrange: 'row', content: 'beside', icons: 'rpdb', font: 'roboto', fill: 'dark', frame: 'rpdb', limit: 3, span: 'full' },
  backdrop: { layout: 'bar', tile: 'block', position: 'tr', arrange: 'column', content: 'above', icons: 'rpdb', font: 'roboto', fill: 'dark', frame: 'wide', limit: 6, span: 'fit', certBadges: 'left' },
  logo: { layout: 'bar', tile: 'block', position: 'bc', arrange: 'row', content: 'beside', icons: 'rpdb', certIcons: true, font: 'roboto', fill: 'none', frame: 'fixed', limit: 6, span: 'full' },
};
export const RPDB_THEMES = ['default', 'blocks', 'rounded-blocks', 'sharp-blocks', 'boxes', 'stripes-right', 'stripes-left',
  'light-bar', 'light-blocks', 'light-rounded-blocks', 'light-sharp-blocks', 'light-boxes', 'light-stripes-right', 'light-stripes-left'];

// RPDB bar position <-> unified position + arrangement
const BAR_TO = {
  bottom: ['bc', 'row'], top: ['tc', 'row'], 'left-top': ['tl', 'column'], 'left-center': ['l', 'column'], 'left-bottom': ['bl', 'column'],
  'right-top': ['tr', 'column'], 'right-center': ['r', 'column'], 'right-bottom': ['br', 'column'],
  'bottom-left': ['bl', 'row'], 'bottom-right': ['br', 'row'], 'top-left': ['tl', 'row'], 'top-right': ['tr', 'row'],
};
const BAR_POS = {
  poster: ['bottom', 'top', 'left-top', 'left-center', 'left-bottom', 'right-top', 'right-center', 'right-bottom'],
  backdrop: ['right-top', 'right-center', 'right-bottom', 'left-top', 'left-center', 'left-bottom'],
  logo: ['bottom', 'top', 'left-top', 'left-center', 'left-bottom', 'right-top', 'right-center', 'right-bottom', 'bottom-left', 'bottom-right', 'top-left', 'top-right'],
};
function barPosOf(look, kind) {
  const hit = Object.entries(BAR_TO).find(([p, [pos, arr]]) => BAR_POS[kind].includes(p) && pos === look.position && arr === look.arrange);
  if (hit) return hit[0];
  // Nearest RPDB position: side bars for column, top/bottom bars for rows
  if (kind === 'backdrop' || look.arrange === 'column') {
    const left = ['tl', 'l', 'bl'].includes(look.position);
    const v = look.position.startsWith('t') ? 'top' : look.position.startsWith('b') ? 'bottom' : 'center';
    return `${left ? 'left' : 'right'}-${v}`;
  }
  return look.position.startsWith('t') ? 'top' : 'bottom';
}

/** Look for an RPDB theme (preset), optionally with RPDB Image Styles on top (st uses the kind's keys, e.g. posterTheme). */
export function fromRpdbStyles(st = {}, kind = 'poster', { certIcons } = {}) {
  const g = (s) => st[`${kind}${s}`];
  const theme = RPDB_THEMES.includes(g('Theme')) ? g('Theme') : 'default';
  const light = theme.startsWith('light-');
  const base = theme.replace(/^light-/, '');
  const look = { ...LOOK_DEFAULTS[kind], ...RPDB_BASE[kind] };
  if (base !== 'default' && base !== 'bar') {
    look.layout = 'badges';
    look.tile = base === 'boxes' ? 'box' : 'block';
    if (base === 'rounded-blocks') look.corners = 'full';
    if (base === 'sharp-blocks') look.corners = 0;
    if (base === 'boxes') look.icons = 'none';
    if (base.startsWith('stripes-')) { look.skew = base.slice(8); look.gap = 15; }
  }
  if (light && !(kind === 'logo' && look.layout === 'bar')) look.fill = 'light';
  const bp = g('BarPos');
  if (BAR_POS[kind].includes(bp)) [look.position, look.arrange] = BAR_TO[bp];
  look.content = look.arrange === 'column' ? 'above' : 'beside';
  if (kind === 'poster' && look.arrange === 'column') look.limit = 6;
  if (g('FontSize')) look.fontScale = Number(g('FontSize'));
  if (g('FontWeight') === '1') look.bold = true;
  if (g('TextStyle') === '1') look.numbers = 'whole';
  if (g('TextStyle') === '2') look.numbers = 'short';
  if (g('LogoStyle') === '1') look.icons = 'rpdb-round';
  if (g('LogoStyle') === '2') look.icons = 'none';
  if (g('BarColor')) look.fill = g('BarColor');
  if (g('BarOpacity')) { look.opacity = Number(g('BarOpacity')); if (look.fill === 'none') look.fill = 'dark'; }
  if (g('FontColor')) look.text = g('FontColor');
  if (g('BarPadding')) look.padding = Number(g('BarPadding'));
  if (g('BarMargin')) look.margin = Number(g('BarMargin'));
  if (g('BarRoundness')) look.corners = g('BarRoundness') === 'full' ? 'full' : Number(g('BarRoundness'));
  if (g('BarStrokeColor')) look.stroke = g('BarStrokeColor') === 'transparent' ? 'none' : g('BarStrokeColor');
  if (g('BarStrokeWidth')) look.strokeWidth = Number(g('BarStrokeWidth'));
  if (g('BarStrokeSide')) look.strokeSide = g('BarStrokeSide');
  if (['left', 'right'].includes(g('BarSkewDirection'))) { look.skew = g('BarSkewDirection'); if (!base.startsWith('stripes-')) look.gap = null; }
  if (g('BarSkewDirection') === 'none') look.skew = 'none';
  if (g('Size')) look.imageSize = g('Size');
  if (kind === 'backdrop' && g('CertPos')) look.certBadges = g('CertPos');
  if (certIcons != null && kind === 'poster') look.certIcons = certIcons;
  return sanitizeLook(look, kind);
}

/** RPDB Image Styles (kind keys) for a look; options RPDB lacks are dropped. */
export function toRpdbStyles(look, kind) {
  const out = {};
  const set = (s, v) => { if (v !== undefined && v !== null && v !== '') out[`${kind}${s}`] = String(v); };
  const light = look.fill === 'light';
  let theme;
  if (look.layout === 'bar') theme = light ? 'light-bar' : 'default';
  else if (look.tile === 'box') theme = `${light ? 'light-' : ''}boxes`;
  else if (look.skew !== 'none' && look.gap === 15) theme = `${light ? 'light-' : ''}stripes-${look.skew}`;
  else theme = `${light ? 'light-' : ''}${look.corners === 'full' ? 'rounded-blocks' : look.corners === 0 ? 'sharp-blocks' : 'blocks'}`;
  if (theme !== 'default') set('Theme', theme);
  const bp = barPosOf(look, kind);
  if (bp !== { poster: 'bottom', backdrop: 'right-top', logo: 'bottom' }[kind]) set('BarPos', bp);
  if (look.fontScale > 1) set('FontSize', Math.min(1.5, look.fontScale));
  if (look.bold) set('FontWeight', '1');
  if (look.numbers === 'whole') set('TextStyle', '1');
  if (look.numbers === 'short') set('TextStyle', '2');
  if (look.icons === 'rpdb-round') set('LogoStyle', '1');
  if (look.icons === 'none' && look.tile !== 'box') set('LogoStyle', '2');
  if (look.opacity != null) set('BarOpacity', Math.min(0.99, Math.max(0.01, look.opacity)));
  if (COLOR.test(look.fill) && !['source', 'dark', 'light', 'none'].includes(look.fill)) set('BarColor', look.fill);
  if (look.text !== 'auto') set('FontColor', look.text);
  if (look.layout === 'badges') {
    if (look.padding != null) set('BarPadding', Math.min(55, Math.max(5, look.padding)));
    if (look.margin != null) set('BarMargin', Math.min(55, Math.max(5, look.margin)));
    if (look.corners !== 'auto' && look.corners !== 'full' && look.corners !== 0) set('BarRoundness', look.corners);
    if (look.stroke === 'none') set('BarStrokeColor', 'transparent');
    else if (!['auto', 'source'].includes(look.stroke)) set('BarStrokeColor', look.stroke);
    if (look.strokeWidth !== 2) set('BarStrokeWidth', look.strokeWidth);
    if (look.strokeSide !== 'all') set('BarStrokeSide', look.strokeSide);
    if (look.skew !== 'none' && look.gap !== 15) set('BarSkewDirection', look.skew);
  }
  if (look.imageSize !== 'medium') set('Size', look.imageSize);
  if (kind === 'backdrop' && look.certBadges === 'right') set('CertPos', 'right');
  return out;
}

/** Options the RPDB API can express (the Designer disables the rest for the RPDB engine). */
export const RPDB_SUPPORTED = ['layout', 'tile', 'position', 'arrange', 'icons', 'fontScale', 'bold', 'text', 'numbers', 'fill', 'opacity',
  'corners', 'skew', 'stroke', 'strokeWidth', 'strokeSide', 'padding', 'margin', 'imageSize', 'certBadges'];

/** RPDB poster type / rating order as rating order + exclude (RPDB shows only the listed sources). */
const TYPE_ORDER = { 'poster-default': 'imdb,mc,rt', 'poster-certs': 'imdb,mc,rt', 'poster-rt': 'mal,imdb,rt,rta', 'poster-mc': 'mal,imdb,mc,mcu' };
const RPDB_KEY = {
  imdb: 'imdb', tmdb: 'tmdb', trakt: 'trakt', letterboxd: 'lb', 'tomatoes-critics': 'rt', 'tomatoes-audience': 'rta', 'metacritic-critics': 'mc',
  'metacritic-audience': 'mcu', myanimelist: 'mal', rogerebert: 'ebert', mdblist: 'mdblist', commonsense: 'commonsense', 'us-age': 'usage',
  'overall-rating': 'overall', 'critics-rating': 'critics', 'audience-rating': 'audience',
};
export function rpdbOrder(posterType = 'poster-default', ratingOrder = '') {
  const list = posterType === 'rating-order' && ratingOrder
    ? ratingOrder.split(',').map((s) => RPDB_KEY[s.trim()]).filter(Boolean)
    : (TYPE_ORDER[posterType] || TYPE_ORDER['poster-default']).split(',');
  // Certified Fresh / Must-See icons observed on certs, RT and custom rating-order posters
  return { order: list.join(','), exclude: RATING_KEYS.filter((k) => !list.includes(k)).join(','), certIcons: ['poster-certs', 'poster-rt', 'rating-order'].includes(posterType) };
}

/** Full design from stored RPDB Image Styles + poster settings (RPDB engine previews, legacy "RPDB styles" designs). */
export function designFromRpdb(styles = {}, posterType, ratingOrder) {
  const o = rpdbOrder(posterType, ratingOrder);
  return sanitizeDesign({
    order: o.order, exclude: o.exclude,
    poster: fromRpdbStyles(styles, 'poster', { certIcons: o.certIcons }),
    backdrop: fromRpdbStyles(styles, 'backdrop'),
    logo: fromRpdbStyles(styles, 'logo'),
  });
}

/** One-click presets: OpenPosterDB's look and every RPDB theme. */
export const PRESETS = [['opdb', 'OpenPosterDB badges'], ...RPDB_THEMES.map((t) => [`rpdb:${t}`, `RPDB ${t === 'default' ? 'bar' : t.replace(/-/g, ' ')}`])];
export function presetLook(preset, kind) {
  if (preset === 'opdb') return { ...LOOK_DEFAULTS[kind] };
  const theme = String(preset).replace(/^rpdb:/, '');
  return fromRpdbStyles({ [`${kind}Theme`]: theme }, kind);
}
