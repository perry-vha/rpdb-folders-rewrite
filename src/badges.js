import fs from 'node:fs';
import path from 'node:path';
import { log, atomicWriteFile, findVideos, SUB_EXT, stripExt } from './util.js';
import { isPartFile } from './parse.js';

// ISO 639-3 (and common 639-2/B) to 639-1
export const ISO3_TO_1 = {
  eng: 'en', fra: 'fr', fre: 'fr', deu: 'de', ger: 'de', spa: 'es', ita: 'it', por: 'pt', rus: 'ru', jpn: 'ja',
  kor: 'ko', zho: 'zh', chi: 'zh', ara: 'ar', hin: 'hi', nld: 'nl', dut: 'nl', swe: 'sv', nor: 'no', nob: 'nb',
  dan: 'da', fin: 'fi', pol: 'pl', tur: 'tr', ell: 'el', gre: 'el', heb: 'he', hun: 'hu', ces: 'cs', cze: 'cs',
  slk: 'sk', slo: 'sk', ron: 'ro', rum: 'ro', bul: 'bg', ukr: 'uk', hrv: 'hr', srp: 'sr', slv: 'sl', tha: 'th',
  vie: 'vi', ind: 'id', msa: 'ms', may: 'ms', fas: 'fa', per: 'fa', ben: 'bn', tam: 'ta', tel: 'te', urd: 'ur',
  cat: 'ca', eus: 'eu', baq: 'eu', glg: 'gl', isl: 'is', ice: 'is', lit: 'lt', lav: 'lv', est: 'et', gle: 'ga',
  cym: 'cy', wel: 'cy', lat: 'la', afr: 'af', swa: 'sw', fil: 'tl', tgl: 'tl', mkd: 'mk', mac: 'mk', alb: 'sq',
  sqi: 'sq', bos: 'bs', hye: 'hy', arm: 'hy', kat: 'ka', geo: 'ka', mon: 'mn', nep: 'ne', sin: 'si', mal: 'ml',
  kan: 'kn', mar: 'mr', pan: 'pa', guj: 'gu', bel: 'be', aze: 'az', kaz: 'kk', uzb: 'uz',
};

export function normLang(code) {
  if (!code) return null;
  let c = String(code).toLowerCase().split(/[-_ ]/)[0];
  if (c.length === 3) c = ISO3_TO_1[c] || null;
  return c && c.length === 2 ? c : null;
}

// Locale list from the original app's langs.js; the first entry per language decides its country.
const LOCALES = `aa_ET af_ZA sq_AL am_ET ar_DZ ar_BH ar_EG ar_IQ ar_JO ar_KW ar_LB ar_LY ar_MA ar_OM ar_QA ar_SA ar_SD ar_SY
  ar_TN ar_AE ar_YE hy_AM as_IN ay_PE az_AZ eu_ES be_BY bn_BD bi_VU bg_BG my_MM km_KH ca_ES zh_TW zh_HK zh_MO zh_CN
  zh_SG co_FR co_IT hr_HR cs_CZ da_DK nl_NL nl_BE en_US en_GB en_AU en_BZ en_BW en_CA en_CB en_DK en_IE en_JM en_NZ
  en_PH en_ZA en_TT en_ZW et_EE fo_FO fa_IR fj_FJ fi_FI fr_FR fr_BE fr_CA fr_LU fr_MC fr_CH fy_NL gl_ES ka_GE de_DE
  de_AT de_BE de_LI de_LU de_CH el_GR kl_GL gn_PY gu_IN ha_NG he_IL hi_IN hu_HU is_IS id_ID iu_CA ga_IE it_IT it_CH
  ja_JP jw_ID kn_IN ks_PK ks_IN kk_KZ kw_GB rw_RW ky_KG rn_BI ko_KR ku_TR lo_LA lv_LV ln_CD lt_LT mk_MK mg_MG ms_MY
  ml_IN ms_BN mt_MT mi_NZ mr_IN mo_MD mn_MN na_NR ne_NP ne_IN no_NO nb_NO nn_NO oc_ES or_IN om_ET ps_AF pl_PL pt_PT
  pt_BR pa_PK qu_PE rm_CH ro_RO ru_RU ru_UA se_NO sm_WS sg_CF sa_IN gd_GB-SCT sr_SR st_LS tn_ZA sn_ZW sd_PK si_LK
  ss_SZ sk_SK sl_SI so_SO es_ES es_AR es_BO es_CL es_CO es_CR es_DO es_EC es_SV es_GT es_HN es_MX es_NI es_PA es_PY
  es_PE es_PR es_UY es_US es_VE su_ID sw_KE sv_SE sv_FI tl_PH tg_TJ ta_IN tt_RU te_IN th_TH bo_CH ti_ER to_TO ts_ZA
  tr_TR tk_TM tw_GH ug_TR uk_UA ur_IN ur_PK uz_UZ vi_VN cy_GB-WLS wo_SN xh_ZA yi_DE yo_NG za_CN zu_ZA sah_RU pap_AW
  gsw_CH ak_GH os_IR cn_CN`.split(/\s+/);

