export const REMOTE_COMMANDS = [
  'full-scan', 'force-overwrite-scan', 'movie-scan', 'tv-scan', 'overwrite-movie-scan', 'overwrite-tv-scan',
];

export function remoteUrls(cmd, cfg, port = 8750) {
  const base = `http://127.0.0.1:${port}/`;
  const pass = cfg.pass ? `&pass=${encodeURIComponent(cfg.pass)}` : '';
  const enc = encodeURIComponent;
  const passOnly = cfg.pass ? `?pass=${enc(cfg.pass)}` : '';
  if (cmd === 'full-scan') return [`${base}runFullScan${passOnly}`];
  if (cmd === 'force-overwrite-scan') return [`${base}forceOverwriteScan${passOnly}`];
  const route = cmd.startsWith('overwrite-') ? 'forceOverwriteScan' : 'runFullScan';
  const type = cmd.includes('movie') ? 'movie' : 'series';
  return (cfg.mediaFolders?.[type] || []).map((f) => `${base}${route}?folder=${enc(f)}&type=${type}${pass}`);
}

/** Send commands sequentially to the running instance. Returns true when all calls succeeded. */
export async function runRemote(cmd, cfg, { port = 8750 } = {}) {
  let ok = true;
  for (const url of remoteUrls(cmd, cfg, port)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) ok = false;
      await res.arrayBuffer();
    } catch {
      ok = false;
    }
  }
  return ok;
}
