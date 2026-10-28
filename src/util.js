import fs from 'node:fs';
import path from 'node:path';

export function log(...args) {
  const d = new Date();
  const ts = d.toLocaleString('en-US');
  console.log(`[${ts}]`, ...args);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function atomicWriteFileSync(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export async function atomicWriteFile(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tmp, data);
  await fs.promises.rename(tmp, file);
}

export const VIDEO_EXT = ['.mkv', '.avi', '.mp4', '.m4v', '.ts'];
export const SUB_EXT = ['.srt', '.smi', '.ssa', '.ass', '.vtt', '.sub'];

export function isVideoFile(name) {
  const l = name.toLowerCase();
  if (l.includes('-trailer.')) return false;
  return VIDEO_EXT.includes(path.extname(l));
}

export function isDirectoryNameVisible(name) {
  return !name.startsWith('.');
}

export function isDocker() {
  if (process.env.RPDB_DOCKER === '1') return true;
  if (process.env.RPDB_DOCKER === '0') return false;
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    return /docker|kubepods|containerd/.test(fs.readFileSync('/proc/1/cgroup', 'utf8'));
  } catch {
    return false;
  }
}

export function stripExt(name) {
  const ext = path.extname(name);
  return ext ? name.slice(0, -ext.length) : name;
}

// Recursively look for a video file (used for noPostersToEmptyFolders and probing).
export async function findVideos(dir, depth = 4) {
  const out = [];
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isFile() && isVideoFile(e.name)) out.push(p);
    else if (e.isDirectory() && depth > 0 && isDirectoryNameVisible(e.name)) out.push(...(await findVideos(p, depth - 1)));
  }
  return out;
}
