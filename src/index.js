#!/usr/bin/env node
import { ConfigStore } from './config.js';
import { log, isDocker } from './util.js';
import { Engine } from './engine.js';
import { Matcher } from './match.js';
import { PlexClient } from './plex.js';
import { Watchers } from './watcher.js';
import { Scheduler } from './scheduler.js';
import { createApp } from './server.js';
import { runRemote, REMOTE_COMMANDS } from './remote.js';

export function parseArgs(argv) {
  const out = { noBrowser: false, host: undefined, remote: undefined, port: undefined };
  const val = (a) => a.slice(a.indexOf('=') + 1).replace(/^["']|["']$/g, '');
  for (const a of argv) {
    if (a === '--no-browser') out.noBrowser = true;
    else if (a.startsWith('--host=')) out.host = val(a);
    else if (a.startsWith('--remote=')) out.remote = val(a);
    else if (a.startsWith('--port=')) out.port = Number(val(a));
  }
  return out;
}

export async function startServer({ store = new ConfigStore(), host, port, noBrowser = true, startBackground = true } = {}) {
  const plex = new PlexClient(store);
  const matcher = new Matcher({ store, plex });
  const engine = new Engine({ store, matcher, plex });
  const watchers = new Watchers({ store, engine });
  const scheduler = new Scheduler({ store, engine });
  let listenPort = port ?? (Number(process.env.RPDB_PORT) || store.data.port || 8750);
  const ctx = { store, engine, matcher, plex, watchers, port: () => listenPort };
  const app = createApp(ctx);
  const listenHost = host ?? (store.data.host || '0.0.0.0');

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(listenPort, listenHost, () => resolve(s));
    s.on('error', reject);
  });
  listenPort = server.address().port;
  log(`RPDB Folders running at: http://127.0.0.1:${listenPort}/`);

  if (!noBrowser && !isDocker()) {
    try {
      const { spawn } = await import('node:child_process');
      const url = `http://127.0.0.1:${listenPort}/`;
      const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
      spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    } catch { /* no browser available */ }
  }

  if (startBackground) {
    const c = store.data;
    watchers.startAll();
    if (c.plex.host && c.plex.token) plex.test(c.plex).then((ok) => { plex.connected = ok; });
    if (!c.ignoreInitialScan) {
      engine.scanAll().catch((e) => log(`Initial scan failed: ${e.message}`));
    }
    scheduler.start();
  }

  const close = async () => {
    scheduler.stop();
    plex.stop();
    await watchers.stopAll();
    await new Promise((r) => server.close(r));
    server.closeAllConnections?.();
  };
  return { server, app, ctx, close, port: listenPort };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.remote !== undefined) {
    if (!REMOTE_COMMANDS.includes(args.remote)) {
      throw new Error(`Unsupported remote command "${args.remote}". Supported commands: ${REMOTE_COMMANDS.join(', ')}`);
    }
    const store = new ConfigStore();
    const ok = await runRemote(args.remote, store.data, { port: Number(process.env.RPDB_REMOTE_PORT) || 8750 });
    log(ok ? 'Successfully sent remote commands' : 'Failed sending remote commands');
    process.exit(0);
  }
  const { close } = await startServer({ host: args.host, port: args.port, noBrowser: args.noBrowser });
  const stop = () => close().finally(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
