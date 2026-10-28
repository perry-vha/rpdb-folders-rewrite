import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { log, isDocker, isVideoFile } from './util.js';
import { getMountsDir, FOLDER_BADGE_KEYS, ITEM_BADGE_KEYS, styleKeys } from './config.js';
import { listItems } from './engine.js';
import { parseImdbId, parseTmdbId } from './parse.js';
import { tmdbKeyFrom, validateTmdbKey, imdbImage, TMDB_KEY_MISSING } from './match.js';
import {
  RPDB_BASE, buildThumbnailUrl, customPosterTemplate, tmdbPosterTemplate, createPosterQuery, createPosterTemplate, normalizeCreateImg, pick, STYLE_PARAMS, orderParam,
} from './rpdb.js';
import { compareVersions } from './version.js';
import { validateMdblist, mdblistRatings } from './ratings.js';
import { renderPoster, renderBackdrop, renderLogo, ratingItems, createPosterScores, SAMPLE_ITEMS, SAMPLE_INFO } from './compose.js';
import { sanitizeDesign, DESIGN_DEFAULTS, designFromRpdb, toRpdbStyles, rpdbOrder, PRESETS, presetLook, RPDB_SUPPORTED, KINDS } from './look.js';
import { renderLocalPoster, renderLocalArt, mediaFor, designFor, rpdbDesignFor } from './local-poster.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PKG_VERSION = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8')).version;
const STATIC_DIR = path.join(here, '..', 'static');
const ZWSP = '\u200b';
const ALL_BADGE_PARAMS = Object.keys(FOLDER_BADGE_KEYS);

const bool = (v) => v === '1' || v === 'true' || v === true;
const str = (v) => (v === undefined || v === null ? undefined : String(v));
const has = (v) => v !== undefined && v !== null && v !== '';

export async function browseRoots() {
  if (isDocker()) {
    try {
      const dirs = await fs.promises.readdir(getMountsDir(), { withFileTypes: true });
      return dirs.filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'))
        .map((d) => ({ path: path.join(getMountsDir(), d.name), label: d.name }));
    } catch {
      return [];
    }
  }
  if (process.platform === 'win32') {
    const out = [];
    for (let c = 65; c <= 90; c++) {
      const p = `${String.fromCharCode(c)}:\\`;
      if (fs.existsSync(p)) out.push({ path: p, label: null });
    }
    return out;
  }
  const roots = [{ path: '/', label: null }];
  try {
    const skip = new Set(['proc', 'sysfs', 'tmpfs', 'devtmpfs', 'devpts', 'cgroup', 'cgroup2', 'overlay', 'mqueue', 'securityfs']);
    for (const line of fs.readFileSync('/proc/mounts', 'utf8').split('\n')) {
      const [, mp, fstype] = line.split(' ');
      if (mp && mp.startsWith('/') && mp !== '/' && !skip.has(fstype) && !/^\/(proc|sys|dev|run|boot)/.test(mp)) {
        roots.push({ path: mp.replace(/\\040/g, ' '), label: null });
      }
    }
  } catch {
    const home = os.homedir();
    if (home) roots.push({ path: home, label: null });
  }
  return roots;
}

export async function browseChildren(folder) {
  const entries = await fs.promises.readdir(folder, { withFileTypes: true });
  const folders = [];
  const files = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(folder, e.name);
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) isDir = await fs.promises.stat(full).then((s) => s.isDirectory(), () => false);
    if (isDir) folders.push({ path: full, label: full });
    else if (isVideoFile(e.name)) files.push({ path: full, label: e.name });
  }
  const byName = (a, b) => a.path.localeCompare(b.path, undefined, { numeric: true });
  return { folders: folders.sort(byName), files: files.sort(byName) };
}