export function countryForLang(lang, prefer) {
  if (lang && prefer && LOCALES.includes(`${lang}_${String(prefer).toUpperCase()}`)) return String(prefer).toUpperCase();
  const hit = lang && LOCALES.find((l) => l.startsWith(`${lang}_`));
  return hit ? hit.slice(lang.length + 1) : null;
}

export function resolutionLabel(w, h) {
  if (!w && !h) return null;
  const brackets = [
    ['4k', 2160, 3840], ['2k', 1440, 2560], ['1080p', 1080, 1920], ['720p', 720, 1280], ['576p', 576, 1024],
    ['480p', 480, 854], ['360p', 360, 640],
  ];
  // Cropped video: a width at or above a bracket's width counts as that bracket.
  for (const [label, bh, bw] of brackets) {
    if ((h && h >= bh * 0.92) || (w && w >= bw * 0.96)) return label;
  }
  return '240p';
}

export function nameHasHdr(name) {
  return /[[{](hdr10\+?|hdr)[\]}]/i.test(name);
}

/** Convert a mediainfo.js object-format result into the rpdb.json layout. */
export function probeFromMediaInfo(result, fileName) {
  const tracks = result?.media?.track || [];
  const general = tracks.find((t) => t['@type'] === 'General') || {};
  const video = tracks.find((t) => t['@type'] === 'Video');
  const audio = tracks.filter((t) => t['@type'] === 'Audio');
  const text = tracks.filter((t) => t['@type'] === 'Text');
  const w = Number(video?.Width) || 0;
  const h = Number(video?.Height) || 0;
  const hdrFormat = video?.HDR_Format || '';
  const isDolbyVision = /dolby vision/i.test(hdrFormat);
  const isHdr = Boolean(hdrFormat)
    || (Number(video?.BitDepth) >= 10 && /2020/.test(video?.colour_primaries || video?.ColorPrimaries || ''))
    || nameHasHdr(fileName);
  const extra = general.extra || {};
  const imdbId = extra.IMDB || extra.IMDb || extra.imdb || extra.IMDB_ID;
  const tmdbId = extra.TMDB || extra.tmdb || extra.TMDB_ID;
  const chans = Math.max(0, ...audio.map((a) => Number(a.Channels) || 0));
  return {
    hasVideoStream: Boolean(video),
    videoWidth: w, videoHeight: h, videoRes: resolutionLabel(w, h), quality: resolutionLabel(w, h),
    codecs: { video: video?.Format || null, audio: audio.map((a) => a.Format).filter(Boolean) },
    audioCommercial: audio.map((a) => a.Format_Commercial_IfAny).filter(Boolean),
    audioChans: chans, audioChannels: chans,
    languages: audio.map((a) => a.Language).filter(Boolean),
    subtitles: text.map((t) => t.Language).filter(Boolean),
    isHdr, isDolbyVision,
    container: path.extname(fileName).slice(1).toLowerCase(),
    imdbId: /^tt\d+$/i.test(imdbId || '') ? imdbId.toLowerCase() : undefined,
    tmdbId: tmdbId ? String(tmdbId) : undefined,
  };
}

