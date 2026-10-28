/* RPDB Folders web UI (vanilla JS, no dependencies) */
const $app = document.getElementById('app');
let PASS = '';
let S = {};
let TIER = 1;
let pollTimer = null;
let lastPoll = {};

// ---------- helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') u.set(k, v === true ? '1' : v === false ? '0' : v);
  if (PASS) u.set('pass', PASS);
  return u.toString();
};
const url = (route, params) => `${route}?${qs(params)}`;
async function api(route, params) {
  const r = await fetch(url(route, params));
  if (r.status === 500 && (await r.clone().text()) === 'Password Incorrect') { PASS = ''; localStorage.removeItem('rpdbLogin'); return login(); }
  return r.json();
}
const bool = (v) => v === 1 || v === '1' || v === true;
const tierFromKey = (prefix) => (/^t([0-5])-$/.test(prefix) ? Number(prefix[1]) : 1);
const langName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; } };
const LANGS = [...LANG_CODES, ...LANG_EXTRA].map((c) => [c, langName(c)]).sort((a, b) => a[1].localeCompare(b[1]));
const LOCALE_NAMES = LOCALES.map((l) => {
  const [lang, region] = l.split('_');
  let name = l;
  try { name = `${langName(lang)} (${new Intl.DisplayNames(['en'], { type: 'region' }).of(region)})`; } catch { /* fallback to code */ }
  return [l, name];
});