export function createApp(ctx) {
  const { store, engine, matcher, plex, watchers } = ctx;
  const cfg = () => store.data;
  const app = express();
  const router = express.Router();
  app.disable('x-powered-by');

  router.use(express.urlencoded({ extended: true }));
  router.use(express.json());
  router.use(express.static(STATIC_DIR));

  const PUBLIC = new Set(['/needsPass', '/checkPass']);
  const auth = (req, res, next) => {
    if (req.path === '/radarr' || req.path === '/sonarr') return next();
    const pass = cfg().pass;
    if (!pass || PUBLIC.has(req.path) || req.query.pass === pass) return next();
    return res.status(500).type('text/plain').send('Password Incorrect');
  };
  router.use(auth);

  const get = (name, handler) => {
    router.get(`/${name}`, async (req, res, next) => {
      try {
        await handler(req, res);
      } catch (e) {
        next(e);
      }
    });
  };
  const fail = (res, message) => res.json(message ? { success: false, message } : { success: false });

  async function resolveImdb(type, name) {
    const c = cfg();
    const direct = c.overwriteMatches[type]?.[name] || c.imdbCache[type]?.[name];
    if (direct) return direct;
    const found = engine.findItemRoot(type, name);
    if (!found) return null;
    const m = await matcher.match({ type, name, isFile: found.isFile, itemPath: path.join(found.root, name) });
    return m?.imdb || null;
  }

  // ID: IMDb URL > TMDB URL > folder match > placeholder "ttN". Image: given > TMDB poster > IMDb poster.
  async function createPosterSource(q, type, matchedImdb) {
    let imdb = parseImdbId(q.imdbUrl);
    let img = has(q.img) ? str(q.img) : null;
    const tmdbId = parseTmdbId(q.tmdbUrl);
    if (tmdbId && (!imdb || !img)) {
      if (matcher.hasTmdb()) {
        try {
          const t = await matcher.tmdbImdbFromId(type, tmdbId);
          imdb ||= t?.imdb || null;
          if (!img && t?.poster) img = `https://image.tmdb.org/t/p/w780${t.poster}`;
        } catch (e) {
          log(`TMDB lookup failed for ${tmdbId}: ${e.message}`);
        }
      } else if (!imdb && !matchedImdb) {
        return { error: TMDB_KEY_MISSING };
      }
    }
    imdb ||= matchedImdb || null;
    if (imdb && !img) {
      try {
        img = await imdbImage(imdb);
      } catch { /* no IMDb image */ }
    }
    if (!imdb) {
      let n = 2;
      while (cfg().customPosters[`tt${n}`]) n++;
      imdb = `tt${n}`;
    }
    return { imdb, img };
  }

  async function fetchRpdb(url, res) {
    let up;
    try {
      up = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch {
      return res.status(502).type('text/plain').send('Could not reach RPDB');
    }
    if (!up.ok) {
      await up.arrayBuffer().catch(() => {});
      return res.status(up.status === 200 ? 502 : up.status).type('text/plain').send('Image unavailable');
    }
    res.set('Content-Type', up.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'no-store');
    return res.send(Buffer.from(await up.arrayBuffer()));
  }

  // ---------- session, auth, app info ----------
  get('needsPass', (req, res) => res.json({ success: true, required: Boolean(cfg().pass) }));
  get('checkPass', (req, res) => res.json({ success: !cfg().pass || req.query.pass === cfg().pass }));
  get('savePass', (req, res) => {
    const p = str(req.query.newpass);
    if (!p) return fail(res);
    store.set('pass', p);
    return res.json({ success: true });
  });

  let updateCache = { at: 0, value: { needsUpdate: false } };
  get('needsUpdate', async (req, res) => {
    if (Date.now() - updateCache.at < 3600000) return res.json(updateCache.value);
    let value = { needsUpdate: false };
    try {
      const api = process.env.GITHUB_API_URL || 'https://api.github.com';
      const r = await fetch(`${api}/repos/RatingPosterDB/rpdb-folders/releases`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'rpdb-folders-rewrite' },
        signal: AbortSignal.timeout(10000),
      });
      const rel = r.ok ? (await r.json())[0] : null;
      if (rel && compareVersions(rel.tag_name, PKG_VERSION) > 0) {
        if (isDocker()) value = { needsUpdate: true, dockerUpdate: true };
        else {
          const plat = { win32: 'win', darwin: 'osx' }[process.platform] || 'linux';
          const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
          const asset = (rel.assets || []).find((a) => a.name === `${plat}-rpdb-folders-${arch}.zip`);
          value = { needsUpdate: true, dockerUpdate: false, zipBall: asset?.browser_download_url };
        }
      }
    } catch { /* offline: no update */ }
    updateCache = { at: Date.now(), value };
    return res.json(value);
  });

  get('getConfigPath', (req, res) => res.json({ path: store.file }));
  get('backup.json', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `attachment; filename="backup-${new Date().toDateString()}.json";`);
    res.send(fs.readFileSync(store.file));
  });

  // An empty key removes the RPDB key; the local engine then takes over.
  get('setApiKey', (req, res) => {
    const key = (str(req.query.key) || '').trim();
    store.set('apiKey', key);
    if (!key && cfg().posterEngine === 'rpdb') store.set('posterEngine', 'local');
    engine.keyState = { at: 0, state: null };
    log(key ? 'RPDB API key saved' : 'RPDB API key removed');
    return res.json({ success: true, engine: cfg().posterEngine });
  });

  get('checkRequests', async (req, res) => {
    const key = cfg().apiKey;
    if (!key) return fail(res);
    try {
      const r = await fetch(`${RPDB_BASE()}/${key}/requests?break=${Date.now()}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return fail(res);
      const d = await r.json();
      return res.json({ req: d.req, limit: d.limit, success: true });
    } catch {
      return fail(res);
    }
  });

  get('pollData', (req, res) => {
    const c = cfg();
    res.json({
      success: true,
      lastFullUpdate: Math.max(c.lastFullUpdate.movie || 0, c.lastFullUpdate.series || 0),
      historyCount: engine.historyCount,
      scanItems: engine.queueLength,
      plexConnected: plex.connected,
      plexQueue: plex.queue.size + plex.timers.size,
    });
  });

  // ---------- settings ----------
  get('getSettings', (req, res) => {
    const c = cfg();
    const port = ctx.port?.() || c.port;
    const prefix = c.baseUrl && c.baseUrl !== '/' ? `/${c.baseUrl.replace(/^\/|\/$/g, '')}` : '';
    res.json({
      success: true,
      pkgVersion: PKG_VERSION,
      overwrite: c.overwrite,
      overwrite2years: c.overwriteLast2Years,
      noEmptyFolders: c.noPostersToEmptyFolders,
      noScanOnStart: c.ignoreInitialScan,
      backdrops: c.backdrops,
      logos: c.logos,
      minOverwritePeriod: c.minOverwritePeriod,
      movieFolders: c.mediaFolders.movie,
      seriesFolders: c.mediaFolders.series,
      historyCount: engine.historyCount,
      apiKeyPrefix: c.apiKey ? c.apiKey.slice(0, 3) : false,
      scanOrder: c.scanOrder,
      tmdbKeySet: Boolean(tmdbKeyFrom(c)),
      tmdbKeyFromEnv: Boolean(process.env.TMDB_API_KEY),
      mdblistKeySet: Boolean(c.mdblistKey),
      posterEngine: c.posterEngine,
      cacheMatches: c.cacheMatches,
      movieTextless: c.movieTextless,
      seriesTextless: c.seriesTextless,
      backdropsBadges: c.backdropsBadges,
      moviePosterType: c.moviePosterType,
      seriesPosterType: c.seriesPosterType,
      movieRatingOrder: c.movieRatingOrder,
      seriesRatingOrder: c.seriesRatingOrder,
      usePolling: c.useWebhook ? 'webhook' : c.usePolling ? 'polling' : 'fsevents',
      pollingInterval: c.pollingInterval,
      moviePosterLang: c.posterLang.movie,
      seriesPosterLang: c.posterLang.series,
      movieSecPosterLang: c.posterSecLang.movie,
      seriesSecPosterLang: c.posterSecLang.series,
      overwriteProbe: c.overwriteProbeData,
      defaultBadges: c.defaultBadges,
      webhookDelay: c.webhookDelay,
      webhookSonarr: `http://localhost:${port}${prefix}/sonarr`,
      webhookRadarr: `http://localhost:${port}${prefix}/radarr`,
      plexProtocol: c.plex.protocol,
      plexHost: c.plex.host,
      plexPort: c.plex.port,
      plexToken: c.plex.token,
      plexDelayType: c.plexDelayType,
      plexRefreshDelay: c.plexRefreshDelay,
      plexTodHour: c.plexTodHour,
      plexTodMin: c.plexTodMin,
      plexTodAmPm: c.plexTodAmPm,
      plexDetect: c.plexDetect,
      retryFrequency: c.retryFrequency,
      retryNewerThanMonths: c.retryNewerThanMonths,
    });
  });

  get('setSettings', (req, res) => {
    const c = cfg();
    const q = req.query;
    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const setIf = (param, fn) => {
      if (q[param] !== undefined) fn(q[param]);
    };
    for (const p of ['moviePosterType', 'seriesPosterType', 'movieRatingOrder', 'seriesRatingOrder']) setIf(p, (v) => { c[p] = String(v); });
    const bools = {
      overwrite: 'overwrite', backdrops: 'backdrops', logos: 'logos', movieTextless: 'movieTextless',
      seriesTextless: 'seriesTextless', cacheMatches: 'cacheMatches', backdropsBadges: 'backdropsBadges',
      overwrite2years: 'overwriteLast2Years', noEmptyFolders: 'noPostersToEmptyFolders',
      noScanOnStart: 'ignoreInitialScan', usePolling: 'usePolling', useWebhook: 'useWebhook',
      overwriteProbe: 'overwriteProbeData', plexDetect: null,
    };
    for (const [p, key] of Object.entries(bools)) {
      if (!key) continue;
      setIf(p, (v) => {
        const b = bool(v);
        if (key === 'overwrite' && b && !c.overwrite) c.lastOverwrite = { movie: Date.now(), series: Date.now() };
        c[key] = b;
      });
    }
    setIf('overwritePeriod', (v) => { c.minOverwritePeriod = v === 'overwrite-monthly' ? 2505600000 : 1209600000; });
    for (const p of ['retryFrequency', 'retryNewerThanMonths', 'webhookDelay', 'pollingInterval']) {
      setIf(p, (v) => { if (num(v) !== undefined) c[p] = num(v); });
    }
    setIf('scanOrder', (v) => { c.scanOrder = String(v); });
    setIf('moviePosterLang', (v) => { c.posterLang.movie = String(v); });
    setIf('seriesPosterLang', (v) => { c.posterLang.series = String(v); });
    setIf('movieSecPosterLang', (v) => { c.posterSecLang.movie = String(v); });
    setIf('seriesSecPosterLang', (v) => { c.posterSecLang.series = String(v); });
    setIf('hdrBadge', (v) => { c.defaultBadges.hdr = String(v); });
    setIf('doviBadge', (v) => { c.defaultBadges.dolbyvision = String(v); });
    setIf('remuxBadge', (v) => { c.defaultBadges.remux = String(v); });
    for (const k of ['Protocol', 'Host', 'Port', 'Token']) setIf(`plex${k}`, (v) => { c.plex[k.toLowerCase()] = String(v); });
    store.save();
    res.json({ success: true });
  });

  // An empty key clears the stored one
  get('setTmdbKey', async (req, res) => {
    const key = (str(req.query.key) || '').trim();
    if (key && !(await validateTmdbKey(key))) return fail(res, 'TMDB rejected this key. Use the "API Key" or "API Read Access Token" from themoviedb.org/settings/api.');
    cfg().tmdbKey = key;
    store.save();
    log(key ? 'TMDB key saved' : 'TMDB key removed');
    return res.json({ success: true, tmdbKeySet: Boolean(tmdbKeyFrom(cfg())) });
  });

  // ---------- MDBList ratings ----------
  get('setMdblistKey', async (req, res) => {
    const key = (str(req.query.key) || '').trim();
    if (key && !(await validateMdblist(key))) return fail(res, 'MDBList rejected this key. Get one at mdblist.com/preferences.');
    cfg().mdblistKey = key;
    store.save();
    log(key ? 'MDBList key saved' : 'MDBList key removed');
    return res.json({ success: true, mdblistKeySet: Boolean(key) });
  });

  get('ratings', async (req, res) => {
    const { type, name } = req.query;
    const key = cfg().mdblistKey;
    if (!key) return fail(res, 'Add an MDBList API key under API Keys to compare ratings.');
    if ((type !== 'movie' && type !== 'series') || !has(name)) return fail(res, 'One or more required parameters are missing or invalid');
    const imdb = await resolveImdb(type, name);
    if (!imdb) return fail(res, 'The folder could not be matched to an IMDB ID');
    try {
      return res.json({ success: true, imdb, ...(await mdblistRatings(key, type, imdb)) });
    } catch (e) {
      return fail(res, `MDBList: ${e.message}`);
    }
  });

  // ---------- local poster designer ----------
  const parseDesign = (v) => {
    try {
      return sanitizeDesign(JSON.parse(str(v) || '{}'));
    } catch {
      return sanitizeDesign({});
    }
  };

  get('getDesigns', async (req, res) => {
    const c = cfg();
    const { type, name } = req.query;
    const t = type === 'series' ? 'series' : 'movie';
    const folders = [...c.mediaFolders.movie, ...c.mediaFolders.series];
    let imdb = null;
    let root;
    if ((type === 'movie' || type === 'series') && has(name)) {
      imdb = await resolveImdb(type, name);
      root = engine.findItemRoot(type, name)?.root;
    }
    const legacy = (r, i) => ({ fromRpdb: () => rpdbDesignFor(c, r, i, t) });
    const local = {
      global: sanitizeDesign(c.localDesign || DESIGN_DEFAULTS, legacy()),
      folders: Object.fromEntries(Object.entries(c.folderDesigns).map(([f, d]) => [f, sanitizeDesign(d, legacy(f))])),
      item: imdb && c.itemDesigns[imdb] ? sanitizeDesign(c.itemDesigns[imdb], legacy(root, imdb)) : null,
    };
    // RPDB "global" = every media folder; it starts from the first folder's styles.
    const rpdb = {
      global: rpdbDesignFor(c, folders[0], undefined, t),
      folders: Object.fromEntries(folders.map((f) => [f, rpdbDesignFor(c, f, undefined, t)])),
      item: imdb ? rpdbDesignFor(c, root, imdb, t) : null,
    };
    const templates = Object.fromEntries(Object.entries(c.designTemplates).map(([n, d]) => [n, d.engine === 'rpdb' ? designFromRpdb(d.styles) : sanitizeDesign(d)]));
    const presets = Object.fromEntries(PRESETS.map(([id]) => [id, Object.fromEntries(KINDS.map((k) => [k, presetLook(id, k)]))]));
    res.json({
      success: true, engine: c.posterEngine, defaults: DESIGN_DEFAULTS, local, rpdb, templates,
      presets, presetNames: PRESETS, rpdbSupported: RPDB_SUPPORTED,
    });
  });

  get('setPosterEngine', (req, res) => {
    const e = str(req.query.engine);
    if (e !== 'rpdb' && e !== 'local') return fail(res, 'Unknown poster engine');
    if (e === 'local' && !cfg().mdblistKey) return fail(res, 'Add an MDBList API key first (API Keys).');
    if (e === 'rpdb' && !cfg().apiKey) return fail(res, 'Add an RPDB API key first (API Keys).');
    cfg().posterEngine = e;
    store.save();
    log(`Poster engine set to ${e === 'local' ? 'local renderer' : 'RPDB'}`);
    return res.json({ success: true, engine: e });
  });

  // An empty design clears a folder/item override
  get('setDesign', async (req, res) => {
    const q = req.query;
    const c = cfg();
    const clear = !has(q.design);
    const d = parseDesign(q.design);
    const target = str(q.target);
    if (target === 'global') {
      c.localDesign = d;
    } else if (target === 'folder') {
      const folder = str(q.folder);
      if (!folder || ![...c.mediaFolders.movie, ...c.mediaFolders.series].includes(folder)) return fail(res, 'Unknown media folder');
      if (clear) delete c.folderDesigns[folder];
      else c.folderDesigns[folder] = d;
    } else if (target === 'item') {
      const { type, name } = q;
      if ((type !== 'movie' && type !== 'series') || !has(name)) return fail(res, 'One or more required parameters are missing or invalid');
      const imdb = await resolveImdb(type, name);
      if (!imdb) return fail(res, 'The folder could not be matched to an IMDB ID');
      if (clear) delete c.itemDesigns[imdb];
      else c.itemDesigns[imdb] = d;
    } else {
      return fail(res, 'Unknown target');
    }
    store.save();
    return res.json({ success: true });
  });

  // RPDB engine: a unified design saved as RPDB Image Styles (only the given image kinds are replaced).
  get('setRpdbDesign', async (req, res) => {
    const q = req.query;
    const c = cfg();
    const d = parseDesign(q.design);
    const kinds = String(q.kinds || KINDS.join(',')).split(',').filter((k) => KINDS.includes(k));
    const write = (key, item) => {
      for (const kind of kinds) {
        const styles = toRpdbStyles(d[kind], kind);
        for (const mapKey of styleKeys(item)) {
          const plain = item ? `${mapKey[4].toLowerCase()}${mapKey.slice(5)}` : mapKey;
          if (!plain.startsWith(kind)) continue;
          delete c[mapKey][key];
          if (styles[plain] !== undefined) c[mapKey][key] = styles[plain];
        }
      }
    };
    const target = str(q.target);
    if (target === 'item') {
      const { type, name } = q;
      if ((type !== 'movie' && type !== 'series') || !has(name)) return fail(res, 'One or more required parameters are missing or invalid');
      const imdb = await resolveImdb(type, name);
      if (!imdb) return fail(res, 'The folder could not be matched to an IMDB ID');
      write(imdb, true);
    } else {
      const all = [...c.mediaFolders.movie, ...c.mediaFolders.series];
      const list = target === 'folder' ? [str(q.folder)] : all;
      if (target === 'folder' && !all.includes(list[0])) return fail(res, 'Unknown media folder');
      for (const f of list) write(f, false);
    }
    store.save();
    return res.json({ success: true });
  });

  get('saveTemplate', (req, res) => {
    const name = (str(req.query.name) || '').trim().slice(0, 40);
    if (!name) return fail(res, 'Template name is required');
    let raw = {};
    try { raw = JSON.parse(str(req.query.design) || '{}'); } catch { /* empty template */ }
    cfg().designTemplates[name] = sanitizeDesign(raw);
    store.save();
    return res.json({ success: true });
  });

  get('deleteTemplate', (req, res) => {
    delete cfg().designTemplates[str(req.query.name)];
    store.save();
    return res.json({ success: true });
  });

  // Matches are memoised so live tweaks don't repeat the folder search.
  const previewMatches = new Map();
  async function previewImdb(type, name) {
    const key = `${type}:${name}`;
    if (!previewMatches.has(key)) {
      if (previewMatches.size >= 50) previewMatches.delete(previewMatches.keys().next().value);
      previewMatches.set(key, resolveImdb(type, name).catch(() => null));
    }
    const imdb = await previewMatches.get(key);
    if (!imdb) previewMatches.delete(key);
    return imdb;
  }
  const previewTitle = (q) => (q.type === 'movie' || q.type === 'series') && has(q.name);

  // Unsaved Badge / Label dialog values (over=1 sends them all; empty means none).
  const badgeOverrides = (q) => {
    if (!bool(q.over)) return {};
    const over = {};
    for (const k of ['badges', 'badgePos', 'maxBadges', 'badgeSize', 'label']) over[k] = str(q[k]) ?? '';
    return over;
  };
  async function previewItem(q) {
    if (!previewTitle(q)) return null;
    const imdb = await previewImdb(q.type, q.name);
    if (!imdb) return null;
    const found = engine.findItemRoot(q.type, q.name);
    let badgeCsv;
    if (found) {
      try { badgeCsv = await engine.badgesFor({ ...found, type: q.type }, imdb, path.join(found.root, q.name)); } catch { /* no probe data */ }
    }
    return { imdb, root: found?.root, badgeCsv };
  }
  const imageKind = (q) => (q.kind === 'backdrop' || q.kind === 'logo' ? q.kind : 'poster');
  const sendImage = (res, buf, kind) => res.set({ 'Content-Type': kind === 'logo' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'no-store' }).send(buf);
  const typeOf = (q) => (q.type === 'series' ? 'series' : 'movie');
  // What the RPDB API would draw for a design: only its Image Styles survive, ratings follow Poster Settings.
  const asRpdb = (d, type) => {
    const styles = Object.assign({}, ...KINDS.map((k) => toRpdbStyles(d[k], k)));
    return designFromRpdb(styles, cfg()[`${type}PosterType`], cfg()[`${type}RatingOrder`]);
  };

  /** Preview with local data when a library title and MDBList are available, otherwise sample ratings on a placeholder. */
  async function renderPreview(q, d) {
    const c = cfg();
    const kind = imageKind(q);
    const [lo, hi, dflt] = kind === 'backdrop' ? [640, 1920, 1280] : kind === 'logo' ? [200, 780, 500] : [200, 1000, 400];
    const width = Math.min(hi, Math.max(lo, Number(q.width) || dflt));
    const over = badgeOverrides(q);
    const item = await previewItem(q);
    const root = item?.root ?? str(q.folder);
    const imdb = item?.imdb;
    if (item && c.mdblistKey) {
      const args = { cfg: c, matcher, type: q.type, imdb, root, design: d, width, badgeCsv: item.badgeCsv };
      const buf = kind === 'poster' ? await renderLocalPoster({ ...args, over }) : matcher.hasTmdb() ? await renderLocalArt({ ...args, kind }) : null;
      if (buf) return buf;
    }
    const media = mediaFor(c, { kind, imdb, root, badgeCsv: item?.badgeCsv, info: SAMPLE_INFO, over });
    const label = over.label ?? pick(c, 'itemLabels', 'labels', imdb, root);
    if (kind === 'backdrop') return renderBackdrop({ art: null, items: SAMPLE_ITEMS, design: d, width, media });
    if (kind === 'logo') return renderLogo({ logo: null, items: SAMPLE_ITEMS, design: d, width });
    return renderPoster({ art: null, items: SAMPLE_ITEMS, design: d, width, media, label });
  }

  // engine=rpdb limits the design to what RPDB can draw.
  get('design-preview', async (req, res) => {
    const q = req.query;
    try {
      const d = q.engine === 'rpdb' ? asRpdb(parseDesign(q.design), typeOf(q)) : parseDesign(q.design);
      return sendImage(res, await renderPreview(q, d), imageKind(q));
    } catch (e) {
      return res.status(502).type('text/plain').send(e.message);
    }
  });

  // Local approximation of RPDB Image Styles (poster/backdrop/logo keys) for instant previews (no RPDB request).
  get('rpdb-preview', async (req, res) => {
    const q = req.query;
    let styles = {};
    try { styles = JSON.parse(str(q.styles) || '{}'); } catch { /* defaults */ }
    try {
      const t = typeOf(q);
      return sendImage(res, await renderPreview(q, designFromRpdb(styles, cfg()[`${t}PosterType`], cfg()[`${t}RatingOrder`])), imageKind(q));
    } catch (e) {
      return res.status(502).type('text/plain').send(e.message);
    }
  });

  // Badge / Label dialog preview with the active engine and the target's saved design.
  get('badge-preview', async (req, res) => {
    const q = { ...req.query, kind: 'poster' };
    const c = cfg();
    try {
      const imdb = previewTitle(q) ? await previewImdb(q.type, q.name) : undefined;
      const root = str(q.folder) || (previewTitle(q) ? engine.findItemRoot(q.type, q.name)?.root : undefined);
      const d = c.posterEngine === 'local' ? designFor(c, root, imdb, typeOf(q)) : rpdbDesignFor(c, root, imdb, typeOf(q));
      return sendImage(res, await renderPreview(q, d), 'poster');
    } catch (e) {
      return res.status(502).type('text/plain').send(e.message);
    }
  });

  // ---------- media folders ----------
  get('browse', async (req, res) => {
    const folder = str(req.query.folder);
    if (!folder) return res.json({ success: true, folders: await browseRoots() });
    try {
      const { folders, files } = await browseChildren(folder);
      return res.json({ success: true, folders, files });
    } catch {
      return fail(res, 'Folder could not be read');
    }
  });

  function applyBadgeParams(map, query, target) {
    for (const v of Object.values(map)) delete cfg()[v]?.[target];
    const { label, badges, badgePos, backdropBadgePos, maxBadges, backdropMaxBadges, badgeSize } = query;
    const c = cfg();
    if (has(label)) c[map.label][target] = String(label);
    if (has(badges)) c[bool(query.autoBadges) ? map.autoBadges : map.badges][target] = String(badges);
    if (has(badgePos)) c[map.badgePos][target] = String(badgePos);
    if (has(backdropBadgePos)) c[map.backdropBadgePos][target] = String(backdropBadgePos);
    if (has(maxBadges)) c[map.maxBadges][target] = String(maxBadges);
    if (has(backdropMaxBadges)) c[map.backdropMaxBadges][target] = String(backdropMaxBadges);
    if (has(badgeSize)) c[map.badgeSize][target] = String(badgeSize);
  }

  for (const [route, type] of [['addMovieFolder', 'movie'], ['addSeriesFolder', 'series']]) {
    get(route, async (req, res) => {
      const raw = str(req.query.folder);
      if (!raw) return fail(res, 'One or more required parameters are missing or invalid');
      const folder = path.resolve(raw);
      let isDir = false;
      try {
        isDir = (await fs.promises.stat(folder)).isDirectory();
      } catch { /* checked below */ }
      if (!isDir) return fail(res, 'The folder does not exist or is not accessible');
      const c = cfg();
      if (c.mediaFolders[type].includes(folder)) return fail(res, 'The folder was already added');
      c.mediaFolders[type].push(folder);
      applyBadgeParams(FOLDER_BADGE_KEYS, req.query, folder);
      store.save();
      if (!c.useWebhook) watchers.watch(type, folder);
      engine.scan(type, { folder }).catch((e) => log(`Scan failed: ${e.message}`));
      return res.json({ success: true });
    });
  }

  for (const [route, type] of [['removeMovieFolder', 'movie'], ['removeSeriesFolder', 'series']]) {
    get(route, (req, res) => {
      const raw = str(req.query.folder);
      if (!raw) return fail(res, 'One or more required parameters are missing or invalid');
      const c = cfg();
      const folder = c.mediaFolders[type].find((f) => f === raw || f === path.resolve(raw));
      if (!folder) return fail(res, 'Folder is not a media folder');
      c.mediaFolders[type] = c.mediaFolders[type].filter((f) => f !== folder);
      store.save();
      watchers.unwatch(folder);
      return res.json({ success: true });
    });
  }

  get('searchStrings', async (req, res) => {
    const type = str(req.query.type);
    if (type !== 'movie' && type !== 'series') return res.status(400).json({ success: false, message: 'type must be movie or series' });
    const c = cfg();
    const sf = str(req.query.searchfolder);
    const roots = c.mediaFolders[type];
    let names = [];
    if (sf === 'Unmatched') names = Object.keys(c.unmatched[type]);
    else if (sf === 'Missing Posters') names = Object.keys(c.missingPosters[type]);
    else {
      for (const root of roots) {
        if (sf && path.basename(root) !== sf) continue;
        try {
          for (const i of await listItems(root)) names.push(`${i.name}${ZWSP} [${path.basename(root)}]`);
        } catch { /* inaccessible folder */ }
      }
    }
    res.json({
      forbiddenChar: '/',
      folders: names.length ? `/${names.join('//')}/` : '//',
      folderChoices: [...roots.map((r) => path.basename(r)), 'Unmatched', 'Missing Posters'],
    });
  });

  // ---------- scans ----------
  for (const [route, overwrite] of [['runFullScan', false], ['forceOverwriteScan', true]]) {
    get(route, (req, res) => {
      if (engine.scanActive) return res.json({ success: false, message: 'Full scan already running' });
      const type = str(req.query.type);
      const folder = str(req.query.folder);
      const types = type === 'movie' || type === 'series' ? [type] : ['movie', 'series'];
      log(`${overwrite ? 'Overwrite' : 'Full'} scan forced to start for ${type ? type : 'all'} folders`);
      (async () => {
        for (const t of types) await engine.scan(t, { folder: folder && cfg().mediaFolders[t].includes(folder) ? folder : undefined, overwrite });
      })().catch((e) => log(`Scan failed: ${e.message}`));
      if (!folder) {
        for (const t of types) cfg()[overwrite ? 'lastOverwrite' : 'lastFullUpdate'][t] = Date.now();
        store.save();
      }
      return res.json({ success: true });
    });
  }
  get('cancelScan', (req, res) => {
    engine.cancel();
    res.json({ success: true });
  });

  // ---------- badges, labels, styles ----------
  const folderKnown = (folder) => folder && [...cfg().mediaFolders.movie, ...cfg().mediaFolders.series].includes(folder);

  async function target(req, res) {
    const folder = str(req.query.folder);
    const type = str(req.query.type);
    if (!folder) {
      fail(res, 'One or more required parameters are missing or invalid');
      return null;
    }
    if (type) {
      if (type !== 'movie' && type !== 'series') {
        fail(res, 'One or more required parameters are missing or invalid');
        return null;
      }
      const imdb = await resolveImdb(type, folder);
      if (!imdb) {
        fail(res, 'The folder could not be matched to an IMDB ID');
        return null;
      }
      return { item: true, key: imdb };
    }
    if (!folderKnown(folder)) {
      fail(res, 'Folder is not a media folder');
      return null;
    }
    return { item: false, key: folder };
  }

  const editor = (route, kind) => get(route, async (req, res) => {
    const t = await target(req, res);
    if (!t) return;
    const c = cfg();
    if (kind === 'label') {
      applyBadgeParams(t.item ? ITEM_BADGE_KEYS : FOLDER_BADGE_KEYS, req.query, t.key);
    } else {
      const keys = styleKeys(t.item);
      for (const k of keys) delete c[k][t.key];
      for (const k of keys) if (has(req.query[k])) c[k][t.key] = String(req.query[k]);
    }
    store.save();
    res.json({ success: true });
  });
  editor('editFolderLabel', 'label');
  editor('editItemLabel', 'label');
  editor('editFolderStyles', 'styles');
  editor('editItemStyles', 'styles');

  get('getBadgeSettings', async (req, res) => {
    const t = await target(req, res);
    if (!t) return;
    const c = cfg();
    const m = t.item ? ITEM_BADGE_KEYS : FOLDER_BADGE_KEYS;
    const out = { success: true };
    if (c[m.label][t.key] !== undefined) out.label = c[m.label][t.key];
    if (c[m.badges][t.key] !== undefined) out.badges = c[m.badges][t.key];
    if (c[m.autoBadges][t.key] !== undefined) out.autoBadges = c[m.autoBadges][t.key];
    for (const p of ['badgePos', 'backdropBadgePos', 'maxBadges', 'backdropMaxBadges', 'badgeSize']) {
      if (c[m[p]][t.key] !== undefined) out[p] = c[m[p]][t.key];
    }
    res.json(out);
  });

  get('getStylesSettings', async (req, res) => {
    const t = await target(req, res);
    if (!t) return;
    const c = cfg();
    const out = { success: true };
    for (const k of styleKeys(t.item)) if (c[k][t.key] !== undefined) out[k] = c[k][t.key];
    res.json(out);
  });

  // ---------- per-item poster actions ----------
  get('addFixMatch', async (req, res) => {
    const { folder, imdb, type } = req.query;
    if (!has(folder) || !has(imdb) || (type !== 'movie' && type !== 'series')) {
      return fail(res, 'One or more required parameters are missing or invalid');
    }
    if (/[/\\]/.test(folder)) return fail(res, 'The folder name cannot include "/"');
    if (!engine.findItemRoot(type, folder)) return fail(res, `The folder could not be found within your ${type} folders`);
    const id = parseImdbId(imdb);
    if (!id) return fail(res, 'Invalid IMDB URL / IMDB ID');
    const c = cfg();
    c.overwriteMatches[type][folder] = id;
    c.imdbCache[type][folder] = id;
    delete c.unmatched[type][folder];
    store.save();
    engine.fetchItem(type, folder, { overwrite: true, force: true, front: true });
    return res.json({ success: true });
  });

  get('findByImdb', (req, res) => {
    const { type, imdb } = req.query;
    const id = parseImdbId(imdb);
    if ((type !== 'movie' && type !== 'series') || !id) return fail(res, 'Invalid IMDB URL / IMDB ID');
    const c = cfg();
    const names = new Set();
    for (const table of [c.overwriteMatches[type], c.imdbCache[type]]) {
      for (const [name, v] of Object.entries(table)) if (v === id && engine.findItemRoot(type, name)) names.add(name);
    }
    return res.json({ success: true, names: [...names] });
  });

  get('poster', async (req, res) => {
    const { type, name } = req.query;
    const local = cfg().posterEngine === 'local' && cfg().mdblistKey;
    if (!cfg().apiKey && !local) return res.status(403).type('text/plain').send('API Key is Invalid');
    if ((type !== 'movie' && type !== 'series') || !has(name)) return res.status(400).type('text/plain').send('Bad request');
    const imdb = await resolveImdb(type, name);
    const found = engine.findItemRoot(type, name);
    if (!imdb || !found) return res.status(404).type('text/plain').send('Not found');
    if (local) {
      try {
        let badgeCsv;
        try { badgeCsv = await engine.badgesFor({ ...found, type }, imdb, path.join(found.root, name)); } catch { /* no probe data */ }
        const buf = await renderLocalPoster({ cfg: cfg(), matcher, type, imdb, root: found.root, width: 400, badgeCsv });
        if (buf) return res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }).send(buf);
      } catch (e) {
        log(`Local poster preview failed for ${name}: ${e.message}`);
      }
      if (!cfg().apiKey) return res.status(404).type('text/plain').send('Not found');
    }
    return fetchRpdb(buildThumbnailUrl(cfg(), { type, imdb, root: found.root }), res);
  });

  get('poster-choices', async (req, res) => {
    const { type, name } = req.query;
    if ((type !== 'movie' && type !== 'series') || !has(name)) return fail(res, 'One or more required parameters are missing or invalid');
    if (!matcher.hasTmdb()) return fail(res, TMDB_KEY_MISSING);
    const imdb = await resolveImdb(type, name);
    if (!imdb) return fail(res, 'The folder could not be matched to an IMDB ID');
    try {
      return res.json({ items: await matcher.posterChoices(type, imdb) });
    } catch (e) {
      return fail(res, e.message);
    }
  });

  async function itemAction(req, res, action) {
    const { folder, type } = req.query;
    if (!has(folder) || (type !== 'movie' && type !== 'series')) return fail(res, 'One or more required parameters are missing or invalid');
    if (!engine.findItemRoot(type, folder)) return fail(res, `The folder could not be found within your ${type} folders`);
    const imdb = await resolveImdb(type, folder);
    if (!imdb) return fail(res, 'The folder could not be matched to an IMDB ID');
    const extra = await action(imdb, folder, type);
    if (extra === false) return fail(res);
    engine.fetchItem(type, folder, { overwrite: true, force: true, front: true, ...(extra || {}) });
    return res.json({ success: true });
  }

  // The choice is saved like custom/created posters so overwrite scans and "Update Ratings" keep it
  get('tmdb-poster', (req, res) => itemAction(req, res, (imdb, folder, type) => {
    const p = str(req.query.tmdbPoster);
    if (!p || !/^\/?[\w.-]+\.(jpe?g|png|webp)$/i.test(p)) return false;
    const c = cfg();
    c.customPosters[imdb] = tmdbPosterTemplate(p);
    c.overwriteMatches[type][folder] = imdb;
    store.save();
    return null;
  }));
  get('reset-poster', (req, res) => itemAction(req, res, (imdb) => {
    delete cfg().customPosters[imdb];
    store.save();
    return null;
  }));
  get('custom-poster', (req, res) => itemAction(req, res, (imdb) => {
    const img = str(req.query.customPoster);
    if (!img || !/^https?:\/\//i.test(img)) return false;
    cfg().customPosters[imdb] = customPosterTemplate(img);
    store.save();
    return null;
  }));
  get('update-ratings-poster', (req, res) => itemAction(req, res, () => null));

  get('create-poster', async (req, res) => {
    const q = req.query;
    const { folder, type } = q;
    if (!has(folder) || (type !== 'movie' && type !== 'series')) return fail(res, 'One or more required parameters are missing or invalid');
    if (!engine.findItemRoot(type, folder)) return fail(res, `The folder could not be found within your ${type} folders`);
    const matched = parseImdbId(q.imdbUrl) ? null : await resolveImdb(type, folder);
    const src = await createPosterSource(q, type, matched);
    if (src.error) return fail(res, src.error);
    const query = createPosterQuery({ ratings: q.ratings, img: src.img, rtCert: q.rtCert, mcCert: q.mcCert, rtAudienceCert: q.rtAudienceCert });
    const c = cfg();
    c.customPosters[src.imdb] = createPosterTemplate(str(q.posterType) || 'poster-default', src.imdb, query);
    c.overwriteMatches[type][folder] = src.imdb;
    c.imdbCache[type][folder] = src.imdb;
    delete c.unmatched[type][folder];
    store.save();
    engine.fetchItem(type, folder, { overwrite: true, force: true, front: true });
    return res.json({ success: true });
  });

  // Real RPDB render of The Godfather for a unified design's image kind (its RPDB Image Styles only).
  get('rpdb-check', async (req, res) => {
    const key = cfg().apiKey;
    if (!key) return res.status(403).type('text/plain').send('API Key is Invalid');
    const q = req.query;
    const kind = imageKind(q);
    const styles = toRpdbStyles(parseDesign(q.design)[kind], kind);
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(styles)) {
      const suffix = k.slice(kind.length);
      params.set(suffix === 'CertPos' ? 'certsPos' : STYLE_PARAMS[suffix], v);
    }
    const t = typeOf(q);
    const seg = kind === 'backdrop' ? 'backdrop-default' : kind === 'logo' ? 'logo-default' : cfg()[`${t}PosterType`] || 'poster-default';
    const order = orderParam(t, cfg());
    if (order) params.set('order', order);
    const qs = params.toString();
    return fetchRpdb(`${RPDB_BASE()}/${key}/imdb/${seg}/tt0068646.${kind === 'logo' ? 'png' : 'jpg'}${qs ? `?${qs}` : ''}`, res);
  });

  get('preview', async (req, res) => {
    const key = cfg().apiKey;
    if (!key) return res.status(403).type('text/plain').send('API Key is Invalid');
    const q = new URLSearchParams();
    let posterType = 'poster-default';
    let kind = 'poster';
    for (const [k, v] of Object.entries(req.query)) {
      if (k === 'pass' || typeof v !== 'string') continue;
      if (k === 'posterType') posterType = v || posterType;
      else if (k === 'imageBackdrop') kind = bool(v) ? 'backdrop' : kind;
      else if (k === 'imageLogo') kind = bool(v) ? 'logo' : kind;
      else q.set(k, v);
    }
    const seg = kind === 'backdrop' ? 'backdrop-default' : kind === 'logo' ? 'logo-default' : posterType;
    const ext = kind === 'logo' ? 'png' : 'jpg';
    const qs = q.toString();
    return fetchRpdb(`${RPDB_BASE()}/${key}/imdb/${seg}/tt0068646.${ext}${qs ? `?${qs}` : ''}`, res);
  });

  get('create-preview', async (req, res) => {
    const key = cfg().apiKey;
    const q = req.query;
    const local = cfg().posterEngine === 'local' || !key;
    const src = await createPosterSource(q, q.mediaType === 'series' ? 'series' : 'movie', null);
    if (src.error) return res.status(400).type('text/plain').send(src.error);
    if (local) {
      const img = src.img && /^https?:\/\//i.test(src.img) ? normalizeCreateImg(src.img) : null;
      try {
        let art = null;
        if (img) {
          const r = await fetch(img, { signal: AbortSignal.timeout(20000) });
          if (!r.ok) throw new Error(`Image HTTP ${r.status}`);
          art = Buffer.from(await r.arrayBuffer());
        }
        const { scores, force } = createPosterScores(q);
        const o = rpdbOrder(str(q.posterType) || 'poster-default');
        const base = designFor(cfg(), undefined, undefined, typeOf({ type: q.mediaType }));
        const design = { ...base, order: o.order, exclude: o.exclude, poster: { ...base.poster, certIcons: o.certIcons } };
        const buf = await renderPoster({ art, items: ratingItems({ scores }), design, force, width: 580 });
        return sendImage(res, buf, 'poster');
      } catch (e) {
        return res.status(502).type('text/plain').send(e.message);
      }
    }
    const query = createPosterQuery({ ratings: q.ratings, img: src.img, extras: q.extras, rtCert: q.rtCert, mcCert: q.mcCert, rtAudienceCert: q.rtAudienceCert });
    return fetchRpdb(`${RPDB_BASE()}/${key}/imdb/${str(q.posterType) || 'poster-default'}/create-poster/${src.imdb}.jpg?${query}`, res);
  });

  get('submit-poster', async (req, res) => {
    const key = cfg().apiKey;
    if (!key) return fail(res);
    const q = req.query;
    const src = await createPosterSource(q, q.mediaType === 'series' ? 'series' : 'movie', null);
    if (src.error) return fail(res, src.error);
    // Placeholder IDs ("tt2") are not sent to RPDB as IMDb IDs
    const real = src.imdb.length > 7 ? src.imdb : undefined;
    const data = {
      ratings: q.ratings, imdb: real, imdbUrl: q.imdbUrl || (real && `https://www.imdb.com/title/${real}/`), tmdbUrl: q.tmdbUrl, rtUrl: q.rtUrl,
      mcUrl: q.mcUrl, malUrl: q.malUrl, img: src.img || undefined, mediaType: q.mediaType, rtCert: q.rtCert, mcCert: q.mcCert,
      rtAudienceCert: q.rtAudienceCert,
    };
    const b64 = Buffer.from(JSON.stringify(data)).toString('base64');
    try {
      const r = await fetch(`${RPDB_BASE()}/${key}/submit?imageType=${encodeURIComponent(str(q.posterType) || 'poster-default')}&data=${encodeURIComponent(b64)}`, { signal: AbortSignal.timeout(15000) });
      return res.json({ success: r.ok });
    } catch {
      return fail(res);
    }
  });

  // ---------- Plex ----------
  get('testPlex', async (req, res) => {
    const q = req.query;
    const settings = { protocol: str(q.plexProtocol) || 'https', host: str(q.plexHost) || '', port: str(q.plexPort) || '32400', token: str(q.plexToken) || '' };
    if (!settings.host || !settings.token) return fail(res);
    if (!(await plex.test(settings))) return fail(res);
    cfg().plex = settings;
    store.save();
    plex.resetCache();
    plex.connected = true;
    return res.json({ success: true });
  });
  get('disconnectPlex', (req, res) => {
    const c = cfg();
    c.plex.host = '';
    c.plex.token = '';
    store.save();
    plex.connected = false;
    plex.resetCache();
    res.json({ success: true });
  });
  get('savePlexRefreshSettings', (req, res) => {
    const c = cfg();
    const q = req.query;
    const t = str(q.plexDelayType);
    if (t !== undefined) c.plexDelayType = t === 'none' || !t ? false : t;
    if (has(q.plexRefreshDelay)) c.plexRefreshDelay = Number(q.plexRefreshDelay) || 0;
    if (has(q.plexTodHour)) c.plexTodHour = Number(q.plexTodHour);
    if (has(q.plexTodMin)) c.plexTodMin = Number(q.plexTodMin);
    if (has(q.plexTodAmPm)) c.plexTodAmPm = q.plexTodAmPm === 'PM' ? 'PM' : 'AM';
    if (has(q.plexDetect)) c.plexDetect = bool(q.plexDetect) ? 1 : 0;
    store.save();
    res.json({ success: true });
  });

  // ---------- webhooks ----------
  const recentSonarr = new Map();
  const webhookAuth = (req) => {
    const pass = cfg().pass;
    if (!pass) return true;
    const h = req.headers.authorization || '';
    if (!h.startsWith('Basic ')) return false;
    const decoded = Buffer.from(h.slice(6), 'base64').toString();
    return decoded.slice(decoded.indexOf(':') + 1) === pass;
  };

  function locate(type, itemPath) {
    const roots = cfg().mediaFolders[type];
    const norm = path.resolve(itemPath);
    if (fs.existsSync(norm)) {
      for (const root of roots) {
        const rel = path.relative(root, norm);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return { root, name: rel.split(path.sep)[0] };
      }
    }
    const base = path.basename(itemPath.replace(/[\\/]+$/, '').replace(/\\/g, '/')).split('/').pop();
    log(`Scanning known ${type} folders for "${base}"`);
    for (const root of roots) {
      if (fs.existsSync(path.join(root, base))) {
        log(`Found "${base}" in "${root}"`);
        return { root, name: base };
      }
    }
    log(`Could not find "${base}" in any ${type} folder`);
    return null;
  }

  for (const [route, type] of [['radarr', 'movie'], ['sonarr', 'series']]) {
    router.post(`/${route}`, (req, res) => {
      const label = type === 'movie' ? 'Radarr' : 'Sonarr';
      if (!webhookAuth(req)) {
        log(`${label} Webhook Error: Password incorrect`);
        return res.status(500).type('text/plain').send('Password Incorrect');
      }
      const body = req.body || {};
      if (body.eventType !== 'Download' || body.isUpgrade) {
        return res.type('text/plain').send(`${body.eventType} event is not useful`);
      }
      const itemPath = type === 'movie' ? (body.movie?.folderPath || body.movie?.path) : body.series?.path;
      if (!itemPath) return res.status(500).type('text/plain').send('Path inaccessible');
      if (type === 'series') {
        const last = recentSonarr.get(itemPath);
        if (last && Date.now() - last < 30000) {
          log(`Detected duplicate event from Sonarr for ${itemPath}`);
          return res.type('text/plain').send('Duplicate event');
        }
        recentSonarr.set(itemPath, Date.now());
      }
      const found = locate(type, itemPath);
      if (!found) return res.status(500).type('text/plain').send('Path inaccessible');
      const t = setTimeout(() => {
        log(`${found.name} has been added to ${type}`);
        engine.fetchItem(type, found.name);
      }, cfg().webhookDelay || 0);
      t.unref?.();
      return res.type('text/plain').send('Success');
    });
  }

  const base = cfg().baseUrl && cfg().baseUrl !== '/' ? `/${cfg().baseUrl.replace(/^\/|\/$/g, '')}` : '/';
  app.use(base, router);
  return app;
}