let mediaInfoPromise;
function getMediaInfo() {
  if (!mediaInfoPromise) {
    mediaInfoPromise = import('mediainfo.js').then((m) => (m.default || m.mediaInfoFactory)({ format: 'object' }));
  }
  return mediaInfoPromise;
}

export async function probeFile(file) {
  const mi = await getMediaInfo();
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const readChunk = async (chunkSize, offset) => {
      const buf = new Uint8Array(chunkSize);
      const { bytesRead } = await fh.read(buf, 0, chunkSize, offset);
      return buf.subarray(0, bytesRead);
    };
    const result = await mi.analyzeData(size, readChunk);
    return probeFromMediaInfo(result, path.basename(file));
  } finally {
    await fh.close();
  }
}

export function externalSubtitleLangs(videoFile, siblings) {
  const base = stripExt(path.basename(videoFile)).toLowerCase();
  const langs = [];
  for (const s of siblings) {
    const l = s.toLowerCase();
    if (!SUB_EXT.includes(path.extname(l)) || !l.startsWith(base)) continue;
    const rest = stripExt(l.slice(base.length)).split(/[.\-_ ]+/).filter(Boolean);
    for (const r of rest) {
      const c = normLang(r);
      if (c && (r.length === 2 || r.length === 3)) langs.push(c);
    }
  }
  return langs;
}

const isSeasonZero = (p) => p.split(path.sep).some((s) => /^(season ?0+|specials)$/i.test(s));

/** Choose the video that represents an item. */
export async function pickProbeVideo(itemPath, isFile, type) {
  if (isFile) return itemPath;
  const vids = await findVideos(itemPath);
  if (!vids.length) return null;
  if (type === 'series') return vids.find((v) => !isSeasonZero(path.relative(itemPath, v))) || null;
  if (vids.length > 1 && vids.every((v) => isPartFile(path.basename(v)))) return vids[0];
  const sized = await Promise.all(vids.map(async (v) => ({ v, s: (await fs.promises.stat(v)).size })));
  sized.sort((a, b) => b.s - a.s);
  return sized[0].v;
}

export function probeCachePath(itemPath, isFile) {
  return isFile
    ? path.join(path.dirname(itemPath), `${stripExt(path.basename(itemPath))}-rpdb.json`)
    : path.join(itemPath, 'rpdb.json');
}

/** Load probe data from cache or probe the video. Returns null when unavailable. */
export async function getProbeData({ itemPath, isFile, type, overwrite }) {
  const cacheFile = probeCachePath(itemPath, isFile);
  if (!overwrite) {
    try {
      return JSON.parse(await fs.promises.readFile(cacheFile, 'utf8'));
    } catch { /* fall through to probing */ }
  }
  log('Missing rpdb.json, continuing to probe video file.');
  const video = await pickProbeVideo(itemPath, isFile, type);
  if (!video) {
    log(`Warning: Could not find any video file for the ${type === 'series' ? 'series' : 'movie'} in order to probe`);
    return null;
  }
  let data;
  try {
    data = await probeFile(video);
    const siblings = await fs.promises.readdir(path.dirname(video));
    data.subtitles = [...new Set([...(data.subtitles || []).map(normLang).filter(Boolean), ...externalSubtitleLangs(video, siblings)])];
    data.fileName = path.basename(video);
  } catch {
    log('Missing video probing response');
    return null;
  }
  try {
    await atomicWriteFile(cacheFile, JSON.stringify(data, null, 2));
  } catch {
    log('Warning: Could not write rpdb.json file to folder after probing the video file');
  }
  return data;
}

