import fs from 'node:fs';
import { log } from './util.js';
import { parseName, extractEmbeddedIds, sanitizeName, searchTitle } from './parse.js';
import { probeCachePath } from './badges.js';

const TMDB_BASE = () => (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const IMDB_SUGGEST = () => (process.env.IMDB_SUGGEST_URL || 'https://v3.sg.media-imdb.com').replace(/\/+$/, '');

export async function getJson(url, { timeout = 15000, headers } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/(api_?key)=[^&]+/gi, '$1=***')}`);
  return res.json();
}

/** Pick the best entry from IMDb suggestion results. */
export function pickImdbResult(results, { title, year, type }) {
  const wantSeries = type === 'series';
  const target = sanitizeName(title);
  const isSeries = (r) => /tv (mini )?series/i.test(r.q || '') || ['tvSeries', 'tvMiniSeries'].includes(r.qid);
  const candidates = results.filter((r) => /^tt\d+$/.test(r.id || '') && (wantSeries ? isSeries(r) : !isSeries(r)));
  const pool = candidates.filter((r) => sanitizeName(r.l) === target);
  if (!pool.length) return null;
  if (year) {
    const near = pool.filter((r) => r.y && Math.abs(r.y - year) <= 1);
    if (near.length) return near.find((r) => r.y === year) || near[0];
  }
  // Year mismatch or unknown: fall back to a yearless match
  return pool[0];
}

export const TMDB_KEY_MISSING = 'This feature needs a free TMDB API key. Add one under Scan Settings > TMDB API Key.';

export const tmdbKeyFrom = (cfg) => String(process.env.TMDB_API_KEY || cfg?.tmdbKey || '').trim();

/** Accepts either a TMDB v3 API key or a v4 Read Access Token (a JWT, sent as a Bearer token). */
export function tmdbRequest(key, pathPart, params = {}) {
  const bearer = key.startsWith('eyJ');
  const qs = new URLSearchParams(bearer ? params : { api_key: key, ...params });
  return getJson(`${TMDB_BASE()}${pathPart}?${qs}`, bearer ? { headers: { authorization: `Bearer ${key}` } } : {});
}

export async function validateTmdbKey(key) {
  try {
    await tmdbRequest(key, '/configuration');
    return true;
  } catch {
    return false;
  }
}

export async function imdbSearch(title, year, type) {
  const q = title.toLowerCase().trim();
  if (!q) return null;
  const first = /[a-z0-9]/.test(q[0]) ? q[0] : 'x';
  const data = await getJson(`${IMDB_SUGGEST()}/suggestion/${first}/${encodeURIComponent(q)}.json`);
  const best = pickImdbResult(data.d || [], { title, year, type });
  return best ? { imdb: best.id, year: best.y || year || null } : null;
}

/** IMDb poster URL for an ID, via the suggestion API. */
export async function imdbImage(imdb) {
  const data = await getJson(`${IMDB_SUGGEST()}/suggestion/t/${encodeURIComponent(imdb)}.json`);
  return (data.d || []).find((r) => r.id === imdb)?.i?.imageUrl || null;
}

export class Matcher {
  constructor({ store, plex }) {
    this.store = store;
    this.plex = plex;
    this.yearCache = new Map();
  }

  get cfg() {
    return this.store.data;
  }

  tmdbKey() {
    return tmdbKeyFrom(this.cfg);
  }

  hasTmdb() {
    return Boolean(this.tmdbKey());
  }

  async tmdb(pathPart, params = {}) {
    const key = this.tmdbKey();
    if (!key) throw new Error(TMDB_KEY_MISSING);
    return tmdbRequest(key, pathPart, params);
  }

  async tmdbImdbFromId(type, id) {
    const d = await this.tmdb(`/${type === 'series' ? 'tv' : 'movie'}/${id}`, { append_to_response: 'external_ids' });
    const imdb = d.external_ids?.imdb_id || d.imdb_id;
    const date = d.release_date || d.first_air_date;
    return imdb ? { imdb, year: date ? Number(date.slice(0, 4)) : null, poster: d.poster_path || null } : null;
  }

  async tmdbFromTvdb(type, id) {
    const d = await this.tmdb(`/find/${id}`, { external_source: 'tvdb_id', language: 'en-US' });
    const tv = d.tv_results?.[0];
    const mv = d.movie_results?.[0];
    const pick = type === 'series' ? (tv ? ['series', tv] : mv && ['movie', mv]) : (mv ? ['movie', mv] : tv && ['series', tv]);
    return pick ? this.tmdbImdbFromId(pick[0], pick[1].id) : null;
  }

  async tmdbSearch(title, year, type) {
    const isTv = type === 'series';
    const params = { query: title, include_adult: 'false' };
    if (year) params[isTv ? 'first_air_date_year' : 'year'] = String(year);
    const d = await this.tmdb(`/search/${isTv ? 'tv' : 'movie'}`, params);
    const want = sanitizeName(title);
    const results = d.results || [];
    const names = (r) => (isTv ? [r.name, r.original_name] : [r.title, r.original_title]).map(sanitizeName);
    let hit = results.find((r) => names(r).includes(want));
    if (!hit && d.total_results === 1) hit = results[0];
    return hit ? this.tmdbImdbFromId(type, hit.id) : null;
  }

  /** Resolve a name to { imdb, year?, how } or null. */
  async match({ type, name, isFile, itemPath }) {
    const cfg = this.cfg;
    const fixed = cfg.overwriteMatches[type]?.[name];
    if (fixed) return { imdb: fixed, how: 'fix' };
    if (cfg.cacheMatches) {
      const cached = cfg.imdbCache[type]?.[name];
      if (cached) return { imdb: cached, year: this.yearCache.get(`${type}:${name}`), how: 'cache' };
    }

    const finish = (res, how, msg) => {
      if (!res?.imdb) return null;
      if (res.year) this.yearCache.set(`${type}:${name}`, res.year);
      log(msg);
      return { ...res, how };
    };

    const ids = extractEmbeddedIds(name);
    try {
      if (ids.imdb) return finish({ imdb: ids.imdb }, 'embedded', `Matched ${name} by IMDB ID in folder name`);
      if ((ids.tmdb || ids.tvdb) && !this.hasTmdb()) {
        log(`No TMDB key set, cannot resolve the ${ids.tmdb ? 'TMDB' : 'TVDB'} ID in ${name}; falling back to name search`);
      } else if (ids.tmdb) {
        const r = finish(await this.tmdbImdbFromId(type, ids.tmdb), 'embedded', `Matched ${name} by TMDB ID in folder name`);
        if (r) return r;
      }
      if (ids.tvdb && this.hasTmdb()) {
        const r = finish(await this.tmdbFromTvdb(type, ids.tvdb), 'embedded', `Matched ${name} by TVDB ID in folder name`);
        if (r) return r;
      }
    } catch (e) {
      log(`Embedded ID lookup failed for ${name}: ${e.message}`);
    }

    if (cfg.checkForLocalImdbId && itemPath) {
      try {
        const local = JSON.parse(await fs.promises.readFile(probeCachePath(itemPath, isFile), 'utf8'));
        if (/^tt\d+$/.test(local.imdbId || '')) return finish({ imdb: local.imdbId }, 'local', `Matched ${name} by local rpdb.json`);
      } catch { /* no local data */ }
    }

    if (this.plex?.connected && cfg.plexDetect) {
      try {
        const g = await this.plex.guidsFor({ type, itemPath, isFile });
        let res = null;
        if (g?.imdb) res = { imdb: g.imdb };
        else if (g?.tmdb && this.hasTmdb()) res = await this.tmdbImdbFromId(type, g.tmdb);
        else if (g?.tvdb && this.hasTmdb()) res = await this.tmdbFromTvdb(type, g.tvdb);
        if (res?.imdb) return finish(res, 'plex', `Matched ${name} through Plex: ${res.imdb}`);
      } catch (e) {
        log(`Plex lookup failed for ${name}: ${e.message}`);
      }
    }

    const { title: rawTitle, year } = parseName(name, { isFile });
    const title = searchTitle(rawTitle, type);
    if (!title) return null;
    let order = { 'imdb-tmdb': ['imdb', 'tmdb'], 'tmdb-imdb': ['tmdb', 'imdb'], imdb: ['imdb'], tmdb: ['tmdb'] }[cfg.scanOrder] || ['imdb', 'tmdb'];
    // Without a TMDB key, IMDb search is always used, even when "TMDB Only" is selected
    if (!this.hasTmdb()) order = ['imdb'];
    for (const src of order) {
      try {
        const res = src === 'imdb' ? await imdbSearch(title, year, type) : await this.tmdbSearch(title, year, type);
        const out = finish(res, src, `Matched ${name} by ${src === 'imdb' ? 'IMDB' : 'TMDB'} Search`);
        if (out) return out;
      } catch (e) {
        log(`${src.toUpperCase()} search failed for ${name}: ${e.message}`);
      }
    }
    return null;
  }

  async releaseYear(type, name, imdb) {
    const k = `${type}:${name}`;
    if (this.yearCache.has(k)) return this.yearCache.get(k);
    if (this.hasTmdb()) try {
      const d = await this.tmdb(`/find/${imdb}`, { external_source: 'imdb_id', language: 'en-US' });
      const r = d.movie_results?.[0] || d.tv_results?.[0];
      const date = r?.release_date || r?.first_air_date;
      if (date) {
        const y = Number(date.slice(0, 4));
        this.yearCache.set(k, y);
        return y;
      }
    } catch { /* unknown year */ }
    const y = parseName(name, { isFile: /\.\w{2,4}$/.test(name) }).year;
    if (y) this.yearCache.set(k, y);
    return y || null;
  }

  async posterChoices(type, imdb) {
    const find = await this.tmdb(`/find/${imdb}`, { external_source: 'imdb_id', language: 'en-US' });
    const r = type === 'series' ? find.tv_results?.[0] : find.movie_results?.[0];
    if (!r) return [];
    const imgs = await this.tmdb(`/${type === 'series' ? 'tv' : 'movie'}/${r.id}/images`, {});
    const names = new Intl.DisplayNames(['en'], { type: 'language' });
    return (imgs.posters || []).map((p) => {
      let lang = null;
      try {
        lang = p.iso_639_1 ? names.of(p.iso_639_1) : null;
      } catch { lang = p.iso_639_1; }
      return { file_path: p.file_path, lang, code: p.iso_639_1 || null, region: p.iso_3166_1 || null, vote: p.vote_average || 0 };
    });
  }

  /** Backdrop and logo paths chosen like OpenPosterDB (tmdb.rs select_image), best vote first. */
  async artChoices(type, imdb, lang = 'en') {
    const find = await this.tmdb(`/find/${imdb}`, { external_source: 'imdb_id', language: 'en-US' });
    const r = type === 'series' ? find.tv_results?.[0] : find.movie_results?.[0];
    if (!r) return { backdrop: null, logo: null };
    const [base, region] = String(lang || 'en').split('-');
    const langs = [...new Set([base, 'en'])].join(',');
    const imgs = await this.tmdb(`/${type === 'series' ? 'tv' : 'movie'}/${r.id}/images`, { include_image_language: `${langs},null` });
    const best = (list) => [...list].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0]?.file_path || null;
    // Backdrops: textless only. Logos: region, then base language, then English; never textless, no SVG.
    const logos = (imgs.logos || []).filter((l) => l.iso_639_1 && !/\.svg$/i.test(l.file_path));
    const logo = (region && best(logos.filter((l) => l.iso_639_1 === base && l.iso_3166_1 === region.toUpperCase())))
      || best(logos.filter((l) => l.iso_639_1 === base)) || best(logos.filter((l) => l.iso_639_1 === 'en'));
    return { backdrop: best((imgs.backdrops || []).filter((b) => !b.iso_639_1)), logo };
  }
}
