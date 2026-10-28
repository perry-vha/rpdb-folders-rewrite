import { getJson } from './match.js';

// MDBList ratings, mapped to badges the same way OpenPosterDB does (api/src/services/ratings.rs, MIT).
const MDBLIST_BASE = () => (process.env.MDBLIST_BASE_URL || 'https://api.mdblist.com').replace(/\/+$/, '');

export const RATING_SOURCES = {
  imdb: { label: 'IMDb', short: 'IMDb', color: '#b4910f' },
  tmdb: { label: 'TMDB', short: 'TMDB', color: '#019b58' },
  rt: { label: 'RT Critics', short: 'RTC', color: '#b92308' },
  rta: { label: 'RT Audience', short: 'RTA', color: '#b92308' },
  mc: { label: 'Metacritic', short: 'MC', color: '#4b9626' },
  trakt: { label: 'Trakt', short: 'Trakt', color: '#af0f2d' },
  lb: { label: 'Letterboxd', short: 'LB', color: '#009b58' },
  mal: { label: 'MyAnimeList', short: 'MAL', color: '#223c78' },
  mdblist: { label: 'MDBList', short: 'MDB', color: '#4284ca' },
  ebert: { label: 'Roger Ebert', short: 'Ebert', color: '#e8590c' },
};
const ORDER = Object.keys(RATING_SOURCES);

const pos = (n) => (typeof n === 'number' && n > 0 ? n : null);
const pct = (n) => `${Math.round(n)}%`;

// MDBList source -> [badge key, formatter]. A 0 score is MDBList's "no data" sentinel.
const MAP = {
  imdb: ['imdb', (r) => (r.value != null ? Number(r.value).toFixed(1) : null)],
  tmdb: ['tmdb', (r) => (pos(r.score) ? pct(r.score) : null)],
  tomatoes: ['rt', (r) => (pos(r.score) ? pct(r.score) : null)],
  popcorn: ['rta', (r) => (pos(r.score) ? pct(r.score) : null)],
  metacritic: ['mc', (r) => (pos(r.score) ? String(Math.round(r.score)) : null)],
  trakt: ['trakt', (r) => (pos(r.score) ? pct(r.score) : null)],
  letterboxd: ['lb', (r) => (r.value != null ? Number(r.value).toFixed(1) : null)],
  myanimelist: ['mal', (r) => (pos(r.score) ? (r.score / 10).toFixed(2) : null)],
  rogerebert: ['ebert', (r) => (pos(r.value) ? Number(r.value).toFixed(1) : null)],
};

/** Pure mapping of an MDBList media-info response to ordered badges. */
export function mdblistBadges(resp) {
  const found = {};
  for (const r of resp?.ratings || []) {
    const m = MAP[r?.source];
    if (!m || found[m[0]]) continue;
    const value = m[1](r);
    if (value != null) found[m[0]] = { value, votes: r.votes ?? null };
  }
  if (pos(resp?.score)) found.mdblist = { value: String(Math.round(resp.score)), votes: null };
  return ORDER.filter((k) => found[k]).map((k) => ({ key: k, ...RATING_SOURCES[k], ...found[k] }));
}

/** Raw value/score per MDBList source (plus the overall MDBList score), for the RPDB preview. */
export function mdblistScores(resp) {
  const out = {};
  for (const r of resp?.ratings || []) if (r?.source && !out[r.source]) out[r.source] = { value: r.value ?? null, score: r.score ?? null };
  if (pos(resp?.score)) out.mdblist = { score: resp.score };
  return out;
}

export async function validateMdblist(key) {
  try {
    await getJson(`${MDBLIST_BASE()}/user?apikey=${encodeURIComponent(key)}`);
    return true;
  } catch {
    return false;
  }
}

const cache = new Map();
const TTL = 60 * 60 * 1000;

export async function mdblistRatings(key, type, imdb) {
  const kind = type === 'series' ? 'show' : 'movie';
  const ck = `${kind}:${imdb}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const d = await getJson(`${MDBLIST_BASE()}/imdb/${kind}/${encodeURIComponent(imdb)}?apikey=${encodeURIComponent(key)}`);
  const data = {
    title: d.title || null, year: d.year || null, certification: d.certification || null, poster: d.poster || null, badges: mdblistBadges(d), scores: mdblistScores(d),
    // For RPDB's server-side badge tags (us_age_rating, commonsense, auto_lang)
    info: { certification: d.certification || null, commonsense: d.commonsense_media?.common_sense ?? d.age_rating ?? null, language: d.language || d.spoken_language || null, country: d.country || null },
  };
  cache.set(ck, { at: Date.now(), data });
  return data;
}