/** Accept rpdb.json files written by the original app (languages {audio, subtitles}, audioChannels "5.1", filename). */
export function normalizeProbe(p) {
  if (!p || typeof p !== 'object') return {};
  const out = { ...p };
  if (p.languages && !Array.isArray(p.languages)) {
    out.languages = p.languages.audio || [];
    out.subtitles = p.languages.subtitles || [];
  }
  if (typeof p.audioChannels === 'string') {
    const [main, lfe] = p.audioChannels.split('.').map(Number);
    out.audioChans = out.audioChannels = (main || 0) + (lfe || 0);
  }
  if (Array.isArray(p.codecs?.video)) {
    const v = p.codecs.video;
    out.codecs = { ...p.codecs, video: v.find((c) => /hevc|265/i.test(c)) || v[0] || null };
  }
  if (!out.videoRes && !out.quality && (p.videoWidth || p.videoHeight)) out.videoRes = resolutionLabel(p.videoWidth, p.videoHeight);
  if (!out.fileName && p.filename) out.fileName = p.filename;
  return out;
}

/** Map an autoBadges sub-query plus probe data to a badge list. Pure, no I/O. */
export function autoBadgesFromProbe(subQuery, rawProbe, defaults = {}) {
  // Without probe data, only badges that need no video (age ratings, spoken language) are produced.
  const probe = normalizeProbe(rawProbe);
  const q = new URLSearchParams(subQuery);
  const out = [];
  const name = (probe.fileName || '').toLowerCase();
  const d = { dolbyvision: 'dolbyvision', hdr: 'hdrcolor', remux: 'remuxgold', ...defaults };
  if (q.get('ageRating') === '1') out.push('commonsensegold');
  if (q.get('usAgeRating') === '1') out.push('us_age_rating_gold');
  if (q.get('videoQuality') === '1') {
    const r = probe.videoRes || probe.quality;
    if (r) out.push(r);
  }
  if (q.get('colorRange') === '1') {
    if (probe.isDolbyVision) out.push(d.dolbyvision);
    else if (probe.isHdr) out.push(d.hdr);
  }
  if (q.get('videoCodec') === '1') {
    const v = String(probe.codecs?.video || '').toLowerCase();
    if (v === 'avc' || v.includes('264')) out.push('h264');
    else if (v === 'hevc' || v.includes('265')) out.push('h265');
  }
  if (q.get('audioChannels') === '1') {
    const c = probe.audioChans || probe.audioChannels || 0;
    if (c >= 8) out.push('audio71');
    else if (c >= 6) out.push('audio51');
    else if (c > 0) out.push('audio20');
  }
  if (q.get('videoSource') === '1') {
    if (name.includes('remux')) out.push(d.remux);
    else if (/blu-?ray|brrip|bdrip/.test(name)) out.push('bluray');
    else if (/web-?dl|webrip|\bweb\b/.test(name)) out.push('web');
    else if (/dvd/.test(name)) out.push('dvd');
  }
  const cf = q.get('countryFlag');
  if (cf && cf !== 'none') {
    const where = q.get('countryFlagWhere');
    const audio = (probe.languages || []).map(normLang).filter(Boolean);
    const subs = (probe.subtitles || []).map(normLang).filter(Boolean);
    const pool = where === 'audio' ? audio : where === 'sub' ? subs : [...audio, ...subs];
    if (cf === 'spoken-lang') out.push('auto_lang');
    else if (cf === 'spoken-lang-no-us') out.push('auto_lang_no_en');
    else if (cf === 'detect') {
      const n = Number.parseInt(q.get('countryFlagDetectCount') || '1', 10) || 1;
      const countries = [...new Set(pool.map(countryForLang).filter(Boolean))];
      for (const c of countries.slice(0, n)) out.push(`country.${c}`);
    } else if (cf.includes('_')) {
      // e.g. "en_US": show country.us when English audio/subtitles are present
      const [lang, country] = cf.split('_');
      const want = normLang(lang);
      if (want && country && pool.includes(want)) out.push(`country.${country.replace('-', '_').toLowerCase()}`);
    }
  }
  return [...new Set(out)].join(',');
}
