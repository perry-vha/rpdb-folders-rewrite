import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/config.js';
import {
  buildImageUrl, buildQuery, buildThumbnailUrl, posterPathType, customPosterTemplate, normalizeCreateImg,
  createPosterQuery, createPosterTemplate,
} from '../src/rpdb.js';
import { autoBadgesFromProbe, resolutionLabel, normLang } from '../src/badges.js';

const cfgWith = (patch = {}) => ({ ...defaultConfig(), apiKey: 'k1', ...patch });
const base = { type: 'movie', imdb: 'tt0903747', root: '/m' };

test('plain poster URL has no query', () => {
  assert.equal(buildImageUrl(cfgWith(), { ...base, kind: 'poster' }), 'https://api.ratingposterdb.com/k1/imdb/poster-default/tt0903747.jpg');
});

test('backdrop and logo paths', () => {
  const c = cfgWith();
  assert.equal(buildImageUrl(c, { ...base, kind: 'backdrop' }), 'https://api.ratingposterdb.com/k1/imdb/backdrop-default/tt0903747.jpg');
  assert.equal(buildImageUrl(c, { ...base, kind: 'logo' }), 'https://api.ratingposterdb.com/k1/imdb/logo-default/tt0903747.png');
});

test('poster path type: textless and rating order', () => {
  assert.equal(posterPathType('movie', cfgWith({ moviePosterType: 'poster-rt', movieTextless: true })), 'textless-rt');
  const c = cfgWith({ moviePosterType: 'rating-order', movieRatingOrder: 'imdb,tmdb', movieTextless: true });
  assert.equal(posterPathType('movie', c), 'rating-order');
  assert.match(buildImageUrl(c, { ...base, kind: 'poster' }), /rating-order\/tt0903747\.jpg\?order=imdb%2Ctmdb$/);
});

test('poster-rt adds order to all kinds', () => {
  const c = cfgWith({ moviePosterType: 'poster-rt' });
  for (const kind of ['poster', 'backdrop', 'logo']) {
    assert.match(buildQuery(c, { ...base, kind }), /order=myanimelist%2Cimdb%2Ctomatoes-critics%2Ctomatoes-audience$/);
  }
});

test('query parameter order and language rules', () => {
  const c = cfgWith();
  c.posterLang.movie = 'fr';
  c.posterSecLang.movie = 'de';
  c.labels['/m'] = 'MY LABEL';
  c.badges['/m'] = '4k,hdr';
  c.badgePositions['/m'] = 'right';
  c.maxBadges['/m'] = '3';
  c.badgeSizes['/m'] = 'small';
  c.posterTheme['/m'] = 'blocks';
  assert.equal(
    buildQuery(c, { ...base, kind: 'poster' }),
    'lang=fr&secLang=de&label=MY%20LABEL&badges=4k%2Chdr&badgePos=right&maxBadges=3&badgeSize=small&theme=blocks',
  );
  c.posterLang.movie = 'en';
  c.posterSecLang.movie = 'en';
  assert.ok(!buildQuery(c, { ...base, kind: 'poster' }).includes('lang='));
});

test('item-level values override folder-level, others fall back', () => {
  const c = cfgWith();
  c.labels['/m'] = 'FOLDER';
  c.itemLabels.tt0903747 = 'ITEM';
  c.posterTheme['/m'] = 'blocks';
  c.itemPosterBarPos.tt0903747 = 'top';
  assert.equal(buildQuery(c, { ...base, kind: 'poster' }), 'label=ITEM&theme=blocks&ratingBarPos=top');
});

test('backdrop badges only when enabled; no label', () => {
  const c = cfgWith();
  c.badges['/m'] = '4k,hdr';
  c.labels['/m'] = 'L';
  c.badgePositions['/m'] = 'right';
  assert.equal(buildQuery(c, { ...base, kind: 'backdrop' }), '');
  c.backdropsBadges = true;
  assert.equal(buildQuery(c, { ...base, kind: 'backdrop' }), 'badges=4k%2Chdr');
  c.backdropBadgePositions['/m'] = 'right-bottom';
  c.backdropCertPos['/m'] = 'left';
  assert.equal(buildQuery(c, { ...base, kind: 'backdrop' }), 'badges=4k%2Chdr&badgePos=right-bottom&certsPos=left');
});

test('logo has no label/badges but language', () => {
  const c = cfgWith();
  c.posterLang.movie = 'it';
  c.labels['/m'] = 'L';
  c.badges['/m'] = 'x';
  assert.equal(buildQuery(c, { ...base, kind: 'logo' }), 'lang=it');
});

