import path from 'node:path';
import chokidar from 'chokidar';
import { log, isVideoFile } from './util.js';

export class Watchers {
  constructor({ store, engine }) {
    this.store = store;
    this.engine = engine;
    this.watchers = new Map(); // root -> {type, watcher}
  }

  watch(type, root) {
    if (this.watchers.has(root)) return;
    const c = this.store.data;
    const w = chokidar.watch(root, {
      ignored: (p) => p !== root && path.basename(p).startsWith('.'),
      persistent: true,
      ignoreInitial: true,
      depth: c.watchFolderDepth,
      usePolling: Boolean(c.usePolling),
      interval: c.pollingInterval,
    });
    const queue = (name, isFile) => this.engine.enqueue({ type, root, name, isFile });
    w.on('addDir', (p) => {
      if (path.dirname(p) !== root) return;
      log(`Directory ${path.basename(p)} has been added to ${type}`);
      queue(path.basename(p), false);
    });
    w.on('add', (p) => {
      if (!isVideoFile(p)) return;
      const rel = path.relative(root, p).split(path.sep);
      if (rel.length === 1) {
        log(`File ${rel[0]} has been added to ${type}`);
        queue(rel[0], true);
      } else if (this.store.data.watchFolderDepth > 0) {
        // Nested file: re-evaluate the top-level folder (duplicate events collapse in the queue)
        queue(rel[0], false);
      }
    });
    w.on('error', (e) => log(`Watcher error for ${root}: ${e.message}`));
    this.watchers.set(root, { type, watcher: w });
  }

  unwatch(root) {
    const w = this.watchers.get(root);
    if (!w) return;
    w.watcher.close().catch(() => {});
    this.watchers.delete(root);
  }

  startAll() {
    if (this.store.data.useWebhook) return;
    for (const type of ['movie', 'series']) for (const root of this.store.data.mediaFolders[type]) this.watch(type, root);
  }

  async stopAll() {
    await Promise.all([...this.watchers.values()].map((w) => w.watcher.close()));
    this.watchers.clear();
  }
}
