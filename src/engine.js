import fs from 'node:fs';
import path from 'node:path';
import { log, sleep, isVideoFile, isDirectoryNameVisible, findVideos, stripExt } from './util.js';
import { buildImageUrl, RPDB_BASE } from './rpdb.js';
import { getProbeData, autoBadgesFromProbe } from './badges.js';
import { renderLocalPoster, renderLocalArt } from './local-poster.js';
import { MdblistLimitError, mdblistKeysOf } from './ratings.js';

const exists = (p) => fs.promises.access(p).then(() => true, () => false);

export function outputPaths(root, name, isFile) {
  if (!isFile) {
    const dir = path.join(root, name);
    return { poster: path.join(dir, 'poster.jpg'), backdrop: path.join(dir, 'background.jpg'), logo: path.join(dir, 'logo.png') };
  }
  const base = stripExt(name);
  return {
    poster: path.join(root, `${base}.jpg`),
    backdrop: path.join(root, `${base}-fanart.jpg`),
    logo: path.join(root, `${base}-logo.png`),
  };
}

export async function listItems(root) {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    let isDir = e.isDirectory();
    let isF = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = await fs.promises.stat(path.join(root, e.name));
        isDir = st.isDirectory();
        isF = st.isFile();
      } catch { continue; }
    }
    if (!isDirectoryNameVisible(e.name)) continue;
    if (isDir) items.push({ name: e.name, isFile: false });
    else if (isF && isVideoFile(e.name)) items.push({ name: e.name, isFile: true });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export class Engine {
  constructor({ store, matcher, plex }) {
    this.store = store;
    this.matcher = matcher;
    this.plex = plex;
    this.queue = [];
    this.running = false;
    this.listing = 0;
    this.scanLeft = 0;
    this.keyState = { at: 0, state: null };
    this.queueDelay = process.env.RPDB_QUEUE_DELAY_MS !== undefined ? Number(process.env.RPDB_QUEUE_DELAY_MS) : 1000;
    this.writeRetryMs = Number(process.env.RPDB_WRITE_RETRY_MS) || 4 * 3600 * 1000;
    this.idleWaiters = [];
    this.pausedUntil = 0;
    this.wake = null;
  }

  // Persisted so "Added images to N folders" survives restarts
  get historyCount() {
    return Number(this.store.data.historyCount) || 0;
  }

  get cfg() {
    return this.store.data;
  }

  get scanActive() {
    return this.listing > 0 || this.scanLeft > 0;
  }

  get queueLength() {
    return this.queue.length + (this.running && !this.pausedUntil ? 1 : 0);
  }

  /** Find the media folder holding an item of this type. */
  findItemRoot(type, name) {
    for (const root of this.cfg.mediaFolders[type] || []) {
      try {
        const st = fs.statSync(path.join(root, name));
        return { root, isFile: st.isFile() };
      } catch { /* try next folder */ }
    }
    return null;
  }

  enqueue(item, { front = false } = {}) {
    const key = `${item.type}:${item.name}`;
    const existing = this.queue.find((q) => `${q.type}:${q.name}` === key);
    if (existing) {
      existing.overwrite ||= item.overwrite;
      existing.force ||= item.force;
      if (item.source) existing.source = item.source;
      return false;
    }
    if (item.scan) this.scanLeft++;
    if (front) this.queue.unshift(item);
    else this.queue.push(item);
    this.kick();
    return true;
  }

  kick() {
    if (this.running) return;
    this.running = true;
    this.loop().finally(() => {
      this.running = false;
      this.idleWaiters.splice(0).forEach((f) => f());
    });
  }

  async idle() {
    while (this.running || this.queue.length || this.listing) {
      await new Promise((r) => {
        this.idleWaiters.push(r);
        if (!this.running && !this.queue.length) setTimeout(r, 20);
      });
    }
  }

  cancel() {
    this.queue = [];
    this.scanLeft = 0;
    this.resume();
  }

  /** End a rate-limit pause early (keys changed, queue cancelled). */
  resume() {
    this.wake?.();
  }

  async pauseUntil(until, name) {
    this.pausedUntil = until;
    log(`All MDBList keys reached their request limit. Paused at ${name} until ${new Date(until).toLocaleString('en-US')}`);
    let timer;
    await new Promise((r) => {
      this.wake = r;
      // setTimeout caps at ~24.8 days; a longer wait simply pauses again
      timer = setTimeout(r, Math.min(Math.max(0, until - Date.now()) + 5000, 2 ** 31 - 1));
    });
    clearTimeout(timer);
    this.wake = null;
    this.pausedUntil = 0;
  }

  async loop() {
    while (this.queue.length) {
      const item = this.queue.shift();
      log(`Items left in queue: ${this.queue.length}`);
      let usedApi = false;
      try {
        usedApi = await this.processItem(item);
      } catch (e) {
        if (e instanceof MdblistLimitError) {
          this.queue.unshift(item);
          await this.pauseUntil(e.until, item.name);
          if (this.queue.length) log(`Resuming at ${this.queue[0].name}`);
          continue;
        }
        log(`Error processing ${item.name}: ${e.message}`);
      }
      if (item.scan && this.scanLeft > 0) this.scanLeft--;
      if (usedApi && this.queue.length && this.queueDelay) await sleep(this.queueDelay);
    }
  }

  async keyStatus() {
    const k = this.cfg.apiKey;
    if (!k) return 'missing';
    if (this.keyState.state === 'valid' && Date.now() - this.keyState.at < 600000 && this.keyState.key === k) return 'valid';
    try {
      const res = await fetch(`${RPDB_BASE()}/${k}/isValid`, { signal: AbortSignal.timeout(15000) });
      let valid = false;
      if (res.ok) valid = (await res.json().catch(() => ({}))).valid === true;
      this.keyState = { at: Date.now(), state: valid ? 'valid' : 'invalid', key: k };
    } catch {
      this.keyState = { at: 0, state: 'error', key: k };
    }
    return this.keyState.state;
  }

  retryOldAllowed() {
    const c = this.cfg;
    if (!c.retryFrequency) return true;
    const now = new Date();
    const m = now.getFullYear() * 12 + now.getMonth();
    return c.lastRetryMonth < 0 || m - c.lastRetryMonth >= c.retryFrequency;
  }

  async retryAllowed(itemPath) {
    try {
      const st = await fs.promises.stat(itemPath);
      const born = new Date(st.birthtimeMs || st.mtimeMs);
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - this.cfg.retryNewerThanMonths);
      if (born > cutoff) return true;
    } catch { /* fall through */ }
    return this.retryOldAllowed();
  }

  // Item-level badge settings beat folder-level ones.
  async badgesFor(it, imdb, itemPath) {
    const c = this.cfg;
    const iAuto = c.itemAutoBadges[imdb];
    const iManual = c.itemBadges[imdb];
    const fAuto = c.autoBadges[it.root];
    const auto = iAuto || (!iManual && fAuto) || '';
    if (!auto) return undefined;
    const probe = await getProbeData({ itemPath, isFile: it.isFile, type: it.type, overwrite: c.overwriteProbeData });
    return autoBadgesFromProbe(auto, probe, c.defaultBadges);
  }

  async renderLocal({ kind = 'poster', type, imdb, root, badgeCsv }, dest, name) {
    const label = { poster: 'Poster', backdrop: 'Backdrop', logo: 'Logo' }[kind];
    let buf;
    try {
      const args = { cfg: this.cfg, matcher: this.matcher, type, imdb, root, badgeCsv };
      buf = kind === 'poster' ? await renderLocalPoster(args) : await renderLocalArt({ ...args, kind });
    } catch (e) {
      if (e instanceof MdblistLimitError) throw e;
      log(`Could not render ${label.toLowerCase()} for ${name}: ${e.message}`);
      return 'error';
    }
    if (!buf) {
      log(`No ${kind === 'poster' ? 'artwork' : label.toLowerCase()} available for ${name}`);
      return 'none';
    }
    const tmp = `${dest}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, dest);
    } catch {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      return 'write-error';
    }
    log(`${label} for ${name} rendered locally`);
    return 'ok';
  }

  async download(url, dest, label, name) {
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    } catch (e) {
      log(`Could not reach RPDB for ${label.toLowerCase()} of ${name}: ${e.message}`);
      return 'error';
    }
    if (res.status !== 200) {
      log(`No ${label.toLowerCase()} available for ${name}`);
      await res.arrayBuffer().catch(() => {});
      return 'none';
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const tmp = `${dest}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, dest);
    } catch {
      await fs.promises.rm(tmp, { force: true }).catch(() => {});
      return 'write-error';
    }
    log(`${label} for ${name} downloaded`);
    return 'ok';
  }

  /** Returns true when RPDB/network was used (for pacing). */
  async processItem(it) {
    const c = this.cfg;
    const { type, root, name, isFile } = it;
    const itemPath = path.join(root, name);
    if (!(await exists(itemPath))) return false;
    if (!isFile && c.noPostersToEmptyFolders && !(await findVideos(itemPath)).length) {
      log(`Skipping empty folder: ${name}`);
      return false;
    }
    const out = outputPaths(root, name, isFile);
    const full = Boolean(it.overwrite || it.force);

    const cachedImdb = c.overwriteMatches[type]?.[name] || c.imdbCache[type]?.[name];
    if (!full && !it.source) {
      const logoThere = async () => (await exists(out.logo)) || (isFile && await exists(out.logo.replace(/\.png$/, '.jpg')));
      const have = (await exists(out.poster))
        && (!c.backdrops || await exists(out.backdrop))
        && (!c.logos || await logoThere());
      if (have && !(cachedImdb && c.customPosters[cachedImdb])) return false;
    }

    const local = c.posterEngine === 'local';
    if (local) {
      if (!mdblistKeysOf(c).length) {
        log('The local engine needs an MDBList API Key');
        return false;
      }
    } else {
      const status = await this.keyStatus();
      if (status !== 'valid') {
        log(status === 'invalid' ? 'API Key is Invalid' : 'API Key Could Not be Validated');
        return false;
      }
    }

    const m = await this.matcher.match({ type, name, isFile, itemPath });
    if (!m) {
      log(`Could not match ${name}`);
      c.unmatched[type][name] = true;
      this.store.save();
      return true;
    }
    const imdb = m.imdb;
    delete c.unmatched[type][name];
    if (c.cacheMatches && m.how !== 'cache' && m.how !== 'fix') c.imdbCache[type][name] = imdb;
    this.store.save();

    if (it.overwrite && c.overwriteLast2Years && !it.force) {
      const year = await this.matcher.releaseYear(type, name, imdb);
      if (year && year < new Date().getFullYear() - 1) {
        log(`Not within last 2 years, skipping: ${name}`);
        return true;
      }
    }

    if (c.missingPosters[type]?.[name] && !full && !(await this.retryAllowed(itemPath))) {
      log(`Item skipped due to retry frequency setting, folder: ${name}`);
      return true;
    }

    const badges = await this.badgesFor(it, imdb, itemPath);
    const custom = it.source?.kind === 'tmdb' ? undefined : c.customPosters[imdb];
    const base = { type, imdb, root, badges };
    let changed = false;
    let poster = 'skipped';

    if (full || custom || it.source || !(await exists(out.poster))) {
      poster = local
        ? await this.renderLocal({ type, imdb, root, badgeCsv: badges }, out.poster, name)
        : await this.download(buildImageUrl(c, { ...base, kind: 'poster', source: it.source, customTemplate: custom }), out.poster, 'Poster', name);
      if (poster === 'ok') {
        changed = true;
        delete c.missingPosters[type][name];
        delete c.unmatched[type][name];
      } else if (poster === 'none') {
        c.missingPosters[type][name] = true;
      } else if (poster === 'write-error') {
        this.handleWriteError(it, name);
      }
      this.store.save();
    }

    if (poster === 'ok' || poster === 'skipped') {
      if (c.backdrops && (full || !(await exists(out.backdrop)))) {
        const r = local
          ? await this.renderLocal({ kind: 'backdrop', type, imdb, root, badgeCsv: badges }, out.backdrop, name)
          : await this.download(buildImageUrl(c, { ...base, kind: 'backdrop' }), out.backdrop, 'Backdrop', name);
        changed ||= r === 'ok';
      }
      const legacyLogo = isFile && await exists(out.logo.replace(/\.png$/, '.jpg'));
      if (c.logos && (full || !((await exists(out.logo)) || legacyLogo))) {
        const r = local
          ? await this.renderLocal({ kind: 'logo', type, imdb, root }, out.logo, name)
          : await this.download(buildImageUrl(c, { ...base, kind: 'logo' }), out.logo, 'Logo', name);
        changed ||= r === 'ok';
      }
    }

    if (changed) {
      this.store.data.historyCount = this.historyCount + 1;
      this.store.save();
      this.plex?.scheduleRefresh({ name, type, itemPath, isFile });
    }
    return true;
  }

  handleWriteError(it, name) {
    if (it.retried) {
      log(`Warning: Could not write poster to folder for ${name}, tried twice`);
      return;
    }
    log(`Warning: Could not write poster to folder for ${name}, trying again in 4h`);
    const t = setTimeout(() => this.enqueue({ ...it, retried: true, overwrite: true, scan: false }), this.writeRetryMs);
    t.unref?.();
  }

  /** Queue all items of one type. */
  async scan(type, { folder, overwrite = false } = {}) {
    const roots = folder ? [folder] : [...(this.cfg.mediaFolders[type] || [])];
    this.listing++;
    try {
      for (const root of roots) {
        let items;
        try {
          items = await listItems(root);
        } catch {
          log(`Directory ${root} is no longer accessible, skipping media folder scan`);
          continue;
        }
        for (const i of items) this.enqueue({ type, root, ...i, overwrite, scan: true });
      }
    } finally {
      this.listing--;
    }
  }

  async scanAll({ folder, type, overwrite = false } = {}) {
    for (const t of type ? [type] : ['movie', 'series']) await this.scan(t, { folder, overwrite });
  }

  /** Queue a single item (watcher, webhook, UI actions). */
  fetchItem(type, name, opts = {}) {
    const found = this.findItemRoot(type, name);
    if (!found) return false;
    const { front, ...rest } = opts;
    this.enqueue({ type, name, root: found.root, isFile: found.isFile, ...rest }, { front: Boolean(front) });
    return true;
  }
}
