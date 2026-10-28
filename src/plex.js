import fs from 'node:fs';
import { log, sleep, findVideos } from './util.js';

const PRODUCT = 'Rating Poster Database';

export function parseGuids(guidList) {
  const out = {};
  for (const g of guidList || []) {
    const id = typeof g === 'string' ? g : g.id;
    const m = /^(imdb|tmdb|tvdb):\/\/(.+)$/.exec(id || '');
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export function nextTimeOfDay(hour12, min, ampm, now = new Date()) {
  let h = Number(hour12) % 12;
  if (String(ampm).toUpperCase() === 'PM') h += 12;
  const t = new Date(now);
  t.setHours(h, Number(min) || 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t;
}

export class PlexClient {
  constructor(store) {
    this.store = store;
    this.connected = false;
    this.queue = new Map(); // ratingKey -> name
    this.timers = new Map();
    this.todTimer = null;
    this.libs = null;
    this.lookupChain = Promise.resolve();
  }

  get plex() {
    return this.store.data.plex;
  }

  base(p = this.plex) {
    return `${p.protocol}://${p.host}:${p.port}`;
  }

  async request(path, { params = {}, method = 'GET', settings = this.plex, refresh = false } = {}) {
    const qs = new URLSearchParams({
      'X-Plex-Token': settings.token,
      'X-Plex-Product': PRODUCT,
      'X-Plex-Client-Identifier': this.store.data.clientId,
      ...params,
    });
    const headers = { accept: 'application/json' };
    if (refresh) {
      headers.origin = 'https://app.plex.tv';
      headers.referer = 'https://app.plex.tv/';
    }
    const res = await fetch(`${this.base(settings)}${path}?${qs}`, { method, headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Plex HTTP ${res.status}`);
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { raw: text };
    }
  }

  async test(settings) {
    try {
      await this.request('/library/sections', { settings });
      return true;
    } catch {
      return false;
    }
  }

  async sections() {
    if (!this.libs) {
      const d = await this.request('/library/sections');
      this.libs = { movie: [], show: [] };
      for (const dir of d.MediaContainer?.Directory || []) if (this.libs[dir.type]) this.libs[dir.type].push(dir.key);
    }
    return this.libs;
  }

  resetCache() {
    this.libs = null;
  }

  async fileSize(type, itemPath, isFile) {
    if (isFile) return (await fs.promises.stat(itemPath)).size;
    const vids = await findVideos(itemPath);
    if (!vids.length) return 0;
    if (type === 'series') return (await fs.promises.stat(vids[0])).size;
    let sum = 0;
    for (const v of vids) sum += (await fs.promises.stat(v)).size;
    return sum;
  }

  /** Locate the item in Plex. Returns { ratingKey, guids } or null. Lookups run one at a time. */
  find(item) {
    const run = this.lookupChain.then(() => this.findNow(item));
    this.lookupChain = run.catch(() => {});
    return run;
  }

  async findNow({ type, itemPath, isFile }) {
    const libs = await this.sections();
    const keys = type === 'series' ? libs.show : libs.movie;
    const size = await this.fileSize(type, itemPath, isFile);
    if (!size) return null;
    for (const key of keys) {
      const params = { mediaSize: String(size), includeGuids: '1' };
      if (type === 'series') Object.assign(params, { type: '4', includeCollections: '0', includeExternalMedia: '0' });
      const d = await this.request(`/library/sections/${key}/all`, { params });
      for (const m of d.MediaContainer?.Metadata || []) {
        if (type === 'series') {
          const rk = m.grandparentRatingKey || (m.grandparentKey || '').split('/').filter(Boolean).at(-1);
          if (!rk) continue;
          const show = await this.request(`/library/metadata/${rk}`, { params: { includeGuids: '1' } });
          const sm = show.MediaContainer?.Metadata?.[0];
          return { ratingKey: String(rk), guids: parseGuids(sm?.Guid) };
        }
        const sizes = (m.Media || []).flatMap((x) => (x.Part || []).map((p) => p.size));
        if (sizes.includes(size) || (m.Media || []).some((x) => (x.Part || []).reduce((a, p) => a + (p.size || 0), 0) === size)) {
          return { ratingKey: String(m.ratingKey), guids: parseGuids(m.Guid) };
        }
      }
    }
    return null;
  }

  async guidsFor(item) {
    return (await this.find(item))?.guids || null;
  }

  async refreshNow(ratingKey, name) {
    try {
      await this.request(`/library/metadata/${ratingKey}/refresh`, { method: 'PUT', refresh: true });
      log(`Refreshed metadata in Plex for "${name}"`);
    } catch (e) {
      log(`Warning: Could not refresh metadata in Plex for "${name}": ${e.message}`);
    }
  }

  /** Called after images were written for an item. */
  async scheduleRefresh(item, attempt = 0) {
    if (!this.connected) return;
    const cfg = this.store.data;
    let found = null;
    try {
      found = await this.find(item);
    } catch (e) {
      log(`Plex lookup failed for "${item.name}": ${e.message}`);
    }
    if (!found) {
      if (attempt >= 6) {
        log(`Could not find "${item.name}" in Plex, giving up`);
        return;
      }
      log(`Could not find "${item.name}" in Plex, trying again in 1m`);
      const t = setTimeout(() => this.scheduleRefresh(item, attempt + 1), Number(process.env.RPDB_PLEX_RETRY_MS) || 60000);
      t.unref?.();
      return;
    }
    const mode = cfg.plexDelayType;
    if (!mode || mode === 'none') return this.refreshNow(found.ratingKey, item.name);
    if (mode === 'delay') {
      if (this.timers.has(found.ratingKey)) return;
      const t = setTimeout(() => {
        this.timers.delete(found.ratingKey);
        this.refreshNow(found.ratingKey, item.name);
      }, Number(cfg.plexRefreshDelay) || 0);
      t.unref?.();
      this.timers.set(found.ratingKey, t);
      return;
    }
    this.queue.set(found.ratingKey, item.name);
    this.armTod();
  }

  armTod() {
    if (this.todTimer) return;
    const c = this.store.data;
    const at = nextTimeOfDay(c.plexTodHour, c.plexTodMin, c.plexTodAmPm);
    this.todTimer = setTimeout(async () => {
      this.todTimer = null;
      const items = [...this.queue.entries()];
      this.queue.clear();
      log(`Starting metadata refresh for items in Plex, items queued: ${items.length}`);
      for (const [rk, name] of items) {
        await this.refreshNow(rk, name);
        await sleep(500);
      }
    }, at.getTime() - Date.now());
    this.todTimer.unref?.();
  }

  stop() {
    clearTimeout(this.todTimer);
    for (const t of this.timers.values()) clearTimeout(t);
  }
}
