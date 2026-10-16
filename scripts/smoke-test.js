'use strict';

// Smoke test: `npm test`. Runs before every deploy on Render (see render.yaml), so a broken
// version never goes live. It checks that
//  1. every required file exists and (in a git checkout) is committed, not ignored;
//  2. the server starts on a fresh, temporary SQLite database;
//  3. /healthz answers 200, the map data is served and valid, the page and scripts load;
//  4. the main API routes work for a new account (register, tick a country, dashboard, …).
// It never touches the real database: DATABASE_URL is removed for the test server.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { APP_FILES, PACKAGE_FILES } = require('../required-files.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let failed = 0;

function check(ok, label, detail) {
  console.log(`${ok ? '✔' : '✘'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
  return ok;
}

function filesCheck() {
  for (const f of [...APP_FILES, ...PACKAGE_FILES]) check(fs.existsSync(path.join(ROOT, f)), `bestand aanwezig: ${f}`);
  // In a git checkout: the app files must be tracked, otherwise they won't reach Render.
  let inGit = false;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, stdio: 'ignore' });
    inGit = true;
  } catch (e) {
    console.log('  (geen git-checkout, git-controle overgeslagen)');
  }
  if (!inGit) return;
  for (const f of APP_FILES) {
    let tracked = true;
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', f], { cwd: ROOT, stdio: 'ignore' });
    } catch (e) {
      tracked = false;
    }
    let why = '';
    if (!tracked) {
      try {
        why = execFileSync('git', ['check-ignore', '-v', f], { cwd: ROOT }).toString().trim();
      } catch (e) {
        why = 'nog niet toegevoegd (git add)';
      }
    }
    check(tracked, `in git: ${f}`, why && `genegeerd door ${why}`);
  }
}

async function waitForServer(child, logs) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('server stopte meteen:\n' + logs.join(''));
    try {
      const res = await fetch(BASE + '/healthz');
      if (res.ok) return;
    } catch (e) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server startte niet binnen 10 seconden:\n' + logs.join(''));
}

async function httpChecks() {
  const health = await fetch(BASE + '/healthz');
  check(health.status === 200, '/healthz geeft 200', `status ${health.status}`);

  const config = await (await fetch(BASE + '/api/config')).json();
  check(!!config.mapVersion && !!config.build, '/api/config geeft mapVersion en build');

  const map = await fetch(`${BASE}/data/world.json?v=${config.mapVersion}`);
  let countries = 0;
  try {
    const topo = await map.json();
    countries = topo.objects.countries.geometries.length;
  } catch (e) {
    /* checked below */
  }
  check(map.status === 200 && countries >= 195, 'kaartdata wordt geserveerd en is geldig', `status ${map.status}, ${countries} landen`);

  const page = await (await fetch(BASE + '/')).text();
  check(page.includes(`content="${config.build}"`) && page.includes('/app.js?v='), 'startpagina laadt (met build-id)');
  for (const f of ['app.js', 'i18n.js', 'countries.js', 'climate.js', 'style.css', 'vendor/d3.min.js', 'flags/nl.svg']) {
    const res = await fetch(`${BASE}/${f}`);
    check(res.status === 200, `/${f} laadt`, `status ${res.status}`);
  }

  // A new account and the main routes.
  const post = (url, body, cookie, method) =>
    fetch(BASE + url, { method: method || 'POST', headers: { 'content-type': 'application/json', cookie: cookie || '' }, body: JSON.stringify(body) });
  const reg = await post('/api/register', { email: 'smoke@test.nl', password: 'smoketest123', name: 'Smoke Test' });
  check(reg.status === 200, 'account aanmaken', `status ${reg.status}`);
  const cookie = (reg.headers.get('set-cookie') || '').split(';')[0];
  const tick = await post('/api/me/countries/BE', { status: 'visited' }, cookie, 'PUT');
  check(tick.status === 200, 'land aanvinken', `status ${tick.status}`);
  for (const url of ['/api/me', '/api/dashboard', '/api/timeline', '/api/leaderboard', '/api/people', '/api/family', '/api/settings', '/api/quiz', '/api/quiz/scores', '/api/records', '/api/distances']) {
    const res = await fetch(BASE + url, { headers: { cookie } });
    check(res.status === 200, `GET ${url}`, `status ${res.status}`);
  }
  const anon = await fetch(BASE + '/api/admin/users');
  check(anon.status === 403, 'beheer is dicht zonder inlog', `status ${anon.status}`);
}

async function main() {
  console.log('Landen smoke-test\n');
  filesCheck();
  if (failed) return finish();

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'landen-smoke-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, KEEP_ALIVE: '' };
  delete env.DATABASE_URL; // never the real database
  delete env.FAMILY_CODE;
  delete env.ADMIN_EMAIL;
  const logs = [];
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  try {
    await waitForServer(child, logs);
    check(true, 'server start');
    await httpChecks();
  } catch (e) {
    check(false, 'server start', e.message);
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  finish();
}

function finish() {
  console.log(failed ? `\n✘ ${failed} controle(s) mislukt` : '\n✔ alles in orde');
  process.exit(failed ? 1 : 0);
}

main();
