import { log } from './util.js';

export class Scheduler {
  constructor({ store, engine }) {
    this.store = store;
    this.engine = engine;
    this.timer = null;
  }

  start() {
    const every = Number(this.store.data.checkFullUpdate) || 3600000;
    this.timer = setInterval(() => this.tick().catch((e) => log(`Scheduler error: ${e.message}`)), every);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick(now = Date.now()) {
    const c = this.store.data;
    let retried = false;
    for (const type of ['movie', 'series']) {
      if (now - c.lastFullUpdate[type] > c.fullUpdate && c.mediaFolders[type].length) {
        log(`Initiating periodic update of all ${type} folders`);
        c.lastFullUpdate[type] = now;
        this.store.save();
        await this.engine.scan(type);
        retried = true;
      }
      if (c.overwrite && now - c.lastOverwrite[type] > c.minOverwritePeriod && c.mediaFolders[type].length) {
        log(`Initiating periodic overwrite of all ${type} folders`);
        c.lastOverwrite[type] = now;
        this.store.save();
        await this.engine.scan(type, { overwrite: true });
      }
    }
    if (retried) {
      // Mark the retry month only after the pass finished so its own items are still retried.
      this.engine.idle().then(() => {
        const d = new Date(now);
        c.lastRetryMonth = d.getFullYear() * 12 + d.getMonth();
        this.store.save();
      });
    }
  }
}
