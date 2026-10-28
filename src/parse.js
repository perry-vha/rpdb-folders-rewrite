import { VIDEO_EXT } from './util.js';
import path from 'node:path';

export function sanitizeName(s) {
  return String(s || '').toLowerCase().replace(/^the /, '').replace(/[^\p{L}\p{N}]/gu, '');
}

export function stripVideoExt(name) {
  const ext = path.extname(name).toLowerCase();
  return VIDEO_EXT.includes(ext) ? name.slice(0, -ext.length) : name;
}

// Embedded IDs: [imdb-tt123], {tmdb=123}, [tvdb:123]
export function extractEmbeddedIds(name) {
  const ids = {};
  const re = /[[{]\s*(imdb|tmdb|tvdb)\s*[-:=]\s*(tt\d+|\d+)\s*[\]}]/gi;
  let m;
  while ((m = re.exec(name))) {
    const k = m[1].toLowerCase();
    if (ids[k]) continue;
    if (k === 'imdb' && !/^tt\d+$/i.test(m[2])) continue;
    if (k !== 'imdb' && /^tt/i.test(m[2])) continue;
    ids[k] = k === 'imdb' ? m[2].toLowerCase() : m[2];
  }
  return ids;
}

export function parseImdbId(text) {
  const m = /tt\d+/i.exec(String(text || ''));
  return m ? m[0].toLowerCase() : null;
}

export function parseTmdbId(url) {
  const m = /themoviedb\.org\/(?:movie|tv)\/(\d+)/i.exec(String(url || ''));
  return m ? m[1] : null;
}

const QUALITY_RE = /^(480p|576p|720p|1080p|1080i|2160p|4k|8k|uhd|bluray|blu-ray|bdrip|brrip|bdremux|remux|webrip|web-dl|webdl|web|hdtv|dvdrip|dvdscr|dvd|hdrip|hdr|hdr10|hdr10\+|dv|dovi|x264|x265|h264|h265|h\.264|h\.265|hevc|avc|xvid|divx|aac|ac3|dts|dts-hd|truehd|atmos|ddp5|ddp|dd5|10bit|proper|repack|extended|unrated|remastered|imax|multi|dubbed|internal|limited)$/i;
const EPISODE_RE = /^(s\d{1,2}(e\d{1,3})?(-?e\d{1,3})?|\d{1,2}x\d{2}|season|complete)$/i;

function looksLikeRelease(s) {
  if (/\s/.test(s.trim()) && !/\.\d{4}\./.test(s)) return false;
  const tokens = s.split(/[.\s_]+/);
  return tokens.length > 2 && tokens.some((t) => QUALITY_RE.test(t) || /^(19|20)\d{2}$/.test(t));
}

// Parse a scene-style name such as "Alien.1979.1080p.BluRay.x264".
export function parseRelease(s) {
  const tokens = s.split(/[.\s_]+/).filter(Boolean);
  const titleTokens = [];
  let year = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const isYear = /^\(?(19|20)\d{2}\)?$/.test(t);
    if (isYear && titleTokens.length > 0) {
      year = Number(t.replace(/[()]/g, ''));
      break;
    }
    if ((QUALITY_RE.test(t) || EPISODE_RE.test(t)) && titleTokens.length > 0) break;
    titleTokens.push(t.replace(/^[([]|[)\]]$/g, ''));
  }
  return { title: titleTokens.join(' ').trim(), year };
}

/**
 * Turn a folder or file name into { title, year }.
 */
export function parseName(rawName, { isFile = false } = {}) {
  let name = isFile ? stripVideoExt(rawName) : rawName;
  name = name.replace(/\s*\{[^}]*\}/g, '');
  name = name.replace(/\s*\[([^\]]{5,99})\]\s*$/, '');
  // Run twice so stacked trailing tags (e.g. "[imdb-tt1] [x]") are all removed.
  name = name.replace(/\s*\[([^\]]{5,99})\]\s*$/, '').trim();

  let m = /^(.*?)\s*\(((?:19|20)\d{2})(?:\s*-\s*(?:(?:19|20)\d{2})?)?\)$/.exec(name);
  if (!m) m = /^(.*\S)\s+((?:19|20)\d{2})(?:-(?:19|20)\d{2})?$/.exec(name);
  if (!m) m = /^(.*?)\s*\[((?:19|20)\d{2})\]$/.exec(name);
  if (m && m[1].trim()) return { title: collapse(m[1]), year: Number(m[2]) };

  if (looksLikeRelease(name)) {
    const r = parseRelease(name);
    if (r.title) return { title: collapse(r.title), year: r.year };
  }
  return { title: collapse(name.replace(/[._]+/g, (x, i) => (/\s/.test(name) ? x : ' '))), year: null };
}

function collapse(s) {
  return s.replace(/\s+/g, ' ').trim();
}

export function searchTitle(title, type) {
  return type === 'series' ? title.replace(/^marvel ?'?s /i, '') : title;
}

export function isPartFile(name) {
  return /(?:^|[\s._-])(?:cd|part|pt)?[\s._-]?[1-6]\.[a-z0-9]{2,4}$/i.test(name);
}