// RPDB tiers only limit RPDB features; the local engine has none.
function gate(n, ...els) {
  if (TIER >= n || S.posterEngine === 'local') return els;
  els.forEach((e) => e.querySelectorAll?.('input,select,button,textarea').forEach((i) => { i.disabled = true; }));
  return [...els, h('div', { class: 'tier' }, `This feature is only available with Tier ${n} (or higher)`)];
}
function select(options, value, onchange, props) {
  const el = h('select', { onchange: (e) => onchange(e.target.value), ...props },
    options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
  return el;
}
function check(label, checked, onchange) {
  return h('label', {}, h('input', { type: 'checkbox', checked: Boolean(checked), onchange: (e) => onchange(e.target.checked) }), label);
}
function radios(name, options, value, onchange) {
  return h('div', {}, options.map(([v, l]) => h('label', { class: 'inline' },
    h('input', { type: 'radio', name, checked: String(v) === String(value), onchange: () => onchange(v) }), l)));
}
const btn = (label, onclick, cls = '') => h('button', { class: cls, onclick }, label);
// Range slider with a live value; `auto` adds an Auto switch that reports null. `special` names the top stop (e.g. Full).
function slider({ min, max, step = 1, value, fmt = (v) => String(v), auto = false, special = null, onchange }) {
  const top = special ? max + step : max;
  const isAuto = auto && (value === null || value === undefined || value === '' || value === 'auto');
  const start = isAuto ? min : special && value === special.value ? top : Number(value);
  const input = h('input', { type: 'range', min, max: top, step, value: start, 'aria-label': 'Value' });
  const out = h('output', { class: 'slider-val' });
  const read = () => (special && Number(input.value) === top ? special.value : Number(input.value));
  const show = () => { out.textContent = input.disabled ? 'Auto' : special && Number(input.value) === top ? special.label : fmt(Number(input.value)); };
  input.addEventListener('input', () => { show(); onchange(read()); });
  input.disabled = isAuto;
  show();
  const kids = [input, out];
  if (auto) kids.push(check('Auto', isAuto, (on) => { input.disabled = on; show(); onchange(on ? null : read()); }));
  return h('div', { class: 'slider' }, ...kids);
}
const isBtn = (n) => n?.nodeType === 1 && (n.tagName === 'BUTTON' || (n.tagName === 'A' && n.classList.contains('btn')));
// Group a flat node list into cards (one per h2) with consecutive buttons laid out as action grids.
function layout(nodes) {
  const items = nodes.flat().filter((n) => n != null && n !== false && n !== '');
  let end = items.length;
  while (end > 0 && isBtn(items[end - 1])) end--;
  const out = [];
  let card = null;
  let actions = null;
  for (const n of items.slice(0, end)) {
    if (n.nodeType === 1 && n.tagName === 'DIV' && n.firstElementChild?.tagName === 'H2') {
      n.classList.add('card');
      out.push(n);
      card = null; actions = null;
      continue;
    }
    if (n.nodeType === 1 && n.tagName === 'H2') card = null;
    if (!card) { card = h('section', { class: 'card' }); out.push(card); actions = null; }
    if (isBtn(n)) {
      if (!actions) { actions = h('div', { class: 'actions' }); card.append(actions); }
      actions.append(n);
    } else {
      actions = null;
      card.append(n);
    }
  }
  if (end < items.length) out.push(h('div', { class: `actions page-actions${items.length - end <= 3 ? ' sticky' : ''}` }, items.slice(end)));
  return out;
}
function view(title, ...nodes) {
  const brand = h('div', S.apiKeyPrefix || S.mdblistKeySet ? { class: 'brand link', onclick: mainMenu, title: 'Home' } : { class: 'brand' },
    h('img', { src: 'favicon.svg', alt: '' }), h('span', {}, 'RPDB Folders'), S.pkgVersion ? h('span', { class: 'ver' }, `v${S.pkgVersion}`) : '');
  $app.replaceChildren(h('header', { class: 'topbar' }, h('div', { class: 'topbar-inner' }, brand)),
    h('main', { class: 'page' }, title ? h('h1', {}, title) : '', ...layout(nodes)));
  window.scrollTo(0, 0);
}
async function setSetting(params) {
  const r = await api('setSettings', params);
  return r;
}
const dateText = (ms) => (ms ? new Date(ms).toLocaleString() : 'never');

// ---------- start-up ----------
async function start() {
  const np = await (await fetch('needsPass')).json();
  if (np.required) {
    PASS = localStorage.getItem('rpdbLogin') || '';
    const ok = PASS && (await api('checkPass')).success;
    if (!ok) return login();
  }
  return boot();
}
function login(failed) {
  const input = h('input', { type: 'password', placeholder: 'Password' });
  const remember = h('input', { type: 'checkbox' });
  const go = async () => {
    PASS = input.value;
    const r = await (await fetch(url('checkPass'))).json();
    if (!r.success) return login(true);
    if (remember.checked) localStorage.setItem('rpdbLogin', PASS);
    return boot();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  view('Login', failed ? h('p', { class: 'err' }, 'Wrong password, try again.') : '', input, h('label', {}, remember, 'Remember me'), btn('Login', go));
}
async function boot() {
  S = await api('getSettings');
  if (!S.success) return;
  TIER = tierFromKey(S.apiKeyPrefix || '');
  if (!S.apiKeyPrefix && !S.mdblistKeySet) return apiKeysScreen({ firstRun: true });
  if (!S.apiKeyPrefix && S.posterEngine !== 'local') {
    const r = await api('setPosterEngine', { engine: 'local' });
    if (r.success) S.posterEngine = 'local';
  }
  checkUpdate();
  startPolling();
  return mainMenu();
}

// ---------- API keys ----------
function rpdbKeySection(onChange) {
  const status = h('p');
  const drawStatus = () => { status.className = S.apiKeyPrefix ? 'ok' : 'muted'; status.textContent = S.apiKeyPrefix ? `Status: key saved (${S.apiKeyPrefix}…)` : 'Status: not set'; };
  drawStatus();
  const input = h('input', { type: 'text', placeholder: 'RPDB API key', autocomplete: 'off' });
  const save = async (key) => {
    if (key) {
      status.className = 'muted'; status.textContent = 'Checking key …';
      try {
        const base = S.rpdbBase || 'https://api.ratingposterdb.com';
        const r = await fetch(`${base}/${encodeURIComponent(key)}/isValid`);
        const d = r.ok ? await r.json() : {};
        if (!d.valid) { status.className = 'err'; status.textContent = 'RPDB says this API key is not valid.'; return; }
      } catch { status.className = 'err'; status.textContent = 'Could not reach RPDB to check the key.'; return; }
    }
    const r = await api('setApiKey', { key });
    if (!r.success) { status.className = 'err'; status.textContent = r.message || 'Failed'; return; }
    S = await api('getSettings');
    TIER = tierFromKey(S.apiKeyPrefix || '');
    input.value = ''; drawStatus(); onChange?.();
  };
  return h('div', {},
    h('h2', {}, 'RPDB API Key (optional)'),
    h('p', { class: 'muted' }, 'With an RPDB key you can let RPDB make your posters, backdrops and logos. Without one, the local engine renders them from MDBList ratings and TMDB artwork.'),
    input, status,
    h('div', {}, btn('Save Key', () => input.value.trim() && save(input.value.trim())), S.apiKeyPrefix ? btn('Remove Key', () => confirm('Remove the RPDB API key? The local engine will be used.') && save(''), 'secondary') : '',
      h('a', { class: 'btn secondary', href: 'https://ratingposterdb.com/api-key/', target: '_blank', rel: 'noopener' }, 'Get API Key')));
}
async function apiKeysScreen({ firstRun = false } = {}) {
  S = await api('getSettings');
  const ready = () => S.apiKeyPrefix || S.mdblistKeySet;
  const msg = h('p', { class: 'muted' }, firstRun ? 'Add an RPDB API key, or an MDBList key (plus a TMDB key for backdrops and logos) to render posters locally.' : '');
  view('API Keys', msg, rpdbKeySection(), tmdbKeySection(), mdblistKeySection(),
    firstRun
      ? btn('Continue', async () => { S = await api('getSettings'); if (ready()) boot(); else { msg.className = 'err'; msg.textContent = 'Add an RPDB key or an MDBList key first.'; } })
      : btn('Back', mainMenu, 'secondary'));
}

// Engine switch shared by Poster Settings and the Poster Designer.
function engineToggle(onChanged) {
  const box = h('div');
  const draw = (message) => box.replaceChildren(
    radios(`engine${Date.now()}`, [['rpdb', 'RPDB'], ['local', 'Local (MDBList + TMDB artwork)']], S.posterEngine || 'rpdb', async (x) => {
      const r = await api('setPosterEngine', { engine: x });
      if (!r.success) { draw(r.message); return; }
      S.posterEngine = x;
      draw();
      onChanged?.(x);
    }),
    message ? h('p', { class: 'err' }, message) : '');
  draw();
  return box;
}
async function checkUpdate() {
  const last = Number(localStorage.getItem('rpdbUpdateCheck') || 0);
  if (Date.now() - last < 86400000) return;
  localStorage.setItem('rpdbUpdateCheck', Date.now());
  const r = await api('needsUpdate');
  if (!r.needsUpdate) return;
  const link = r.dockerUpdate ? h('a', { href: 'https://hub.docker.com/r/jaruba/rpdb-folders-docker', target: '_blank' }, 'Update available (Docker Hub)')
    : h('a', { href: r.zipBall || '#', target: '_blank' }, 'Update available, download');
  const banner = h('div', { class: 'banner' }, link);
  const page = document.querySelector('.page');
  if (page) page.prepend(banner); else $app.prepend(banner);
}
function scanText(d) {
  if (d.mdblistPausedUntil) return `Paused: all MDBList keys reached their limit, resuming ${new Date(d.mdblistPausedUntil).toLocaleString()} (${d.scanItems} items in queue)`;
  return d.scanItems ? `Scanning (${d.scanItems} items in queue)` : 'Idle, not scanning';
}
function startPolling() {
  clearInterval(pollTimer);
  const tick = async () => {
    const d = await fetch(url('pollData')).then((r) => r.json()).catch(() => null);
    if (!d || !d.success) return;
    lastPoll = d;
    document.querySelectorAll('.js-scan').forEach((e) => { e.textContent = scanText(d); });
    document.querySelectorAll('.js-history').forEach((e) => { e.textContent = `Added images to ${d.historyCount} folders.`; });
    document.querySelectorAll('.js-last').forEach((e) => { e.textContent = `Last full scan started: ${dateText(d.lastFullUpdate)}`; });
    document.querySelectorAll('.js-plex').forEach((e) => { e.textContent = `Status: ${d.plexConnected ? 'Connected' : 'Not Connected'}`; });
    document.querySelectorAll('.js-plexq').forEach((e) => { e.textContent = `Refresh Status: ${d.plexQueue} items queued`; });
  };
  tick();
  pollTimer = setInterval(tick, 2000);
}

// ---------- main menu ----------
async function mainMenu() {
  S = await api('getSettings');
  const nm = S.movieFolders.length;
  const ns = S.seriesFolders.length;
  const reqOut = h('p', { class: 'muted' });
  const pw1 = h('input', { type: 'password', placeholder: 'New password' });
  const pw2 = h('input', { type: 'password', placeholder: 'Repeat password' });
  const pwOut = h('p', { class: 'muted' });
  view('Dashboard',
    btn('Poster Designer', () => posterDesigner()),
    btn('Poster Settings', posterSettings),
    btn('Scan Settings', scanSettings),
    btn('API Keys', () => apiKeysScreen(), 'secondary'),
    h('h2', {}, 'Backdrops'),
    ...gate(2, h('div', {},
      check('Download Backdrops', S.backdrops, async (v) => { S.backdrops = v; await setSetting({ backdrops: v }); }),
      check('Badges on Backdrops', S.backdropsBadges, async (v) => { S.backdropsBadges = v; await setSetting({ backdropsBadges: v }); }))),
    h('h2', {}, 'Logos'),
    ...gate(2, check('Download Logos', S.logos, async (v) => { S.logos = v; await setSetting({ logos: v }); })),
    h('h2', {}, 'Media Folders'),
    h('p', { class: 'muted' }, `Watching ${nm} movie folders and ${ns} series folders.`),
    btn('Add Movie Folder', () => addFolder('movie')),
    btn('Add Series Folder', () => addFolder('series')),
    btn('Edit Media Folder', editFolders, 'secondary'),
    h('h2', {}, 'History'),
    h('p', { class: 'muted js-history' }, `Added images to ${S.historyCount} folders.`),
    btn('Edit Movie Poster', () => findItem('movie'), 'secondary'),
    btn('Edit Series Poster', () => findItem('series'), 'secondary'),
    h('h2', {}, 'Check Requests'),
    reqOut,
    S.apiKeyPrefix ? btn('Check Requests', async () => { const r = await api('checkRequests'); reqOut.textContent = r.success ? `${r.req} / ${r.limit}` : 'Could not load requests'; }, 'secondary') : h('p', { class: 'muted' }, 'RPDB request counts need an RPDB API key.'),
    h('h2', {}, 'Choose Password'), pw1, pw2, pwOut,
    btn('Save Password', async () => {
      if (!pw1.value || pw1.value !== pw2.value) { pwOut.textContent = 'Passwords do not match.'; return; }
      const r = await api('savePass', { newpass: pw1.value });
      if (r.success) { PASS = pw1.value; if (localStorage.getItem('rpdbLogin')) localStorage.setItem('rpdbLogin', PASS); pwOut.textContent = 'Password saved.'; } else pwOut.textContent = 'Could not save password.';
    }),
    h('h2', {}, 'Create Backup'), btn('Create Backup', backupScreen, 'secondary'),
    h('p', { class: 'muted' }, h('a', { href: 'https://github.com/RatingPosterDB/rpdb-folders', target: '_blank' }, 'Quick Start'), ' · ',
      h('a', { href: 'https://github.com/RatingPosterDB/rpdb-folders/wiki', target: '_blank' }, 'Advanced Usage')));
}
async function backupScreen() {
  const r = await api('getConfigPath');
  view('Create Backup', h('p', {}, 'Your configuration is stored in:'), h('p', { class: 'path' }, r.path),
    h('p', { class: 'muted' }, 'To restore a backup, stop the app and replace config.json with the downloaded backup file.'),
    h('a', { class: 'btn', href: url('backup.json'), target: '_blank' }, 'Download Backup'), btn('Back', mainMenu, 'secondary'));
}

// ---------- poster settings ----------
function ratingOrderPicker(initial, onChange) {
  let order = initial ? initial.split(',').filter(Boolean) : [];
  const box = h('div', { class: 'chips' });
  const draw = () => {
    box.replaceChildren(...RATING_SOURCES.map((s) => {
      const i = order.indexOf(s);
      return h('span', { class: `chip${i >= 0 ? ' on' : ''}`, onclick: () => {
        if (i >= 0) order.splice(i, 1); else if (order.length < 6) order.push(s);
        onChange(order.join(',')); draw();
      } }, i >= 0 ? `${i + 1}. ${s}` : s);
    }));
  };
  draw();
  return h('div', {}, h('h3', {}, 'Rating Order'), box, h('p', { class: 'muted' }, 'Click sources in the order you want them (up to 6). Poster bars and blocks show the first 3 available; side bars and backdrops show all of them, and logos as many as fit.'));
}
function posterTypeSelect(value, onchange) {
  const el = select(POSTER_TYPES, value, onchange);
  if (S.posterEngine === 'local') return el;
  if (TIER < 2) [...el.options].forEach((o) => { if (o.value === 'rating-order') o.disabled = true; });
  if (TIER < 1) el.disabled = true;
  return el;
}
function posterSettings() {
  const v = { moviePosterType: S.moviePosterType, seriesPosterType: S.seriesPosterType, movieRatingOrder: S.movieRatingOrder, seriesRatingOrder: S.seriesRatingOrder,
    moviePosterLang: S.moviePosterLang, seriesPosterLang: S.seriesPosterLang, movieSecPosterLang: S.movieSecPosterLang, seriesSecPosterLang: S.seriesSecPosterLang,
    movieTextless: S.movieTextless, seriesTextless: S.seriesTextless };
  const section = (type, title) => {
    const T = type;
    const orderBox = h('div');
    const drawOrder = () => orderBox.replaceChildren(v[`${T}PosterType`] === 'rating-order' ? ratingOrderPicker(v[`${T}RatingOrder`], (o) => { v[`${T}RatingOrder`] = o; }) : '');
    drawOrder();
    return h('div', {}, h('h2', {}, title),
      h('h3', {}, 'Preferred Poster Language'), ...gate(1, select(LANGS, v[`${T}PosterLang`], (x) => { v[`${T}PosterLang`] = x; })),
      h('h3', {}, 'Secondary Poster Language'), ...gate(2, select(LANGS, v[`${T}SecPosterLang`], (x) => { v[`${T}SecPosterLang`] = x; })),
      ...gate(1, check('Prefer Textless Posters', v[`${T}Textless`], (x) => { v[`${T}Textless`] = x; })),
      h('h3', {}, 'Poster Type'),
      TIER < 1 && S.posterEngine !== 'local' ? h('p', { class: 'tier' }, 'Tier 0 API keys can only use the default poster type.') : '',
      posterTypeSelect(v[`${T}PosterType`], (x) => { v[`${T}PosterType`] = x; drawOrder(); }), orderBox);
  };
  view('Poster Settings',
    h('div', {}, h('h2', {}, 'Poster Engine'), engineToggle(), h('p', { class: 'muted' }, 'RPDB makes images with your RPDB key; Local renders them from MDBList ratings and TMDB artwork. The poster type, rating order, languages and textless options below apply to RPDB and to the local engine\'s RPDB styles; languages and textless also choose the local TMDB artwork.')),
    section('movie', 'Movie Posters'), section('series', 'Series Posters'),
    btn('Save & Close', async () => { await setSetting(v); mainMenu(); }), btn('Cancel', mainMenu, 'secondary'));
}

// ---------- scan settings ----------
async function scanSettings() {
  S = await api('getSettings');
  const set = async (k, val) => { S[k] = val; await setSetting({ [k]: val }); };
  const msg = h('p', { class: 'muted' });
  const scan = async (route) => { const r = await api(route); msg.textContent = r.success ? 'Scan started.' : r.message || 'Failed'; };
  const webhookInfo = h('div', {});
  const drawWebhook = () => webhookInfo.replaceChildren(S.usePolling === 'webhook' ? h('div', {},
    h('p', {}, 'Radarr URL: ', h('code', {}, S.webhookRadarr)), h('p', {}, 'Sonarr URL: ', h('code', {}, S.webhookSonarr)),
    h('p', { class: 'muted' }, 'Use HTTP Basic auth with username "rpdb" and your app password (if set). Type: Download.')) : '');
  drawWebhook();
  const months = [[3, '3 months'], [6, '6 months'], [9, '9 months']];
  const days = [[0, 'Always'], [1, '30 days'], [2, '60 days'], [3, '90 days']];
  const msList = (arr) => arr.map((n) => [n, n === 0 ? 'None' : n < 1000 ? `${n}ms` : n < 60000 ? `${n / 1000}s` : `${n / 60000}m`]);
  const pollList = [100, 500, 1000, 3000, 5000, 7000, 10000, 15000, 20000].map((n) => [n, n < 1000 ? `${n}ms` : `${n / 1000}s`]);
  view('Scan Settings',
    h('p', { class: 'js-scan' }, scanText(lastPoll)),
    h('p', { class: 'muted js-last' }, `Last full scan started: ${dateText(lastPoll.lastFullUpdate)}`),
    btn('Run Full Scan', () => scan('runFullScan')),
    btn('Force Overwrite Scan', () => confirm('This may deplete your monthly requests. Continue?') && scan('forceOverwriteScan'), 'danger'),
    btn('Cancel Scan', () => api('cancelScan'), 'secondary'), msg,
    h('h2', {}, 'Overwrite'),
    check('Overwrite Images', S.overwrite, (x) => set('overwrite', x)),
    check('Only Overwrite Items from the Last 2 Years', S.overwrite2years, (x) => set('overwrite2years', x)),
    h('h3', {}, 'Overwrite Frequency'),
    radios('ofreq', [['overwrite-monthly', 'Monthly'], ['overwrite-bimonthly', 'Bimonthly']], S.minOverwritePeriod === 1209600000 ? 'overwrite-bimonthly' : 'overwrite-monthly',
      (x) => { S.minOverwritePeriod = x === 'overwrite-monthly' ? 2505600000 : 1209600000; setSetting({ overwritePeriod: x }); }),
    h('h2', {}, 'Retry Options'),
    h('h3', {}, 'Always retry to fetch images for folders newer than'), select(months, S.retryNewerThanMonths, (x) => set('retryNewerThanMonths', Number(x))),
    h('h3', {}, 'For older folders, the retry frequency should be'), select(days, S.retryFrequency, (x) => set('retryFrequency', Number(x))),
    h('h2', {}, 'Scan Type'),
    radios('stype', [['fsevents', 'FS Events'], ['polling', 'Polling'], ['webhook', 'Radarr/Sonarr Webhooks']], S.usePolling, async (x) => {
      S.usePolling = x; await setSetting({ usePolling: x === 'polling', useWebhook: x === 'webhook' }); drawWebhook();
    }),
    h('p', { class: 'muted' }, 'A restart is required for this change to take effect.'), webhookInfo,
    h('h3', {}, 'Polling Interval'), radios('pint', pollList, S.pollingInterval, (x) => set('pollingInterval', x)),
    h('h3', {}, 'Webhook Delay'), radios('wdel', msList([0, 5000, 15000, 30000, 60000, 180000, 300000, 600000, 900000]), S.webhookDelay, (x) => set('webhookDelay', x)),
    h('h2', {}, 'Plex'),
    h('p', { class: 'js-plex' }, `Status: ${lastPoll.plexConnected ? 'Connected' : 'Not Connected'}`),
    btn('Connect to Plex', plexOAuth), btn('Connection Settings', plexConnection, 'secondary'),
    btn('Refresh Settings', plexRefresh, 'secondary'), btn('Disconnect', async () => { await api('disconnectPlex'); scanSettings(); }, 'secondary'),
    h('h2', {}, 'Matching Order'),
    select([['imdb-tmdb', 'IMDB > TMDB'], ['tmdb-imdb', 'TMDB > IMDB'], ['imdb', 'IMDB Only'], ['tmdb', 'TMDB Only']], S.scanOrder, (x) => set('scanOrder', x)),
    S.tmdbKeySet ? '' : h('p', { class: 'muted' }, 'Without a TMDB key only IMDB matching is used. Add one under API Keys.'),
    h('h2', {}, 'Other Settings'),
    check('Do not scan on app start', S.noScanOnStart, (x) => set('noScanOnStart', x)),
    check('Skip Folders that do not Include Video Files', S.noEmptyFolders, (x) => set('noEmptyFolders', x)),
    check('Cache Previous Successful Matches', S.cacheMatches, (x) => set('cacheMatches', x)),
    check('Overwrite Video Probe Data', S.overwriteProbe, (x) => set('overwriteProbe', x)),
    btn('Back', mainMenu));
}

// ---------- TMDB key ----------
function tmdbKeySection() {
  const status = h('p', { class: 'muted' });
  const drawStatus = () => { status.className = S.tmdbKeySet ? 'ok' : 'muted'; status.textContent = S.tmdbKeyFromEnv ? 'Status: set via the TMDB_API_KEY environment variable' : S.tmdbKeySet ? 'Status: key saved' : 'Status: not set'; };
  drawStatus();
  const input = h('input', { type: 'password', placeholder: 'TMDB API Key or Read Access Token', autocomplete: 'off', disabled: S.tmdbKeyFromEnv });
  const save = async (key) => {
    status.className = 'muted'; status.textContent = key ? 'Checking key …' : 'Removing key …';
    const r = await api('setTmdbKey', { key });
    if (!r.success) { status.className = 'err'; status.textContent = r.message || 'Failed'; return; }
    S.tmdbKeySet = r.tmdbKeySet; input.value = ''; drawStatus();
  };
  return h('div', {},
    h('h2', {}, 'TMDB API Key (optional)'),
    h('p', { class: 'muted' }, 'A free TMDB key enables Load Posters (alternative poster choices), TMDB matching, TMDB/TVDB IDs in folder names, and artwork for locally rendered backdrops and logos. Get one at ',
      h('a', { href: 'https://www.themoviedb.org/settings/api', target: '_blank', rel: 'noopener' }, 'themoviedb.org/settings/api'), '.'),
    input, status,
    S.tmdbKeyFromEnv ? '' : h('div', {}, btn('Save Key', () => input.value.trim() && save(input.value.trim())), S.tmdbKeySet ? btn('Remove Key', () => save(''), 'secondary') : ''));
}

// ---------- poster designer ----------
const DESIGN_SOURCES = [['imdb', 'IMDb'], ['tmdb', 'TMDB'], ['rt', 'RT Critics'], ['rta', 'RT Audience'], ['mc', 'Metacritic'], ['mcu', 'Metacritic Users'],
  ['trakt', 'Trakt'], ['lb', 'Letterboxd'], ['mal', 'MyAnimeList'], ['mdblist', 'MDBList'], ['ebert', 'Roger Ebert'],
  ['commonsense', 'Common Sense'], ['usage', 'US Age'], ['overall', 'Overall'], ['critics', 'Critics'], ['audience', 'Audience']];
const LOCAL_POS = {
  cells: ['tl', 'tc', 'tr', 'l', null, 'r', 'bl', 'bc', 'br'],
  names: { tl: 'Top left', tc: 'Top centre', tr: 'Top right', l: 'Left side', r: 'Right side', bl: 'Bottom left', bc: 'Bottom centre', br: 'Bottom right' },
  shape: (p) => (p === 'l' || p === 'r' ? 'side' : ''),
  hint: 'Click where the ratings should sit on the image.',
};

// Fixed 3x3 grid shaped like a poster; the middle cell is the artwork itself.
function positionGrid(value, onchange, spec = LOCAL_POS) {
  const name = h('span', { class: 'pos-name' }, spec.names[value] || '');
  const cells = spec.cells.map((p) => (p
    ? h('button', { type: 'button', class: spec.shape(p), title: spec.names[p], 'aria-label': spec.names[p], 'aria-pressed': String(p === value),
      onclick: (e) => {
        for (const b of e.currentTarget.parentNode.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === e.currentTarget));
        name.textContent = spec.names[p];
        onchange(p);
      } })
    : h('div', { class: 'pos-center', 'aria-hidden': 'true' })));
  return h('div', { class: 'pos-picker' }, h('div', { class: 'pos-grid', role: 'group', 'aria-label': 'Position' }, cells), h('div', {}, name, h('p', { class: 'muted' }, spec.hint)));
}

const pct = (v) => `${Math.round(v * 100)}%`;
const px = (v) => `${v}px`;
const DESIGN_OPTS = {
  icons: [['opdb', 'OPDB icons'], ['official', 'OPDB official logos'], ['rpdb', 'RPDB-like (square)'], ['rpdb-round', 'RPDB-like (round)'], ['text', 'Text'], ['none', 'None']],
  numbers: [['auto', 'Auto (style default)'], ['full', 'Full (9.2/10, 97%)'], ['short', 'Short (9.2, 97%)'], ['whole', 'Whole numbers (92, 97)'], ['bare', 'Bare (9.2, 97)']],
  fill: [['source', 'Source colour'], ['dark', 'Dark'], ['light', 'Light'], ['none', 'None']],
  frames: {
    poster: [['native', 'Original shape'], ['cover', 'Fill 2:3'], ['pad', 'Fit 2:3 (bars)'], ['blur', 'Fit 2:3 (blurred)'], ['rpdb', 'RPDB frame (1:1.48)']],
    backdrop: [['native', 'Original shape'], ['wide', '16:9 (RPDB)']],
    logo: [['fit', 'Fit to content (OPDB)'], ['fixed', 'Fixed 3.2:1 (RPDB)']],
  },
  sizes: {
    poster: [['medium', 'Medium (580)'], ['large', 'Large (1280)'], ['verylarge', 'Very large (2000)']],
    backdrop: [['small', 'Small (1280)'], ['medium', 'Medium (1920)'], ['large', 'Large (3840)']],
    logo: [['medium', 'Medium (780)'], ['large', 'Large (1722)'], ['verylarge', 'Very large (2689)']],
  },
};

async function posterDesigner({ preview = null, target = 'global', back = mainMenu } = {}) {
  S = await api('getSettings');
  const rpdb = (S.posterEngine || 'rpdb') === 'rpdb';
  let P = preview;
  let D = await api('getDesigns', P || {});
  let tgt = target === 'item' && !P ? 'global' : target;
  const folders = [...S.movieFolders, ...S.seriesFolders];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  // Item / folder overrides fall back to the broader design. RPDB designs come from the stored Image Styles.
  const designOf = (t) => {
    const s = rpdb ? D.rpdb : D.local;
    if (t === 'item') return s.item || s.global;
    if (t.startsWith('folder:')) return s.folders[t.slice(7)] || s.global;
    return s.global;
  };
  let d = clone(designOf(tgt));
  let kind = 'poster';
  const touched = new Set();
  const loadState = () => { d = clone(designOf(tgt)); touched.clear(); };
  const can = (key) => !rpdb || D.rpdbSupported.includes(key);

  // Preview
  const img = h('img', { class: 'preview design-preview', alt: 'Poster preview' });
  img.addEventListener('load', () => img.classList.remove('loading'));
  img.addEventListener('error', () => img.classList.remove('loading'));
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      img.classList.add('loading');
      img.src = url('design-preview', { design: JSON.stringify(d), kind, width: kind === 'backdrop' ? 1000 : 500, engine: rpdb ? 'rpdb' : undefined, ...(P || {}) });
    }, 200);
  };
  const look = () => d[kind];
  const setL = (k, v) => { look()[k] = v; touched.add(kind); refresh(); };
  const set = (k, v) => { d[k] = v; refresh(); };
  const exact = h('img', { class: 'preview design-preview', alt: 'Real RPDB render' });
  const checkRpdb = () => { exact.src = url('rpdb-check', { design: JSON.stringify(d), kind, type: P?.type }); };

  // Preview title picker
  const titleBox = h('div');
  const results = h('div', { class: 'list' });
  const search = h('input', { type: 'text', placeholder: 'Preview with a title from your library …' });
  let lib = null;
  const loadLib = async () => {
    if (lib) return lib;
    lib = [];
    for (const type of ['movie', 'series']) {
      const r = await api('searchStrings', { type });
      for (const raw of (r.folders || '').split('//').map((s) => s.replace(/^\/|\/$/g, '')).filter(Boolean)) lib.push({ type, name: raw.split('\u200b')[0], label: raw.replace('\u200b', '') });
    }
    return lib;
  };
  search.addEventListener('input', async () => {
    const items = await loadLib();
    const q = search.value.trim().toLowerCase();
    results.replaceChildren(...(q ? items.filter((i) => i.label.toLowerCase().includes(q)).slice(0, 8) : []).map((i) =>
      h('div', { onclick: async () => { P = { type: i.type, name: i.name }; search.value = ''; results.replaceChildren(); D = await api('getDesigns', P); drawTitle(); drawTargets(); refresh(); } }, i.label)));
  });
  const drawTitle = () => titleBox.replaceChildren(P
    ? h('div', { class: 'chips' }, h('span', { class: 'chip on', title: 'Use sample ratings instead', onclick: () => { P = null; if (tgt === 'item') { tgt = 'global'; loadState(); drawControls(); } drawTitle(); drawTargets(); refresh(); } }, `Previewing: ${P.name}  ✕`))
    : h('p', { class: 'muted' }, S.mdblistKeySet ? 'Showing sample ratings. Pick a title to preview its real artwork and ratings.' : 'Showing sample ratings. Add an MDBList key (API Keys) to preview real titles.'));

  // Target + templates
  const targetBox = h('div');
  const drawTargets = () => {
    const opts = [['global', rpdb ? 'All media folders' : 'Global default (all folders)'], ...folders.map((f) => [`folder:${f}`, `Folder: ${f}`])];
    if (P) opts.push(['item', `This title: ${P.name}`]);
    targetBox.replaceChildren(select(opts, tgt, (x) => { tgt = x; loadState(); drawControls(); refresh(); }));
  };
  const tplName = h('input', { type: 'text', placeholder: 'Template name' });
  const tplBox = h('div');
  const msg = h('p', { class: 'muted' });
  const drawTemplates = () => {
    const names = Object.keys(D.templates || {});
    let chosen = names[0] || '';
    const load = () => {
      if (!chosen) return;
      d = clone(D.templates[chosen]);
      ['poster', 'backdrop', 'logo'].forEach((k) => touched.add(k));
      drawControls(); refresh(); msg.textContent = `Loaded "${chosen}". Save to apply it to the selected target.`;
    };
    tplBox.replaceChildren(
      names.length ? h('div', { class: 'row' }, select(names, chosen, (x) => { chosen = x; }),
        btn('Load', load, 'secondary'),
        btn('Delete', async () => { if (chosen && confirm(`Delete template "${chosen}"?`)) { await api('deleteTemplate', { name: chosen }); D = await api('getDesigns', P || {}); drawTemplates(); } }, 'danger'))
        : h('p', { class: 'muted' }, 'No templates saved yet.'),
      h('div', { class: 'row' }, tplName, btn('Save as Template', async () => {
        const name = tplName.value.trim();
        if (!name) { msg.textContent = 'Enter a template name.'; return; }
        await api('saveTemplate', { name, design: JSON.stringify(d) });
        tplName.value = ''; D = await api('getDesigns', P || {}); drawTemplates(); msg.textContent = `Template "${name}" saved.`;
      }, 'secondary')));
  };

  // Design controls: every option works with every layout; the RPDB engine greys out what RPDB's API cannot draw.
  const controls = h('div');
  const field = (key, label, el) => {
    if (!can(key)) {
      if (el.matches?.('input,select,button')) el.disabled = true;
      el.querySelectorAll?.('input,select,button').forEach((i) => { i.disabled = true; });
      el.style.pointerEvents = 'none';
    }
    return h('div', { class: can(key) ? '' : 'muted' }, h('h3', {}, label), el);
  };
  const sourcePicker = () => {
    const box = h('div');
    const draw = () => {
      const order = d.order ? d.order.split(',') : [];
      const ex = d.exclude ? d.exclude.split(',') : [];
      box.replaceChildren(
        h('h3', {}, 'Rating Order'),
        h('div', { class: 'chips' }, DESIGN_SOURCES.map(([k, l]) => {
          const i = order.indexOf(k);
          return h('span', { class: `chip${i >= 0 ? ' on' : ''}`, onclick: () => { if (i >= 0) order.splice(i, 1); else order.push(k); set('order', order.join(',')); draw(); } }, i >= 0 ? `${i + 1}. ${l}` : l);
        })),
        h('p', { class: 'muted' }, 'Click sources in the order you want them first; the rest follow in the default order. Common Sense, US Age and the Overall / Critics / Audience averages only show when picked.'),
        h('h3', {}, 'Never Show'),
        h('div', { class: 'chips' }, DESIGN_SOURCES.map(([k, l]) => {
          const on = ex.includes(k);
          return h('span', { class: `chip${on ? ' on' : ''}`, onclick: () => { set('exclude', (on ? ex.filter((x) => x !== k) : [...ex, k]).join(',')); draw(); } }, l);
        })));
    };
    draw();
    return box;
  };
  const drawControls = () => {
    const o = look();
    const bar = o.layout === 'bar';
    const k = kind;
    const only = (opts, allowed) => (rpdb ? opts.filter(([v]) => allowed.includes(v)) : opts);
    const presets = D.presetNames.filter(([id]) => !rpdb || id.startsWith('rpdb:'));
    const nodes = [
      rpdb ? h('p', { class: 'muted' }, 'RPDB engine: greyed-out options are not supported by RPDB\'s API, and the ratings shown come from Poster Settings.') : '',
      h('h3', {}, 'Image'), radios('dkind', [['poster', 'Poster'], ['backdrop', 'Backdrop'], ['logo', 'Logo']], kind, (x) => { kind = x; drawControls(); refresh(); }),
      h('h3', {}, 'Start From a Preset'),
      select([['', 'Choose a preset …'], ...presets], '', (x) => { if (x) { d[kind] = clone(D.presets[x][kind]); touched.add(kind); drawControls(); refresh(); } }),
      h('p', { class: 'muted' }, 'A preset sets every option below; any of them can then be changed and combined.'),
      field('layout', 'Layout', radios(`dlayout-${k}`, [['badges', 'Separate badges'], ['bar', 'One shared bar']], o.layout, (x) => { setL('layout', x); drawControls(); })),
      bar ? '' : field('tile', 'Badge Style', radios(`dtile-${k}`, only([['split', 'OPDB split (label + value)'], ['block', 'RPDB block'], ['box', 'RPDB box (value + underline)']], ['block', 'box']), o.tile, (x) => setL('tile', x))),
      field('position', 'Position', positionGrid(o.position, (x) => { setL('position', x); if ((x === 'l' || x === 'r') && o.arrange !== 'column') { o.arrange = 'column'; drawControls(); } })),
      field('arrange', 'Arrangement', radios(`darr-${k}`, [['row', 'Side by side'], ['column', 'Stacked']], o.arrange, (x) => setL('arrange', x))),
      bar ? field('span', 'Bar Length', radios(`dspan-${k}`, [['full', 'Full edge'], ['fit', 'Fit to ratings']], o.span, (x) => setL('span', x)))
        : field('content', 'Logo Placement', radios(`dcontent-${k}`, [['beside', 'Beside the score'], ['above', 'Above the score']], o.content, (x) => setL('content', x))),
      field('icons', 'Icons', select(only(DESIGN_OPTS.icons, ['rpdb', 'rpdb-round', 'none']), o.icons, (x) => setL('icons', x))),
      field('certIcons', 'Certifications', check('Certified Fresh / Must-See icons for top scores', o.certIcons, (x) => setL('certIcons', x))),
      field('numbers', 'Number Format', select(only(DESIGN_OPTS.numbers, ['auto', 'whole', 'short']), o.numbers, (x) => setL('numbers', x))),
      field('limit', 'Number of Ratings', slider({ min: 0, max: 10, value: o.limit, fmt: (v) => (v === 0 ? 'None' : String(v)), onchange: (v) => setL('limit', v) })),
      field('fill', 'Fill', select([...only(DESIGN_OPTS.fill, ['dark', 'light', 'none']), ...COLORS.map((c) => [c, c])], o.fill, (x) => setL('fill', x))),
      field('opacity', 'Fill Opacity', slider({ min: 0.05, max: 1, step: 0.05, value: o.opacity, auto: true, fmt: pct, onchange: (v) => setL('opacity', v) })),
      field('text', 'Text Colour', select([['auto', 'Auto'], ...COLORS.map((c) => [c, c])], o.text, (x) => setL('text', x))),
      field('size', 'Size', slider({ min: 0.5, max: 2, step: 0.05, value: o.size, fmt: pct, onchange: (v) => setL('size', v) })),
      field('font', 'Font', radios(`dfont-${k}`, [['auto', 'Auto'], ['inter', 'Inter'], ['roboto', 'Roboto']], o.font, (x) => setL('font', x))),
      field('fontScale', 'Font Scale', slider({ min: 0.7, max: 1.6, step: 0.05, value: o.fontScale, fmt: pct, onchange: (v) => setL('fontScale', v) })),
      field('bold', 'Font Weight', check('Bold', o.bold, (x) => setL('bold', x))),
      field('corners', 'Corners', slider({ min: 0, max: 60, value: o.corners, auto: true, fmt: px, special: { value: 'full', label: 'Full (pill)' }, onchange: (v) => setL('corners', v ?? 'auto') })),
      field('skew', 'Slant', radios(`dskew-${k}`, [['none', 'None'], ['right', 'Right'], ['left', 'Left']], o.skew, (x) => setL('skew', x))),
      field('stroke', 'Outline', select([['auto', 'Auto'], ['none', 'None'], ...(rpdb ? [] : [['source', 'Source colour']]), ...COLORS.map((c) => [c, c])], o.stroke, (x) => setL('stroke', x))),
      field('strokeWidth', 'Outline Width', slider({ min: 1, max: 30, value: o.strokeWidth, fmt: px, onchange: (v) => setL('strokeWidth', v) })),
      field('strokeSide', 'Outline Side', radios(`dside-${k}`, [['all', 'All'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']], o.strokeSide, (x) => setL('strokeSide', x))),
      field('padding', 'Padding', slider({ min: 0, max: 60, value: o.padding, auto: true, fmt: px, onchange: (v) => setL('padding', v) })),
      field('margin', 'Margin', slider({ min: 0, max: 60, value: o.margin, auto: true, fmt: px, onchange: (v) => setL('margin', v) })),
      field('gap', 'Gap', slider({ min: 0, max: 60, value: o.gap, auto: true, fmt: px, onchange: (v) => setL('gap', v) })),
      field('frame', 'Frame', select(DESIGN_OPTS.frames[k], o.frame, (x) => setL('frame', x))),
      field('imageSize', 'Image Size', select(DESIGN_OPTS.sizes[k], o.imageSize, (x) => setL('imageSize', x))),
    ];
    if (k === 'backdrop') {
      nodes.push(field('certBadges', 'Certification Badges', select([['none', 'None'], ['left', 'Top left'], ['right', 'Top right']], o.certBadges, (x) => setL('certBadges', x))),
        field('insetX', 'Edge Inset (horizontal)', slider({ min: 0, max: 50, value: o.insetX, fmt: (v) => `${v}%`, onchange: (v) => setL('insetX', v) })),
        field('insetY', 'Edge Inset (vertical)', slider({ min: 0, max: 50, value: o.insetY, fmt: (v) => `${v}%`, onchange: (v) => setL('insetY', v) })),
        h('p', { class: 'muted' }, "Local backdrops use TMDB's best textless backdrop (needs a TMDB key). Media badges are added when \"Badges on Backdrops\" is on."));
    }
    if (k === 'logo') nodes.push(h('p', { class: 'muted' }, "Local logos use TMDB's best logo in your poster language, then English (needs a TMDB key)."));
    const ratings = [sourcePicker()];
    if (k === 'poster') ratings.push(check('Prefer Textless Artwork (needs TMDB key)', d.textless, (x) => set('textless', x)));
    nodes.push(field('order', 'Ratings (all images)', h('div', {}, ...ratings)),
      h('p', { class: 'muted' }, 'Labels and media badges (4K, HDR, flags...) are set per folder or title with "Add Badges / Label".'));
    controls.replaceChildren(...nodes);
  };

  const engine = engineToggle(() => posterDesigner({ preview: P, target: tgt, back }));
  const targetParams = () => (tgt === 'global' ? { target: 'global' } : tgt === 'item' ? { target: 'item', ...P } : { target: 'folder', folder: tgt.slice(7) });

  drawTitle(); drawTargets(); drawTemplates(); drawControls(); refresh();
  view('Poster Designer',
    h('h2', {}, 'Poster Engine'), engine,
    h('p', { class: 'muted' }, rpdb
      ? 'RPDB makes your posters, backdrops and logos. The preview is a local approximation of RPDB\'s styles, so it updates instantly without using RPDB requests. Use "Check with RPDB" for an exact render.'
      : 'Locally rendered posters, backdrops and logos: TMDB artwork with ratings from MDBList. OpenPosterDB and RPDB looks are presets; every option combines with every layout.'),
    h('div', {}, h('h2', {}, 'Design'),
      h('div', { class: 'designer' },
        h('div', { class: 'designer-preview' }, img, search, results, titleBox,
          rpdb && S.apiKeyPrefix ? h('div', {}, btn('Check with RPDB', checkRpdb, 'secondary'), h('p', { class: 'muted' }, 'Fetches a real RPDB render of The Godfather with these styles (uses one request).'), exact) : ''),
        h('div', {}, h('h3', {}, 'Apply To'), targetBox, controls))),
    h('h2', {}, 'Templates'), tplBox, msg,
    btn('Save Design', async () => {
      const r = rpdb
        ? (touched.size ? await api('setRpdbDesign', { ...targetParams(), design: JSON.stringify(d), kinds: [...touched].join(',') }) : { success: true })
        : await api('setDesign', { ...targetParams(), design: JSON.stringify(d) });
      if (r.success) { touched.clear(); D = await api('getDesigns', P || {}); }
      msg.className = r.success ? 'ok' : 'err';
      msg.textContent = r.success ? 'Design saved. It applies to new images; run an overwrite scan to redo existing ones.' : r.message || 'Failed';
    }),
    btn('Reset to Default', async () => {
      if (rpdb) {
        if (tgt === 'global' && !confirm('Remove image style overrides from all media folders?')) return;
        const defaults = { poster: D.presets['rpdb:default'].poster, backdrop: D.presets['rpdb:default'].backdrop, logo: D.presets['rpdb:default'].logo };
        await api('setRpdbDesign', { ...targetParams(), design: JSON.stringify(defaults), kinds: 'poster,backdrop,logo' });
      } else if (tgt === 'global') {
        d = clone(D.defaults);
        drawControls(); refresh();
        msg.className = 'ok'; msg.textContent = 'Defaults restored. Save to apply them.';
        return;
      } else {
        await api('setDesign', targetParams());
      }
      D = await api('getDesigns', P || {}); loadState(); drawControls(); refresh();
      msg.className = 'ok';
      msg.textContent = rpdb ? 'Image styles removed; RPDB defaults apply.' : 'Override removed; this target now follows the global default.';
    }, 'secondary'),
    btn('Back', back, 'secondary'));
}

// ---------- MDBList keys ----------
function mdblistKeySection() {
  const box = h('div');
  const status = h('p');
  const input = h('input', { type: 'password', placeholder: 'MDBList API Key', autocomplete: 'off' });
  const apply = (r) => {
    if (!r.success) { status.className = 'err'; status.textContent = r.message || 'Failed'; return; }
    S.mdblistKeySet = r.mdblistKeySet; S.mdblistKeys = r.mdblistKeys; input.value = ''; draw();
  };
  const draw = () => {
    const keys = S.mdblistKeys || [];
    const max = S.mdblistKeyMax || 5;
    status.className = keys.length ? 'ok' : 'muted';
    status.textContent = keys.length ? `Status: ${keys.length} of ${max} keys saved` : 'Status: not set';
    box.replaceChildren(...keys.map((k, i) => h('div', {},
      h('span', {}, `Key ${i + 1}: ${k.prefix}… `),
      h('span', { class: k.limitedUntil ? 'err' : 'muted' }, k.limitedUntil ? `limit reached until ${new Date(k.limitedUntil).toLocaleString()} ` : ''),
      btn('Remove', async () => { status.className = 'muted'; status.textContent = 'Removing key …'; apply(await api('removeMdblistKey', { index: i })); }, 'secondary'))),
    keys.length < max ? h('div', {}, input, btn(keys.length ? 'Add Key' : 'Save Key', async () => {
      const key = input.value.trim();
      if (!key) return;
      status.className = 'muted'; status.textContent = 'Checking key …';
      apply(await api('setMdblistKey', { key }));
    })) : '');
  };
  draw();
  return h('div', {},
    h('h2', {}, 'MDBList API Keys'),
    h('p', { class: 'muted' }, 'Required for the local engine. Provides ratings from IMDb, TMDB, Rotten Tomatoes, Metacritic, Trakt, Letterboxd, MyAnimeList, MDBList and Roger Ebert, also shown when editing a poster. Get a free key at ',
      h('a', { href: 'https://mdblist.com/preferences/', target: '_blank', rel: 'noopener' }, 'mdblist.com/preferences'), '.'),
    h('p', { class: 'muted' }, `Add up to ${S.mdblistKeyMax || 5} keys. When one reaches its daily request limit the next is used; when all have, scanning pauses at that title and resumes once a limit resets.`),
    box, status);
}

function ratingsPanel(type, name) {
  const box = h('div', { class: 'ratings' });
  if (!S.mdblistKeySet) {
    box.append(h('p', { class: 'muted' }, 'Add an MDBList API key under API Keys to see ratings from all sources here.'));
    return box;
  }
  box.append(h('p', { class: 'muted' }, 'Loading ratings …'));
  api('ratings', { type, name }).then((r) => {
    if (!r.success) { box.replaceChildren(h('p', { class: 'muted' }, r.message || 'Could not load ratings')); return; }
    if (!r.badges.length) { box.replaceChildren(h('p', { class: 'muted' }, 'MDBList has no ratings for this title.')); return; }
    box.replaceChildren(...r.badges.map((b) => h('div', { class: 'rating', title: b.votes ? `${b.label} · ${Number(b.votes).toLocaleString()} votes` : b.label },
      h('span', { class: 'rating-src', style: `background:${b.color}` }, h('img', { src: `icons/${b.key}.png`, alt: '' }), b.label),
      h('span', { class: 'rating-val' }, b.value))));
  });
  return box;
}

// ---------- Plex ----------
function plexConnection() {
  const f = { plexProtocol: S.plexProtocol || 'https', plexHost: S.plexHost || '', plexPort: S.plexPort || '32400', plexToken: S.plexToken || '' };
  const out = h('p', { class: 'muted' }, 'Note: ad blockers can interfere with connection tests.');
  const inp = (k, ph) => h('input', { type: 'text', placeholder: ph, value: f[k], oninput: (e) => { f[k] = e.target.value; } });
  view('Plex Connection Settings', h('h3', {}, 'Protocol'), select(['https', 'http'], f.plexProtocol, (x) => { f.plexProtocol = x; }),
    h('h3', {}, 'Address'), inp('plexHost', 'Address'), h('h3', {}, 'Port'), inp('plexPort', '32400'), h('h3', {}, 'Token'), inp('plexToken', 'Token'), out,
    btn('Save Settings', async () => { await setSetting(f); out.textContent = 'Saved.'; }),
    btn('Test Connection', async () => { const r = await api('testPlex', f); out.textContent = r.success ? 'Connected!' : 'Connection failed.'; out.className = r.success ? 'ok' : 'err'; }, 'secondary'),
    btn('Back', scanSettings, 'secondary'));
}
function plexRefresh() {
  const f = { plexDelayType: S.plexDelayType || 'none', plexRefreshDelay: S.plexRefreshDelay || 0, plexTodHour: S.plexTodHour, plexTodMin: S.plexTodMin, plexTodAmPm: S.plexTodAmPm, plexDetect: S.plexDetect };
  const out = h('p', { class: 'muted' });
  const delays = [[0, 'None'], [5000, '5s'], [15000, '15s'], [30000, '30s'], [60000, '1m'], [180000, '3m'], [300000, '5m'], [600000, '10m'], [900000, '15m']];
  view('Plex Refresh Settings', h('p', { class: 'js-plexq' }, 'Refresh Status'),
    h('h3', {}, 'Delay Type'), select([['none', 'None'], ['delay', 'Delay'], ['tod', 'Time of Day']], f.plexDelayType, (x) => { f.plexDelayType = x; }),
    h('h3', {}, 'Refresh Delay'), radios('pdel', delays, f.plexRefreshDelay, (x) => { f.plexRefreshDelay = x; }),
    h('h3', {}, 'Time of Day'),
    h('div', { class: 'row' }, select(range(1, 12, 1), f.plexTodHour, (x) => { f.plexTodHour = x; }),
      select(range(0, 59, 1).map((m) => [m, String(m).padStart(2, '0')]), f.plexTodMin, (x) => { f.plexTodMin = x; }),
      select(['AM', 'PM'], f.plexTodAmPm, (x) => { f.plexTodAmPm = x; })),
    check('Use Plex to Match Folder Name to Metadata ID', bool(f.plexDetect), (x) => { f.plexDetect = x ? 1 : 0; }), out,
    btn('Save Settings', async () => { await api('savePlexRefreshSettings', f); out.textContent = 'Saved.'; }), btn('Back', scanSettings, 'secondary'));
}
async function plexOAuth() {
  const out = h('p', {}, 'Waiting for Plex sign-in …');
  view('Connect to Plex', out, btn('Cancel', scanSettings, 'secondary'));
  const clientID = localStorage.getItem('rpdbPlexId') || crypto.randomUUID();
  localStorage.setItem('rpdbPlexId', clientID);
  const headers = { Accept: 'application/json', 'X-Plex-Product': 'Rating Poster Database', 'X-Plex-Client-Identifier': clientID };
  try {
    const pin = await (await fetch('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers })).json();
    window.open(`https://app.plex.tv/auth#?clientID=${clientID}&code=${pin.code}&context[device][product]=${encodeURIComponent('Rating Poster Database')}`, '_blank');
    const end = Date.now() + (pin.expiresIn || 1800) * 1000;
    let token = null;
    while (Date.now() < end && !token) {
      await new Promise((r) => setTimeout(r, 1000));
      token = (await (await fetch(`https://plex.tv/api/v2/pins/${pin.id}`, { headers })).json()).authToken;
    }
    if (!token) { out.textContent = 'Timed out waiting for Plex.'; return; }
    out.textContent = 'Looking for your Plex servers …';
    let xml = await fetch(`https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${token}`).then((r) => (r.ok ? r.text() : ''));
    if (!xml) xml = await fetch(`https://plex.tv/api/resources?X-Plex-Token=${token}`).then((r) => r.text());
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    for (const dev of doc.querySelectorAll('Device')) {
      if (!(dev.getAttribute('provides') || '').includes('server')) continue;
      for (const c of dev.querySelectorAll('Connection')) {
        const uri = c.getAttribute('uri');
        try {
          const t = await fetch(`${uri}/library/sections?X-Plex-Token=${token}`).then((r) => r.text());
          if (!t.includes('Directory')) continue;
          const u = new URL(uri);
          const f = { plexProtocol: u.protocol.replace(':', ''), plexHost: u.hostname, plexPort: u.port || (u.protocol === 'https:' ? '443' : '80'), plexToken: token };
          const r = await api('testPlex', f);
          if (r.success) { await setSetting(f); out.textContent = 'Connected to Plex!'; out.className = 'ok'; setTimeout(scanSettings, 1200); return; }
        } catch { /* try the next connection */ }
      }
    }
    out.textContent = 'Could not connect to any Plex server.'; out.className = 'err';
  } catch (e) { out.textContent = `Plex sign-in failed: ${e.message}`; out.className = 'err'; }
}

// ---------- folder browser ----------
function folderPicker(onPick) {
  let current = '';
  const pathBox = h('div', { class: 'path' }, 'None');
  const list = h('div', { class: 'list' });
  const parentOf = (p) => {
    if (/^[A-Za-z]:[\\/]?$/.test(p)) return null;
    const t = p.replace(/[\\/]+$/, '');
    const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
    if (i < 0) return null;
    return i === 0 ? '/' : /^[A-Za-z]:$/.test(t.slice(0, i)) ? `${t.slice(0, i)}\\` : t.slice(0, i);
  };
  const setCurrent = (p) => { current = p; pathBox.textContent = p || 'None'; onPick(p); };
  async function load(folder) {
    const r = await api('browse', folder ? { folder } : {});
    list.replaceChildren();
    if (folder) list.append(h('div', { onclick: () => load(parentOf(folder)) }, '..'));
    if (!r.success) { list.append(h('div', { class: 'err' }, r.message || 'Could not read folder')); return; }
    for (const f of r.folders) list.append(h('div', { onclick: () => { setCurrent(f.path); load(f.path); } }, f.label || f.path));
    if (folder) setCurrent(folder);
  }
  pathBox.addEventListener('click', () => {
    const input = h('input', { type: 'text', value: current });
    const save = btn('Save Location', () => { setCurrent(input.value.trim()); pathBox.replaceChildren(current || 'None'); if (current) load(current); });
    pathBox.replaceChildren(input, save);
  });
  load('');
  return h('div', {}, pathBox, list);
}

function addFolder(type) {
  let chosen = '';
  let badgeParams = {};
  let styleParams = {};
  const out = h('p', { class: 'err' });
  view(`Add ${type === 'movie' ? 'Movie' : 'Series'} Folder`, folderPicker((p) => { chosen = p; }),
    btn('Add Badges / Label', () => badgeDialog({ initial: badgeParams, onSave: (p) => { badgeParams = p; return back(); }, onCancel: () => back() })),
    btn('Add Image Styles', () => styleDialog({ initial: styleParams, onSave: (p) => { styleParams = p; return back(); }, onCancel: () => back() })),
    out,
    btn('Add Folder', async () => {
      if (!chosen) { out.textContent = 'Choose a folder first.'; return; }
      const r = await api(type === 'movie' ? 'addMovieFolder' : 'addSeriesFolder', { folder: chosen, ...badgeParams });
      if (!r.success) { out.textContent = r.message || 'Failed to add folder'; return; }
      if (Object.keys(styleParams).length) await api('editFolderStyles', { folder: chosen, ...styleParams });
      mainMenu();
    }), btn('Back', mainMenu, 'secondary'));
  function back() { return addFolder(type); }
}

async function editFolders() {
  S = await api('getSettings');
  const entry = (type, f) => h('div', { onclick: () => editFolder(type, f) }, f);
  view('Edit Media Folder', h('h2', {}, 'Movie Folders'), h('div', { class: 'list' }, S.movieFolders.map((f) => entry('movie', f))),
    h('h2', {}, 'Series Folders'), h('div', { class: 'list' }, S.seriesFolders.map((f) => entry('series', f))), btn('Back', mainMenu, 'secondary'));
}
async function editFolder(type, folder) {
  const msg = h('p', { class: 'muted' });
  const scan = async (route) => { const r = await api(route, { folder, type }); msg.textContent = r.success ? 'Scan started.' : r.message || 'Failed'; };
  view('Edit Media Folder', h('p', { class: 'path' }, folder),
    btn('Add Badges / Label', async () => {
      const cur = await api('getBadgeSettings', { folder });
      badgeDialog({ ctx: { folder }, initial: settingsToBadgeParams(cur), onSave: async (p) => { await api('editFolderLabel', { folder, ...p }); editFolder(type, folder); }, onCancel: () => editFolder(type, folder) });
    }),
    btn('Add Image Styles', async () => {
      if (S.posterEngine === 'local') return posterDesigner({ target: `folder:${folder}`, back: () => editFolder(type, folder) });
      const cur = await api('getStylesSettings', { folder });
      delete cur.success;
      styleDialog({ initial: cur, onSave: async (p) => { await api('editFolderStyles', { folder, ...p }); editFolder(type, folder); }, onCancel: () => editFolder(type, folder) });
    }),
    h('p', { class: 'js-scan' }, 'Idle, not scanning'), btn('Cancel Scan', () => api('cancelScan'), 'secondary'),
    btn('Run Full Scan of Folder', () => scan('runFullScan')),
    btn('Force Overwrite Scan of Folder', () => confirm('This may deplete your monthly requests. Continue?') && scan('forceOverwriteScan'), 'danger'), msg,
    btn('Remove Media Folder', async () => { if (confirm('Remove this media folder?')) { await api(type === 'movie' ? 'removeMovieFolder' : 'removeSeriesFolder', { folder }); editFolders(); } }, 'danger'),
    btn('Back', editFolders, 'secondary'));
}

// ---------- item selection and poster edit ----------
async function findItem(type) {
  const input = h('input', { type: 'text', placeholder: 'Search (regex, case-insensitive)' });
  const results = h('div', { class: 'list' });
  const choiceSel = h('select');
  const status = h('p', { class: 'muted' }, 'Loading Search Index …');
  let data = { folders: '//', forbiddenChar: '/', folderChoices: [] };
  const draw = () => {
    results.replaceChildren();
    let re;
    try { re = new RegExp(input.value || '.', 'i'); } catch { return; }
    const items = data.folders.split('//').map((s) => s.replace(/^\/|\/$/g, '')).filter(Boolean);
    let n = 0;
    for (const raw of items) {
      const [name] = raw.split('\u200b');
      if (!re.test(raw)) continue;
      results.append(h('div', { onclick: () => posterEdit(type, name, () => findItem(type)) }, raw.replace('\u200b', '')));
      if (++n >= 10) break;
    }
  };
  const load = async (folder) => {
    data = await api('searchStrings', { type, searchfolder: folder });
    status.textContent = '';
    if (!folder) choiceSel.replaceChildren(h('option', { value: '' }, 'All'), ...data.folderChoices.map((c) => h('option', { value: c }, c)));
    draw();
  };
  choiceSel.addEventListener('change', () => load(choiceSel.value));
  input.addEventListener('input', draw);
  const imdbInput = h('input', { type: 'text', placeholder: 'IMDB URL or ID' });
  const imdbOut = h('p', { class: 'err' });
  view(`Edit ${type === 'movie' ? 'Movie' : 'Series'} Poster`, h('h2', {}, 'Search for Folder Name'), status, choiceSel, input, results,
    h('h2', {}, 'By IMDB URL or ID'), imdbInput, imdbOut,
    btn('Find', async () => {
      const id = (imdbInput.value.match(/tt\d+/i) || [])[0];
      if (!id) { imdbOut.textContent = 'Invalid IMDB URL / IMDB ID'; return; }
      const r = await api('findByImdb', { type, imdb: id });
      if (!r.names || !r.names.length) { imdbOut.textContent = `No ${type} folder is matched to ${id} yet. Search for the folder name, then use Fix Match.`; return; }
      imdbOut.textContent = '';
      posterEdit(type, r.names[0], () => findItem(type));
    }, 'secondary'),
    btn('Back', mainMenu, 'secondary'));
  load('');
}

function posterEdit(type, name, back) {
  const img = h('img', { class: 'poster', alt: name, onerror: (e) => { e.target.src = 'missing-poster.png'; e.target.onerror = null; } });
  const reload = () => { img.src = url('poster', { type, name, break: Date.now() }); };
  reload();
  const msg = h('p', { class: 'muted' });
  const fixInput = h('input', { type: 'text', placeholder: 'IMDB URL or ID' });
  const customInput = h('input', { type: 'text', placeholder: 'Image URL' });
  const choicesBox = h('div');
  const run = async (route, params) => { const r = await api(route, { folder: name, type, ...params }); msg.className = r.success ? 'ok' : 'err'; msg.textContent = r.success ? 'Done, the update was queued.' : r.message || 'Failed'; if (r.success) setTimeout(reload, 2500); return r; };
  const loadChoices = async () => {
    choicesBox.textContent = 'Loading …';
    const r = await api('poster-choices', { type, name });
    if (!r.items) { choicesBox.textContent = r.message || 'Could not load posters'; return; }
    const langs = [...new Set(r.items.map((i) => i.lang).filter(Boolean))];
    const grid = h('div', { class: 'thumbs' });
    const draw = (lang) => grid.replaceChildren(...r.items.filter((i) => !lang || i.lang === lang).slice(0, 25).map((i) =>
      h('img', { src: `https://www.themoviedb.org/t/p/w342${i.file_path}`, title: i.lang || '', onclick: () => run('tmdb-poster', { tmdbPoster: i.file_path }) })));
    choicesBox.replaceChildren(h('h3', {}, 'Poster Language'), select([['', 'None'], ...langs], '', draw), grid);
    draw('');
  };
  view(name, img, msg,
    h('h3', {}, 'Ratings'), ratingsPanel(type, name),
    h('h3', {}, 'Fix Match'), fixInput, btn('Add Match', () => run('addFixMatch', { imdb: fixInput.value })),
    h('h3', {}, 'Choose Poster'), ...gate(1, btn('Load Posters', loadChoices, 'secondary')), choicesBox,
    h('h3', {}, 'Custom Poster'), ...gate(3, h('div', {}, customInput, btn('Load Poster Image', () => run('custom-poster', { customPoster: customInput.value }), 'secondary'))),
    btn('Update Ratings', () => run('update-ratings-poster')),
    btn('Use Default Poster', () => run('reset-poster'), 'secondary'),
    btn('Create Poster', () => createPoster(type, name, () => posterEdit(type, name, back)), 'secondary'),
    btn('Design This Poster', () => posterDesigner({ preview: { type, name }, target: 'item', back: () => posterEdit(type, name, back) }), 'secondary'),
    btn('Add Badges / Label', async () => {
      const cur = await api('getBadgeSettings', { folder: name, type });
      badgeDialog({ ctx: { type, name }, initial: settingsToBadgeParams(cur), onSave: async (p) => { await api('editItemLabel', { folder: name, type, ...p }); posterEdit(type, name, back); }, onCancel: () => posterEdit(type, name, back) });
    }),
    btn('Add Image Styles', async () => {
      if (S.posterEngine === 'local') return posterDesigner({ preview: { type, name }, target: 'item', back: () => posterEdit(type, name, back) });
      const cur = await api('getStylesSettings', { folder: name, type });
      delete cur.success;
      styleDialog({ initial: cur, onSave: async (p) => { await api('editItemStyles', { folder: name, type, ...p }); posterEdit(type, name, back); }, onCancel: () => posterEdit(type, name, back) });
    }),
    btn('Back', back, 'secondary'));
}

// ---------- badges / label dialog ----------
function settingsToBadgeParams(cur) {
  const p = {};
  for (const k of ['label', 'badgePos', 'backdropBadgePos', 'maxBadges', 'backdropMaxBadges', 'badgeSize']) if (cur[k] !== undefined) p[k] = cur[k];
  if (cur.autoBadges !== undefined) { p.badges = cur.autoBadges; p.autoBadges = 1; } else if (cur.badges !== undefined) p.badges = cur.badges;
  return p;
}
const AUTO_KEYS = [['ageRating', 'Common Sense Media Age Rating'], ['usAgeRating', 'US Age Rating'], ['videoQuality', 'Video Quality'], ['colorRange', 'Color Range'],
  ['videoCodec', 'Video Codec'], ['audioChannels', 'Audio Channels'], ['videoSource', 'Video Source']];

function badgeDialog({ ctx = {}, initial = {}, onSave, onCancel }) {
  const auto = bool(initial.autoBadges);
  const sub = auto ? Object.fromEntries(new URLSearchParams(initial.badges)) : {};
  const st = {
    mode: initial.label !== undefined ? 'label' : initial.badges !== undefined ? 'badges' : 'none',
    label: initial.label || '',
    method: auto ? 'auto' : 'manual',
    sub,
    manual: !auto && initial.badges ? initial.badges.split(',') : [],
    pos: initial.badgePos || '', bpos: initial.backdropBadgePos || '', max: initial.maxBadges || '', bmax: initial.backdropMaxBadges || '', size: initial.badgeSize || '',
  };
  if (initial.label !== undefined && initial.badges !== undefined) st.mode = 'badges';
  const body = h('div');
  const previewImg = h('img', { class: 'preview', alt: '' });

  const params = () => {
    const p = {};
    if (st.label) p.label = st.label;
    if (st.mode === 'badges') {
      if (st.method === 'auto') {
        const q = new URLSearchParams();
        for (const [k] of AUTO_KEYS) if (st.sub[k] === '1') q.set(k, '1');
        if (st.sub.countryFlag && st.sub.countryFlag !== 'none') {
          q.set('countryFlag', st.sub.countryFlag);
          if (st.sub.countryFlagWhere) q.set('countryFlagWhere', st.sub.countryFlagWhere);
          if (st.sub.countryFlag === 'detect' && st.sub.countryFlagDetectCount) q.set('countryFlagDetectCount', st.sub.countryFlagDetectCount);
        }
        if ([...q.keys()].length) { p.badges = q.toString(); p.autoBadges = 1; }
      } else if (st.manual.length) p.badges = st.manual.join(',');
    }
    if (st.mode === 'none') delete p.label;
    if (st.mode === 'badges' || st.mode === 'label') {
      if (st.pos) p.badgePos = st.pos;
      if (st.bpos) p.backdropBadgePos = st.bpos;
      if (st.max) p.maxBadges = st.max;
      if (st.bmax) p.backdropMaxBadges = st.bmax;
      if (st.size) p.badgeSize = st.size;
    }
    return p;
  };

  const draw = () => {
    const nodes = [];
    nodes.push(select([['none', 'None'], ['label', 'Label'], ['badges', 'Badges']], st.mode, (x) => { st.mode = x; draw(); }));
    if (st.mode === 'label') {
      nodes.push(...gate(2, h('div', {}, h('p', { class: 'muted' }, 'Labels are text shown at the top of the poster.'),
        h('input', { type: 'text', value: st.label, oninput: (e) => { st.label = e.target.value; } }))));
    }
    if (st.mode === 'badges') {
      const badgeNodes = [h('p', { class: 'muted' }, 'Up to 4 badges can be displayed on one poster.'),
        h('h3', {}, 'Badge Selection'), radios('bsel', [['auto', 'Automatic'], ['manual', 'Manual']], st.method, (x) => { st.method = x; draw(); })];
      if (st.method === 'auto') {
        badgeNodes.push(h('h3', {}, 'Detect Badges For'));
        for (const [k, label] of AUTO_KEYS) badgeNodes.push(check(label, st.sub[k] === '1', (x) => { if (x) st.sub[k] = '1'; else delete st.sub[k]; draw(); }));
        if (st.sub.colorRange === '1') {
          badgeNodes.push(h('h3', {}, 'Preferred HDR Badge'), select([['hdrcolor', 'Colorful'], ['hdr', 'Silver']], S.defaultBadges.hdr, (x) => { S.defaultBadges.hdr = x; setSetting({ hdrBadge: x }); }),
            h('h3', {}, 'Preferred DoVi Badge'), select([['dolbyvision', 'Default'], ['dolbyvisioncolor', 'Color'], ['dolbyvisioncoloralt', 'Color (alt)']], S.defaultBadges.dolbyvision, (x) => { S.defaultBadges.dolbyvision = x; setSetting({ doviBadge: x }); }));
        }
        if (st.sub.videoSource === '1') {
          badgeNodes.push(h('h3', {}, 'Preferred Remux Badge'), select([['remuxgold', 'Gold'], ['remux', 'Silver']], S.defaultBadges.remux, (x) => { S.defaultBadges.remux = x; setSetting({ remuxBadge: x }); }));
        }
        const cf = st.sub.countryFlag || 'none';
        badgeNodes.push(h('h3', {}, 'Country Badge'), select([['none', 'None'], ['detect', 'Detect from Video'], ['spoken-lang', 'Original Video Spoken Language'], ['spoken-lang-no-us', 'Original Video Spoken Language (no US)'], ...LOCALE_NAMES.map(([c, n]) => [c, n])], cf,
          (x) => { st.sub.countryFlag = x; if (x === 'none') { delete st.sub.countryFlagWhere; delete st.sub.countryFlagDetectCount; } draw(); }));
        if (cf !== 'none' && !cf.startsWith('spoken-lang')) {
          badgeNodes.push(h('h3', {}, 'Choose when to show country flag'), select([['', 'Audio / Subtitle Found'], ['audio', 'Audio Found'], ['sub', 'Subtitle Found']], st.sub.countryFlagWhere || '', (x) => { if (x) st.sub.countryFlagWhere = x; else delete st.sub.countryFlagWhere; }));
        }
        if (cf === 'detect') {
          badgeNodes.push(h('h3', {}, 'Choose how many country flags to show'), select([['1-langs', 'Primary Only'], ['2-langs', '2 Languages'], ['3-langs', '3 Languages']], st.sub.countryFlagDetectCount || '1-langs', (x) => { st.sub.countryFlagDetectCount = x; }));
          if (!st.sub.countryFlagDetectCount) st.sub.countryFlagDetectCount = '1-langs';
        }
      } else {
        const chips = h('div', { class: 'chips' });
        const drawChips = () => chips.replaceChildren(...st.manual.map((b, i) => h('span', { class: 'chip on', title: 'Click to remove', onclick: () => { st.manual.splice(i, 1); drawChips(); } }, b)));
        drawChips();
        const cats = Object.entries({ ...BADGE_CATEGORIES, 'Country flag': LOCALES.map((l) => `country.${l}`) }).map(([cat, vals]) =>
          select([['', cat], ...vals], '', () => {}, { onchange: (e) => { const x = e.target.value; if (x && st.manual.length < 4 && !st.manual.includes(x)) st.manual.push(x); e.target.value = ''; drawChips(); } }));
        badgeNodes.push(chips, ...cats);
      }
      nodes.push(...gate(2, h('div', {}, badgeNodes)));
    }
    if (st.mode !== 'none') {
      nodes.push(h('h3', {}, 'Poster Badge Position'), ...gate(3, select([['', 'Default'], ...BADGE_POSITIONS.filter((x) => x !== 'left')], st.pos, (x) => { st.pos = x; })));
      if (S.backdrops) nodes.push(h('h3', {}, 'Backdrop Badge Position'), ...gate(3, select([['', 'Default'], ...BACKDROP_BADGE_POSITIONS], st.bpos, (x) => { st.bpos = x; })));
      nodes.push(h('h3', {}, 'Badge Size'), select([['', 'Default'], ['small', 'Small']], st.size, (x) => { st.size = x; }),
        h('h3', {}, 'Maximum badges to show on poster'), select([['', 'Default'], 1, 2, 3, 4], st.max, (x) => { st.max = x; }));
      if (S.backdrops) nodes.push(h('h3', {}, 'Maximum badges to show on backdrop'), select([['', 'Default'], 1, 2, 3, 4], st.bmax, (x) => { st.bmax = x; }));
    }
    body.replaceChildren(...nodes);
  };
  draw();

  const previewQuery = () => {
    const p = params();
    const q = {};
    if (p.label) q.label = p.label;
    if (p.badges) q.badges = p.autoBadges ? 'country.it,age16,age16gold,pg_13,pg_13_gold' : p.badges;
    for (const k of ['badgePos', 'maxBadges', 'badgeSize']) if (p[k]) q[k] = p[k];
    return q;
  };
  const preview = () => { previewImg.src = url('badge-preview', { ...ctx, over: 1, width: 500, ...previewQuery() }); };
  // Real RPDB render (one request) of The Godfather with the same badges
  const checkRpdb = () => { previewImg.src = url('preview', previewQuery()); };
  const rpdbCheck = S.posterEngine !== 'local' && S.apiKeyPrefix;
  view('Choose Badge or Label', body, previewImg, btn('Preview Image', preview, 'secondary'), rpdbCheck ? btn('Check with RPDB', checkRpdb, 'secondary') : '',
    btn('Save & Close', () => onSave(params())), btn('Cancel', onCancel, 'secondary'));
}

// ---------- image styles dialog ----------
const STYLE_PARAM = { Size: 'imageSize', Theme: 'theme', BarPos: 'ratingBarPos', FontSize: 'fontScale', FontWeight: 'fontWeight', TextStyle: 'textStyle', LogoStyle: 'logoStyle',
  BarOpacity: 'ratingBarOpacity', BarColor: 'ratingBarColor', FontColor: 'fontColor', BarPadding: 'ratingBarPadding', BarMargin: 'ratingBarMargin', BarRoundness: 'ratingBarRoundness',
  BarStrokeColor: 'ratingBarStrokeColor', BarStrokeWidth: 'ratingBarStrokeWidth', BarStrokeSide: 'strokeSide', BarSkewDirection: 'ratingBarSkewDirection' };
const BLOCK_ONLY = ['BarPadding', 'BarMargin', 'BarRoundness', 'BarStrokeColor', 'BarStrokeWidth', 'BarStrokeSide', 'BarSkewDirection'];

function styleDefs(kind) {
  const D = (v, l) => [v, l ?? v];
  const sizes = kind === 'backdrop' ? [D('', 'Medium (1080p)'), D('small', 'Small'), D('large', 'Large (4K)')] : [D('', 'Medium'), D('large', 'Large'), D('verylarge', 'Very Large')];
  const themeOpts = [D('', kind === 'logo' ? 'Transparent Bar' : 'Default'), ...THEMES.slice(1).map((t) => D(t)), ...LIGHT_THEMES.map((t) => D(t))];
  const pos = kind === 'poster' ? POSTER_BAR_POS : kind === 'backdrop' ? BACKDROP_BAR_POS : LOGO_BAR_POS;
  const colors = [D(''), ...COLORS.map((c) => D(c))];
  return [
    { s: 'Size', label: 'Size', opts: sizes, tier: kind === 'backdrop' ? 1 : 1 },
    { s: 'Theme', label: 'Theme', opts: themeOpts, tier: 1 },
    { s: 'BarPos', label: 'Rating Bar Position', opts: [D(''), ...pos.map((p) => D(p))], tier: 1 },
    { s: 'FontSize', label: 'Font Size', opts: [D(''), ...range(1.1, 1.5, 0.1, 1).map((n) => D(String(n)))], tier: 2 },
    { s: 'FontWeight', label: 'Font Weight', opts: [D('', 'Default'), D('1', 'Bold')], tier: 2 },
    { s: 'BarOpacity', label: 'Rating Bar Opacity', opts: [D(''), ...range(0.99, 0.01, 0.01, 2).map(String)], tier: 3 },
    { s: 'BarColor', label: 'Rating Bar Color', opts: colors, tier: 3 },
    { s: 'FontColor', label: 'Font Color', opts: colors, tier: 3 },
    { s: 'TextStyle', label: 'Number Format', opts: [D('', 'Default (9.2/10, 97%)'), D('1', 'Whole numbers (92, 97)'), D('2', 'Short (9.2, 97%)')], tier: 3 },
    { s: 'LogoStyle', label: 'Rating Logo Style', opts: [D('', 'Default'), D('0', 'Square logos'), D('1', 'Round logos'), D('2', 'No logos')], tier: 3 },
    { s: 'BarPadding', label: 'Bar Padding', opts: [D(''), ...range(5, 55, 5).map(String)], tier: 3 },
    { s: 'BarMargin', label: 'Bar Margin', opts: [D(''), ...range(5, 55, 5).map(String)], tier: 3 },
    { s: 'BarRoundness', label: 'Bar Roundness', opts: [D(''), D('full'), ...range(0, 130, 5).map(String)], tier: 3 },
    { s: 'BarStrokeColor', label: 'Bar Stroke Color', opts: [...colors, D('transparent')], tier: 3 },
    { s: 'BarStrokeWidth', label: 'Bar Stroke Width', opts: [D(''), ...range(1, 30, 1).map(String)], tier: 3 },
    { s: 'BarStrokeSide', label: 'Bar Stroke Side', opts: [D(''), D('bottom'), D('top'), D('left'), D('right')], tier: 3 },
    { s: 'BarSkewDirection', label: 'Bar Skew Direction', opts: [D(''), D('none'), D('right'), D('left')], tier: 3 },
  ];
}

function styleDialog({ initial = {}, onSave, onCancel }) {
  const st = { ...initial };
  const body = h('div');
  const previewImg = h('img', { class: 'preview', alt: '' });
  const kinds = [['poster', 'Poster'], ...(S.backdrops ? [['backdrop', 'Backdrop']] : []), ...(S.logos ? [['logo', 'Logo']] : [])];
  const draw = () => {
    body.replaceChildren(...kinds.map(([kind, title]) => {
      const theme = st[`${kind}Theme`] || 'default';
      const blockless = theme === 'default' || theme.endsWith('-bar');
      const rows = styleDefs(kind).filter((d) => !(blockless && BLOCK_ONLY.includes(d.s))).map((d) => {
        const key = `${kind}${d.s}`;
        const sel = select(d.opts, st[key] || '', (x) => { if (x) st[key] = x; else delete st[key]; if (d.s === 'Theme') draw(); });
        const need = kind === 'poster' ? d.tier : Math.max(d.tier, 2);
        return h('div', {}, h('h3', {}, d.label), ...gate(need, sel));
      });
      if (kind === 'backdrop') {
        rows.push(h('div', {}, h('h3', {}, 'Backdrop Certificate Position'), ...gate(3, select([['', 'Default'], 'left', 'right'], st.backdropCertPos || '', (x) => { if (x) st.backdropCertPos = x; else delete st.backdropCertPos; }))));
      }
      return h('div', {}, h('h2', {}, title), rows);
    }));
  };
  draw();
  const preview = (kind) => {
    if (S.posterEngine === 'local' || !S.apiKeyPrefix) {
      const styles = Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith(kind)));
      previewImg.src = url('rpdb-preview', { styles: JSON.stringify(styles), kind, width: kind === 'backdrop' ? 1000 : 500 });
      return;
    }
    const q = {};
    for (const [k, v] of Object.entries(st)) {
      if (!k.startsWith(kind)) continue;
      const suffix = k.slice(kind.length);
      if (suffix === 'CertPos') q.certsPos = v; else if (STYLE_PARAM[suffix]) q[STYLE_PARAM[suffix]] = v;
    }
    if (kind === 'backdrop') q.imageBackdrop = 1;
    if (kind === 'logo') q.imageLogo = 1;
    previewImg.src = url('preview', q);
  };
  view('Choose Image Styles', body, previewImg,
    btn('Reset All Settings', () => { for (const k of Object.keys(st)) delete st[k]; draw(); }, 'secondary'),
    ...kinds.map(([k, t]) => btn(`Preview ${t} Image`, () => preview(k), 'secondary')),
    btn('Save & Close', () => onSave({ ...st })), btn('Cancel', onCancel, 'secondary'));
}

// ---------- create poster ----------
function createPoster(type, name, back) {
  const f = { posterType: 'poster-default', img: '', imdbUrl: '', tmdbUrl: '', rtUrl: '', mcUrl: '', malUrl: '', mal: '', imdb: '', mc: '', rt: '', rtaudience: '', mcaudience: '', rtCert: '0', mcCert: '0', rtAudienceCert: '0' };
  const out = h('p', { class: 'muted' });
  const previewImg = h('img', { class: 'preview', alt: '' });
  const inp = (k, label, ph) => h('div', {}, h('h3', {}, label), h('input', { type: 'text', placeholder: ph || '', value: f[k], oninput: (e) => { f[k] = e.target.value.trim(); } }));
  const ratings = () => ['mal', 'imdb', 'mc', 'rt', 'rtaudience', 'mcaudience'].filter((k) => f[k]).map((k) => `${k}:${f[k]}`).join('|');
  const params = () => ({ ratings: ratings(), posterType: f.posterType, rtCert: f.rtCert, mcCert: f.mcCert, rtAudienceCert: f.rtAudienceCert, imdbUrl: f.imdbUrl, tmdbUrl: f.tmdbUrl, rtUrl: f.rtUrl, mcUrl: f.mcUrl, malUrl: f.malUrl, img: f.img, mediaType: type });
  view('Create Poster', h('h3', {}, 'Poster Type'), posterTypeSelect(f.posterType, (x) => { f.posterType = x; }),
    inp('img', 'Image URL', 'https://…'), inp('imdbUrl', 'IMDB URL', 'https://www.imdb.com/title/tt…'),
    inp('mal', 'MyAnimeList Rating (1.0–10.0)'), inp('imdb', 'IMDB Rating (1.0–10.0)'), inp('mc', 'Metacritic (1–100)'), inp('rt', 'Rotten Tomatoes (1–100)'),
    h('h3', {}, 'Metacritic Certification'), select([['0', 'None'], ['1', 'Must See']], f.mcCert, (x) => { f.mcCert = x; }),
    h('h3', {}, 'Rotten Tomatoes Certification'), select([['0', 'None'], ['1', 'Certified Fresh'], ['-1', 'Rotten']], f.rtCert, (x) => { f.rtCert = x; }),
    inp('rtaudience', 'Rotten Tomatoes Audience (1–100)'),
    h('h3', {}, 'Rotten Tomatoes Audience Certification'), select([['0', 'None'], ['1', 'Verified Hot'], ['-1', 'Stale']], f.rtAudienceCert, (x) => { f.rtAudienceCert = x; }),
    inp('mcaudience', 'Metacritic Audience (1.0–10.0)'),
    h('h3', {}, 'Source URLs (optional)'), inp('tmdbUrl', 'TMDB URL'), inp('rtUrl', 'Rotten Tomatoes URL'), inp('mcUrl', 'Metacritic URL'), inp('malUrl', 'MyAnimeList URL'),
    previewImg, out,
    btn('Preview Poster', () => { previewImg.src = url('create-preview', params()); }, 'secondary'),
    btn('Save', async () => { const r = await api('create-poster', { folder: name, type, ...params() }); out.textContent = r.success ? 'Saved, the poster was queued.' : r.message || 'Failed'; }),
    S.apiKeyPrefix ? btn('Submit', async () => { const r = await api('submit-poster', params()); out.textContent = r.success ? 'Thank you for submitting your poster to RPDB!' : 'Could not submit the poster.'; }, 'secondary') : '',
    btn('Back', back, 'secondary'));
}

start();
