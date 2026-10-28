import http from 'node:http';
import { createCanvas } from '@napi-rs/canvas';

const MOVIES = {
  'the matrix': { id: 'tt0133093', l: 'The Matrix', y: 1999, q: 'feature' },
  alien: { id: 'tt0078748', l: 'Alien', y: 1979, q: 'feature' },
  interstellar: { id: 'tt0816692', l: 'Interstellar', y: 2014, q: 'feature' },
  'the office': { id: 'tt0386676', l: 'The Office', y: 2005, q: 'TV series' },
  'obscure thing': { id: 'tt0000404', l: 'Obscure Thing', y: 2010, q: 'feature' },
};

/** Local stand-in for RPDB, IMDb suggestions and TMDB. Records every request in `requests`. */
export function startMock({ key = 'test-key' } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    requests.push(req.url);
    const send = (code, body, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type });
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    let m;
    if ((m = /^\/suggestion\/\w\/(.+)\.json$/.exec(url.pathname))) {
      const q = decodeURIComponent(m[1]);
      if (/^tt\d+$/.test(q)) {
        const byId = Object.values(MOVIES).find((x) => x.id === q);
        return send(200, { d: byId ? [{ ...byId, i: { imageUrl: `https://img.test/${byId.l.toLowerCase()}._V1_.jpg` } }] : [] });
      }
      const hit = MOVIES[q];
      return send(200, { d: hit ? [hit] : [] });
    }
    if (url.pathname === '/3/configuration') {
      const auth = req.headers.authorization || '';
      const bad = url.searchParams.get('api_key') === 'bad' || auth === 'Bearer eyJbad';
      return bad ? send(401, { status_message: 'Invalid API key' }) : send(200, { images: {} });
    }
    // Like MDBList: /user still answers when a key is over its daily limit, media routes return 429.
    if (url.pathname === '/user') {
      return ['mdb-key', 'mdb-limited'].includes(url.searchParams.get('apikey')) ? send(200, { username: 'test' }) : send(403, { error: 'Invalid API key' });
    }
    if (url.pathname.startsWith('/imdb/') && url.searchParams.get('apikey') === 'mdb-limited') {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3600', 'x-ratelimit-remaining': '0' });
      return res.end(JSON.stringify({ error: 'Daily API limit exceeded!' }));
    }
    if (url.pathname === '/imdb/movie/tt0133093') {
      return send(200, {
        title: 'The Matrix', year: 1999, score: 86, poster: `http://${req.headers.host}/art/matrix.png`,
        ratings: [{ source: 'imdb', value: 8.7, score: 87, votes: 2000000 }, { source: 'tomatoes', value: 83, score: 83, votes: 200 }],
      });
    }
    if (url.pathname === '/art/matrix.png') {
      const c = createCanvas(300, 450);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#336';
      ctx.fillRect(0, 0, 300, 450);
      c.encode('png').then((png) => send(200, png, 'image/png'));
      return undefined;
    }
    if (url.pathname === '/3/movie/603') {
      return send(200, { id: 603, release_date: '1999-03-31', poster_path: '/matrix.jpg', external_ids: { imdb_id: 'tt0133093' } });
    }
    if (url.pathname.startsWith('/3/')) return send(200, { results: [], total_results: 0, movie_results: [], tv_results: [] });
    if ((m = /^\/([^/]+)\/isValid$/.exec(url.pathname))) {
      return m[1] === key ? send(200, { valid: true }) : send(403, 'API Key is Invalid', 'text/plain');
    }
    if ((m = /^\/([^/]+)\/requests$/.exec(url.pathname))) return send(200, { req: 5, limit: 1000 });
    if ((m = /^\/([^/]+)\/submit$/.exec(url.pathname))) return send(200, { ok: true });
    if (/^\/[^/]+\/imdb\//.test(url.pathname)) {
      if (url.pathname.includes('tt0000404')) return send(404, 'no ratings', 'text/plain');
      return send(200, Buffer.from(`IMG:${req.url}`), 'image/jpeg');
    }
    return send(404, 'nope', 'text/plain');
  });
  return new Promise((resolve) => {
    server.listen(Number(process.env.MOCK_PORT) || 0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ port, key, requests, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
    });
  });
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const mock = await startMock();
  console.log(`Mock API on ${mock.base} (key: ${mock.key})`);
}


