import test from 'node:test';
import assert from 'node:assert/strict';
import { mdblistBadges } from '../src/ratings.js';

const values = (badges) => Object.fromEntries(badges.map((b) => [b.key, b.value]));

// Cases mirror openposterdb's mdblist_badges tests (api/src/services/ratings.rs).
test('MDBList response maps to badges like openposterdb', () => {
  const badges = mdblistBadges({
    score: 89,
    ratings: [
      { source: 'imdb', value: 9.3, score: 93, votes: 3000000 },
      { source: 'popcorn', value: 98, score: 98, votes: 53000 },
      { source: 'rogerebert', value: 3.5, score: null, votes: null },
      { source: 'myanimelist', value: 8.5, score: 85, votes: 10 },
      { source: 'tomatoes', value: 91, score: 91, votes: 300 },
    ],
  });
  assert.deepEqual(values(badges), { imdb: '9.3', rt: '91%', rta: '98%', mal: '8.50', mdblist: '89', ebert: '3.5' });
  assert.deepEqual(badges.map((b) => b.key), ['imdb', 'rt', 'rta', 'mal', 'mdblist', 'ebert']);
  assert.equal(badges[0].votes, 3000000);
});

test('missing, zero and unmapped MDBList sources are suppressed', () => {
  assert.deepEqual(mdblistBadges({
    score: null,
    ratings: [
      { source: 'rogerebert', value: 0, score: null, votes: null },
      { source: 'metacriticuser', value: 9, score: 90, votes: 10 },
      { source: 'tomatoes', value: null, score: 0, votes: 0 },
      { source: 'popcorn', value: null, score: 0, votes: 0 },
      { source: 'metacritic', value: null, score: 0, votes: 0 },
      { source: 'trakt', value: null, score: 0, votes: 0 },
    ],
  }), []);
  assert.deepEqual(mdblistBadges({}), []);
});
