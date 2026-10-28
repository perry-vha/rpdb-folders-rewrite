import test from 'node:test';
import assert from 'node:assert/strict';
import { parseName, extractEmbeddedIds, parseImdbId, parseTmdbId, sanitizeName, searchTitle } from '../src/parse.js';
import { pickImdbResult } from '../src/match.js';
import { compareVersions } from '../src/version.js';

test('parseName handles year patterns', () => {
  assert.deepEqual(parseName('The Matrix (1999)'), { title: 'The Matrix', year: 1999 });
  assert.deepEqual(parseName('The Office (2005-2013)'), { title: 'The Office', year: 2005 });
  assert.deepEqual(parseName('Heat 1995'), { title: 'Heat', year: 1995 });
  assert.deepEqual(parseName('Dune [2021]'), { title: 'Dune', year: 2021 });
  assert.deepEqual(parseName('Heat'), { title: 'Heat', year: null });
});

test('parseName strips tags and ids', () => {
  assert.deepEqual(parseName('Obscure Thing (2010) [imdb-tt0000001]'), { title: 'Obscure Thing', year: 2010 });
  assert.deepEqual(parseName('Movie (2001) {tmdb-12}'), { title: 'Movie', year: 2001 });
});

test('parseName handles scene releases and loose files', () => {
  assert.deepEqual(parseName('Alien.1979.1080p.BluRay.x264'), { title: 'Alien', year: 1979 });
  assert.deepEqual(parseName('Interstellar.2014.2160p.mkv', { isFile: true }), { title: 'Interstellar', year: 2014 });
  assert.deepEqual(parseName('Some_Show_S01E02_720p_HDTV'), { title: 'Some Show', year: null });
  assert.deepEqual(parseName('2012.2009.1080p.BluRay'), { title: '2012', year: 2009 });
  assert.deepEqual(parseName('Mr. Robot (2015)'), { title: 'Mr. Robot', year: 2015 });
});

test('embedded ID extraction', () => {
  assert.deepEqual(extractEmbeddedIds('A [imdb-tt1234567]'), { imdb: 'tt1234567' });
  assert.deepEqual(extractEmbeddedIds('A {TMDB=603}'), { tmdb: '603' });
  assert.deepEqual(extractEmbeddedIds('A [tvdb:81189] {imdb:tt7}'), { tvdb: '81189', imdb: 'tt7' });
  assert.deepEqual(extractEmbeddedIds('A (2000)'), {});
});

test('parseImdbId from URL or bare id', () => {
  assert.equal(parseImdbId('https://www.imdb.com/title/tt0133093/?ref_=x'), 'tt0133093');
  assert.equal(parseImdbId('TT123'), 'tt123');
  assert.equal(parseImdbId('nothing'), null);
  assert.equal(parseImdbId(''), null);
  assert.equal(parseTmdbId('https://www.themoviedb.org/movie/238-the-godfather'), '238');
  assert.equal(parseTmdbId('https://themoviedb.org/tv/1396'), '1396');
  assert.equal(parseTmdbId('nothing'), null);
});

test('sanitizeName and marvel prefix', () => {
  assert.equal(sanitizeName('The Matrix: Reloaded!'), 'matrixreloaded');
  assert.equal(searchTitle("Marvel's Daredevil", 'series'), 'Daredevil');
  assert.equal(searchTitle("Marvel's Daredevil", 'movie'), "Marvel's Daredevil");
});

test('pickImdbResult prefers year and type', () => {
  const results = [
    { id: 'tt1', l: 'Alien', y: 2010, q: 'feature' },
    { id: 'tt2', l: 'Alien', y: 1979, q: 'feature' },
    { id: 'tt3', l: 'Alien', y: 1979, q: 'TV series' },
  ];
  assert.equal(pickImdbResult(results, { title: 'Alien', year: 1979, type: 'movie' }).id, 'tt2');
  assert.equal(pickImdbResult(results, { title: 'Alien', year: 1979, type: 'series' }).id, 'tt3');
  assert.equal(pickImdbResult(results, { title: 'Alien', year: 1990, type: 'movie' }).id, 'tt1');
  assert.equal(pickImdbResult(results, { title: 'Nope', year: null, type: 'movie' }), null);
});

test('compareVersions', () => {
  assert.ok(compareVersions('v0.3.7', '0.3.6') > 0);
  assert.equal(compareVersions('0.3.6', '0.3.6'), 0);
  assert.ok(compareVersions('0.3.6', '0.10.0') < 0);
});