test('tmdb-poster, custom and created poster URLs', () => {
  const c = cfgWith();
  c.labels['/m'] = 'MY LABEL';
  assert.equal(
    buildImageUrl(c, { ...base, kind: 'poster', source: { kind: 'tmdb', path: '/abc.jpg' } }),
    'https://api.ratingposterdb.com/k1/imdb/poster-default/tmdb-poster/tt0903747/abc.jpg?label=MY%20LABEL',
  );
  assert.equal(
    buildImageUrl(c, { ...base, kind: 'poster', source: { kind: 'tmdb', path: 'abc.jpg' } }),
    'https://api.ratingposterdb.com/k1/imdb/poster-default/tmdb-poster/tt0903747/abc.jpg?label=MY%20LABEL',
  );
  const tpl = customPosterTemplate('https://x.test/a b.png');
  assert.equal(
    buildImageUrl(cfgWith(), { ...base, kind: 'poster', customTemplate: tpl }),
    'https://api.ratingposterdb.com/k1/imdb/poster-default/custom-poster/tt0903747.jpg?img=https%3A%2F%2Fx.test%2Fa%20b.png',
  );
  const q = createPosterQuery({ ratings: 'imdb:8.1|rt:90', img: 'https://x/y.jpg', rtCert: '1' });
  assert.equal(q, 'ratings=imdb%3A8.1%7Crt%3A90&img=https%3A%2F%2Fx%2Fy.jpg&rtCert=1');
  const created = createPosterTemplate('poster-rt', 'tt1', q);
  assert.match(buildImageUrl(cfgWith(), { ...base, kind: 'poster', customTemplate: created }), /\/k1\/imdb\/poster-rt\/create-poster\/tt1\.jpg\?ratings=/);
});

test('thumbnail URL omits the label', () => {
  const c = cfgWith();
  c.labels['/m'] = 'L';
  c.badges['/m'] = '4k';
  assert.equal(buildThumbnailUrl(c, base), 'https://api.ratingposterdb.com/k1/imdb/poster-default/tt0903747.jpg?badges=4k');
});

test('create image normalisation', () => {
  assert.equal(normalizeCreateImg('https://www.themoviedb.org/t/p/w342/abc.jpg'), 'https://image.tmdb.org/t/p/w780/abc.jpg');
  assert.equal(normalizeCreateImg('https://m.media-amazon.com/images/M/x._V1_.jpg'), 'https://m.media-amazon.com/images/M/x._V1_SX580.jpg');
});

test('resolution labels and language normalisation', () => {
  assert.equal(resolutionLabel(3840, 2160), '4k');
  assert.equal(resolutionLabel(1920, 800), '1080p');
  assert.equal(resolutionLabel(1280, 720), '720p');
  assert.equal(resolutionLabel(720, 480), '480p');
  assert.equal(normLang('eng'), 'en');
  assert.equal(normLang('it'), 'it');
  assert.equal(normLang('pt-BR'), 'pt');
  assert.equal(normLang('xxx'), null);
});

test('auto badges from probe data', () => {
  const probe = {
    videoRes: '4k', isHdr: true, isDolbyVision: false, codecs: { video: 'HEVC' }, audioChans: 6,
    languages: ['eng', 'ita'], subtitles: ['fr'], fileName: 'Movie.2020.REMUX.mkv',
  };
  const d = { hdr: 'hdrcolor', dolbyvision: 'dolbyvision', remux: 'remuxgold' };
  assert.equal(autoBadgesFromProbe('videoQuality=1&colorRange=1&videoCodec=1', probe, d), '4k,hdrcolor,h265');
  assert.equal(autoBadgesFromProbe('audioChannels=1&videoSource=1', probe, d), 'audio51,remuxgold');
  assert.equal(autoBadgesFromProbe('countryFlag=detect&countryFlagDetectCount=2-langs&countryFlagWhere=audio', probe, d), 'country.US,country.IT');
  assert.equal(autoBadgesFromProbe('countryFlag=it_IT&countryFlagWhere=sub', probe, d), '');
  assert.equal(autoBadgesFromProbe('countryFlag=it_IT', probe, d), 'country.it');
  assert.equal(autoBadgesFromProbe('countryFlag=gd_GB-SCT', { languages: ['gd'] }, d), 'country.gb_sct');
  assert.equal(autoBadgesFromProbe('countryFlag=detect', { languages: ['gd'] }, d), 'country.GB-SCT');
  assert.equal(autoBadgesFromProbe('ageRating=1&usAgeRating=1&videoQuality=1', null, d), 'commonsensegold,us_age_rating_gold');
  assert.equal(autoBadgesFromProbe('colorRange=1', { ...probe, isDolbyVision: true }, { ...d, dolbyvision: 'dolbyvisioncolor' }), 'dolbyvisioncolor');
});

test('auto badges from an rpdb.json written by the original app', () => {
  const legacy = {
    codecs: { video: ['avc', 'hevc'], audio: ['DTS'], audioCommercial: [] },
    languages: { audio: ['en', 'ja'], subtitles: ['fr'] },
    videoWidth: 1920, videoHeight: 1080, audioChannels: '5.1', filename: 'Movie.2020.1080p.BluRay.x265.mkv',
    isHdr: false, isDolbyVision: false,
  };
  const q = 'videoQuality=1&videoCodec=1&audioChannels=1&videoSource=1&countryFlag=detect&countryFlagDetectCount=3-langs';
  assert.equal(autoBadgesFromProbe(q, legacy, {}), '1080p,h265,audio51,bluray,country.US,country.JP,country.FR');
  assert.equal(autoBadgesFromProbe('audioChannels=1', { ...legacy, audioChannels: '7.1' }, {}), 'audio71');
  assert.equal(autoBadgesFromProbe('countryFlag=fr_FR&countryFlagWhere=sub', legacy, {}), 'country.fr');
});
