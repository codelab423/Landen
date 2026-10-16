'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const L = require('./public/countries.js');
const fs = require('fs');
const database = require('./db.js');

// Files the app cannot run without. If one is missing (e.g. not committed because of
// .gitignore), stop right away with a clear message instead of a half-working site.
const REQUIRED_FILES = [
  'public/index.html',
  'public/app.js',
  'public/i18n.js',
  'public/countries.js',
  'public/climate.js',
  'public/style.css',
  'public/sw.js',
  'public/data/world.json',
  'node_modules/d3/dist/d3.min.js',
  'node_modules/topojson-client/dist/topojson-client.min.js',
  'node_modules/flag-icons/flags/4x3/nl.svg',
];
const missing = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(__dirname, f)));
if (missing.length) {
  console.error('FOUT: Landen kan niet starten, deze bestanden ontbreken:\n' + missing.map((f) => '  - ' + f).join('\n'));
  console.error('Staan ze in git? Kijk of .gitignore ze uitsluit (git check-ignore -v <bestand>), of draai npm ci.');
  process.exit(1);
}

const hashFiles = (files) => {
  const hash = crypto.createHash('sha1');
  files.forEach((f) => hash.update(fs.readFileSync(f)));
  return hash.digest('hex').slice(0, 10);
};
// One id for the whole front end; changes whenever any app file changes.
const BUILD = hashFiles(REQUIRED_FILES.filter((f) => f.startsWith('public/')).map((f) => path.join(__dirname, f)));

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATABASE_URL = process.env.DATABASE_URL || '';
const FAMILY_CODE = process.env.FAMILY_CODE || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_DAYS = 60;
const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#0ea5e9', '#a855f7'];
const OLD_DEFAULT_RED = '#e11d48';

// Every family member gets their own colour: palette first, then evenly spread extra hues.
function freeColor(taken) {
  const used = new Set(taken.map((c) => String(c).toLowerCase()));
  const fromPalette = COLORS.find((c) => !used.has(c));
  if (fromPalette) return fromPalette;
  for (let i = 0; i < 360; i++) {
    const hue = Math.round((i * 137.508) % 360);
    const c = hslToHex(hue, 65, 45);
    if (!used.has(c)) return c;
  }
  return '#64748b';
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Older accounts could share a colour; give every later duplicate a free one.
async function dedupeColors() {
  const users = await db.all('SELECT id, color FROM users ORDER BY id');
  const kept = [];
  for (const u of users) {
    if (kept.includes(String(u.color).toLowerCase())) {
      const c = freeColor([...kept, ...users.map((x) => x.color)]);
      await db.run('UPDATE users SET color = ? WHERE id = ?', [c, u.id]);
      kept.push(c);
    } else kept.push(String(u.color).toLowerCase());
  }
}

let db; // set in start()

// ---------- helpers ----------

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const parts = [`sid=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expires]);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, color: u.color, lang: u.lang, isAdmin: !!u.is_admin };
}

// The home country is always visited (insert, or upgrade a wishlist entry).
const HOME_UPSERT = `INSERT INTO countries (user_id, code, status, year, note, updated_at)
  SELECT id, ?, 'visited', NULL, NULL, ? FROM users WHERE id = ? OR ? = 1
  ON CONFLICT (user_id, code) DO UPDATE SET status = 'visited'`;
const markHomeVisited = (userId) => db.run(HOME_UPSERT, [L.HOME, now(), userId, 0]);
const markHomeVisitedForEveryone = () => db.run(HOME_UPSERT, [L.HOME, now(), 0, 1]);

const getUser = (id) => db.get('SELECT * FROM users WHERE id = ?', [id]);
const userCount = async () => Number((await db.get('SELECT COUNT(*) AS n FROM users')).n);

const toRow = (r) => ({ code: r.code, status: r.status, year: r.year, note: r.note, updatedAt: r.updated_at, visitedAt: r.visited_at || null });

async function countriesOf(userId) {
  const rows = await db.all('SELECT code, status, year, note, updated_at, visited_at FROM countries WHERE user_id = ? ORDER BY updated_at DESC, code', [userId]);
  return rows.map(toRow);
}

// Everyone's countries in one query (the database may be far away, so avoid one query per person).
async function countriesByUser() {
  const rows = await db.all('SELECT user_id, code, status, year, note, updated_at, visited_at FROM countries ORDER BY updated_at DESC, code');
  const byUser = new Map();
  rows.forEach((r) => {
    const id = Number(r.user_id);
    if (!byUser.has(id)) byUser.set(id, []);
    byUser.get(id).push(toRow(r));
  });
  return byUser;
}

function statsOf(rows) {
  const visited = rows.filter((r) => r.status === 'visited').map((r) => r.code);
  const wish = rows.filter((r) => r.status === 'wish').length;
  const xp = L.xpFor(visited);
  return {
    visited: visited.length,
    wish,
    xp,
    level: L.levelFor(xp).index,
    badges: L.badgesFor(visited, wish).filter((b) => b.done).length,
  };
}

function bad(res, status, error) {
  res.status(status).json({ error });
}

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
const isColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const cleanName = (s) => (typeof s === 'string' ? s.trim().slice(0, 40) : '');

// Express 4 does not catch rejected promises; route them to the error handler.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Small brute-force guard: only *failed* attempts count. Logins are keyed per email
// address, because a whole family at home shares one IP address.
const FAIL_WINDOW = 15 * 60 * 1000;
const failures = new Map();
function recentFailures(key) {
  const t = Date.now();
  const list = (failures.get(key) || []).filter((x) => t - x < FAIL_WINDOW);
  if (list.length) failures.set(key, list);
  else failures.delete(key);
  return list.length;
}
function recordFailure(key) {
  failures.set(key, [...(failures.get(key) || []), Date.now()]);
}

// ---------- app ----------

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '50kb' }));

app.use(
  h(async (req, res, next) => {
    const token = parseCookies(req.headers.cookie).sid;
    if (token) {
      const row = await db.get('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', [token]);
      if (row && Number(row.expires_at) > Date.now()) {
        req.user = row;
        req.sessionToken = token;
      }
    }
    next();
  })
);

const requireUser = (req, res, next) => (req.user ? next() : bad(res, 401, 'not_logged_in'));
// The host check reads is_admin from the database on every request, so a demoted host loses access at once.
const requireAdmin = (req, res, next) => (req.user && req.user.is_admin ? next() : bad(res, 403, 'forbidden'));

// Safety net: everything under /api/admin is host-only, including routes added later
// (registered by family.js) even if someone forgets requireAdmin on them.
app.use('/api/admin', requireAdmin);

app.get(
  '/api/config',
  h(async (req, res) => {
    res.json({ needsFamilyCode: !!FAMILY_CODE, firstUser: (await userCount()) === 0, mapVersion: MAP_VERSION, build: BUILD });
  })
);

app.post(
  '/api/register',
  h(async (req, res) => {
    if (recentFailures('code:' + req.ip) >= 30) return bad(res, 429, 'too_many_attempts');
    const { email, password, name, familyCode, lang } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (!isEmail(mail)) return bad(res, 400, 'invalid_email');
    if (typeof password !== 'string' || password.length < 8) return bad(res, 400, 'password_too_short');
    if (!cleanName(name)) return bad(res, 400, 'name_required');
    if (FAMILY_CODE && familyCode !== FAMILY_CODE) {
      recordFailure('code:' + req.ip);
      return bad(res, 403, 'wrong_family_code');
    }
    if (await db.get('SELECT 1 AS x FROM users WHERE email = ?', [mail])) return bad(res, 409, 'email_taken');

    const count = await userCount();
    const isAdmin = count === 0 || (ADMIN_EMAIL && mail === ADMIN_EMAIL) ? 1 : 0;
    const color = freeColor((await db.all('SELECT color FROM users')).map((r) => r.color));
    const row = await db.get(
      'INSERT INTO users (email, name, password_hash, color, lang, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
      [mail, cleanName(name), hashPassword(password), color, lang === 'en' ? 'en' : 'nl', isAdmin, now()]
    );
    await markHomeVisited(row.id);
    await createSession(req, res, row.id);
    res.json({ user: publicUser(await getUser(row.id)) });
  })
);

app.post(
  '/api/login',
  h(async (req, res) => {
    const { email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (recentFailures('login:' + mail) >= 10) return bad(res, 429, 'too_many_attempts');
    const user = await db.get('SELECT * FROM users WHERE email = ?', [mail]);
    if (!user || typeof password !== 'string' || !checkPassword(password, user.password_hash)) {
      recordFailure('login:' + mail);
      return bad(res, 401, 'wrong_credentials');
    }
    await createSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  })
);

app.post(
  '/api/logout',
  h(async (req, res) => {
    if (req.sessionToken) await db.run('DELETE FROM sessions WHERE token = ?', [req.sessionToken]);
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  })
);

app.get(
  '/api/me',
  requireUser,
  h(async (req, res) => {
    res.json({ user: publicUser(req.user), countries: await countriesOf(req.user.id) });
  })
);

app.patch(
  '/api/me',
  requireUser,
  h(async (req, res) => {
    const { name, color, lang, currentPassword, newPassword } = req.body || {};
    const u = req.user;
    if (name !== undefined && !cleanName(name)) return bad(res, 400, 'name_required');
    if (color !== undefined && !isColor(color)) return bad(res, 400, 'invalid_color');
    if (color !== undefined && (await db.get('SELECT 1 AS x FROM users WHERE LOWER(color) = ? AND id != ?', [color.toLowerCase(), u.id]))) {
      return bad(res, 409, 'color_taken');
    }
    if (newPassword !== undefined) {
      if (typeof currentPassword !== 'string' || !checkPassword(currentPassword, u.password_hash)) {
        return bad(res, 401, 'wrong_password');
      }
      if (typeof newPassword !== 'string' || newPassword.length < 8) return bad(res, 400, 'password_too_short');
    }
    if (name !== undefined) await db.run('UPDATE users SET name = ? WHERE id = ?', [cleanName(name), u.id]);
    if (color !== undefined) await db.run('UPDATE users SET color = ? WHERE id = ?', [color, u.id]);
    if (lang !== undefined) await db.run('UPDATE users SET lang = ? WHERE id = ?', [lang === 'en' ? 'en' : 'nl', u.id]);
    if (newPassword !== undefined) {
      await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), u.id]);
      await db.run('DELETE FROM sessions WHERE user_id = ? AND token != ?', [u.id, req.sessionToken]);
    }
    res.json({ user: publicUser(await getUser(u.id)) });
  })
);

app.put(
  '/api/me/countries/:code',
  requireUser,
  h(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (!L.BY_CODE[code]) return bad(res, 404, 'unknown_country');
    const { status, year, note } = req.body || {};
    if (status !== 'visited' && status !== 'wish') return bad(res, 400, 'invalid_status');
    if (code === L.HOME && status !== 'visited') return bad(res, 400, 'home_country');
    const y = year === null || year === undefined || year === '' ? null : Number(year);
    if (y !== null && !(Number.isInteger(y) && y >= 1900 && y <= 2100)) return bad(res, 400, 'invalid_year');
    const n = typeof note === 'string' ? note.trim().slice(0, 500) : null;
    await db.run(
      // visited_at = the moment a country was ticked as visited. Editing the note or year keeps it;
      // moving it back to the wishlist clears it.
      `INSERT INTO countries (user_id, code, status, year, note, updated_at, visited_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, code) DO UPDATE SET status = excluded.status, year = excluded.year, note = excluded.note,
         updated_at = excluded.updated_at,
         visited_at = CASE WHEN excluded.status <> 'visited' THEN NULL
                           WHEN countries.status = 'visited' THEN countries.visited_at
                           ELSE excluded.visited_at END`,
      [req.user.id, code, status, y, n || null, now(), status === 'visited' ? now() : null]
    );
    res.json({ countries: await countriesOf(req.user.id) });
  })
);

// Only the travel year of one of your own visited countries (Timeline quick fill).
app.patch(
  '/api/me/countries/:code/year',
  requireUser,
  h(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const { year } = req.body || {};
    const y = year === null || year === '' || year === undefined ? null : Number(year);
    if (y !== null && !(Number.isInteger(y) && y >= 1900 && y <= new Date().getFullYear())) return bad(res, 400, 'invalid_year');
    const row = await db.get("SELECT 1 AS x FROM countries WHERE user_id = ? AND code = ? AND status = 'visited'", [req.user.id, code]);
    if (!row) return bad(res, 404, 'not_found');
    // updated_at stays: older countries without visited_at would otherwise jump to the top of 'latest trips'.
    await db.run('UPDATE countries SET year = ? WHERE user_id = ? AND code = ?', [y, req.user.id, code]);
    res.json({ countries: await countriesOf(req.user.id) });
  })
);

app.delete(
  '/api/me/countries/:code',
  requireUser,
  h(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    if (code === L.HOME) return bad(res, 400, 'home_country');
    await db.run('DELETE FROM countries WHERE user_id = ? AND code = ?', [req.user.id, code]);
    res.json({ countries: await countriesOf(req.user.id) });
  })
);

// Names and colours of the whole family (never e-mail addresses), for avatars.
app.get(
  '/api/people',
  requireUser,
  h(async (req, res) => {
    res.json({ people: (await db.all('SELECT id, name, color FROM users ORDER BY id')).map((u) => ({ id: Number(u.id), name: u.name, color: u.color })) });
  })
);

// Everyone in the family sees the scoreboard (names, colours, totals) — not each other's maps.
app.get(
  '/api/leaderboard',
  requireUser,
  h(async (req, res) => {
    const users = await db.all('SELECT id, name, color FROM users ORDER BY id');
    const byUser = await countriesByUser();
    const board = users.map((u) => ({ id: u.id, name: u.name, color: u.color, ...statsOf(byUser.get(u.id) || []) }));
    board.sort((a, b) => b.xp - a.xp || b.visited - a.visited);
    res.json({ board });
  })
);

// Family map: how many family members visited each country. Only the host also sees who.
app.get(
  '/api/family',
  requireUser,
  h(async (req, res) => {
    const users = await db.all('SELECT id, name, color FROM users ORDER BY id');
    const rows = await db.all("SELECT user_id, code FROM countries WHERE status = 'visited'");
    const counts = {};
    const who = {};
    rows.forEach((r) => {
      counts[r.code] = (counts[r.code] || 0) + 1;
      (who[r.code] = who[r.code] || []).push(Number(r.user_id));
    });
    const out = { members: users.length, counts };
    if (req.user.is_admin) Object.assign(out, { who, users: users.map((u) => ({ id: u.id, name: u.name, color: u.color })) });
    res.json(out);
  })
);

// ---------- host / admin ----------

app.get(
  '/api/admin/users',
  requireAdmin,
  h(async (req, res) => {
    const users = await db.all('SELECT * FROM users ORDER BY id');
    const byUser = await countriesByUser();
    res.json({
      users: users.map((u) => {
        const rows = byUser.get(u.id) || [];
        return { ...publicUser(u), createdAt: u.created_at, ...statsOf(rows), countries: rows };
      }),
    });
  })
);

app.post(
  '/api/admin/users/:id/reset-password',
  requireAdmin,
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await getUser(id))) return bad(res, 404, 'not_found');
    const temp = crypto.randomBytes(6).toString('base64url');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(temp), id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [id]);
    res.json({ password: temp });
  })
);

app.post(
  '/api/admin/users/:id/admin',
  requireAdmin,
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return bad(res, 400, 'cannot_change_self');
    await db.run('UPDATE users SET is_admin = ? WHERE id = ?', [req.body && req.body.isAdmin ? 1 : 0, id]);
    res.json({ ok: true });
  })
);

app.delete(
  '/api/admin/users/:id',
  requireAdmin,
  h(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) return bad(res, 400, 'cannot_change_self');
    await db.run('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  })
);

// Dashboard, ideas, plans and the family AI.
const family = require('./family.js').register(app, { getDb: () => db, h, requireUser, requireAdmin, bad, now });
require('./ai.js').register(app, { h, requireUser, bad, family });

app.get('/healthz', (req, res) => res.send('ok'));

// Unknown API paths are a JSON 404, not the HTML page.
app.use('/api', (req, res) => bad(res, 404, 'not_found'));

// ---------- static ----------

const mod = (...p) => path.join(__dirname, 'node_modules', ...p);
const vendor = {
  '/vendor/d3.min.js': mod('d3', 'dist', 'd3.min.js'),
  '/vendor/topojson-client.min.js': mod('topojson-client', 'dist', 'topojson-client.min.js'),
};
// The simplified world map (scripts/build-map.js). Its URL carries a content hash,
// so browsers may keep it for a year and only fetch it again when the map changes.
const MAP_FILE = path.join(__dirname, 'public', 'data', 'world.json');
const MAP_VERSION = hashFiles([MAP_FILE]);
app.get('/data/world.json', (req, res) => {
  res.set('Cache-Control', req.query.v === MAP_VERSION ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.sendFile(MAP_FILE);
});

Object.entries(vendor).forEach(([url, file]) => {
  app.get(url, (req, res) => res.sendFile(file, { maxAge: '30d' }));
});
app.use('/flags', express.static(mod('flag-icons', 'flags', '4x3'), { maxAge: '30d' }));
// index.html carries the build id: script and style URLs get ?v=<build>, so a page the
// service worker kept from an older deploy never mixes old and new files, and the app
// reloads itself when /api/config reports a newer build.
const INDEX_HTML = fs
  .readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace('__BUILD__', BUILD)
  .replace(/(href|src)="\/([\w.-]+\.(?:css|js))"/g, `$1="/$2?v=${BUILD}"`);
const sendIndex = (req, res) => res.set('Cache-Control', 'no-cache').type('html').send(INDEX_HTML);
app.get(['/', '/index.html'], sendIndex);
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('*', sendIndex);

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  bad(res, 500, 'generic');
});

async function start() {
  db = await database.open({ databaseUrl: DATABASE_URL, dataDir: DATA_DIR });
  await markHomeVisitedForEveryone();
  // Red was the first auto-assigned colour and nobody liked it; move those accounts to the new default.
  await db.run('UPDATE users SET color = ? WHERE color = ?', [COLORS[0], OLD_DEFAULT_RED]);
  await dedupeColors();
  // Clean expired sessions once in a while.
  setInterval(() => db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]).catch(() => {}), 3600 * 1000).unref();
  // Optional: KEEP_ALIVE=1 pings the public URL every 10 minutes so Render's free plan
  // doesn't put the site to sleep (one service running 24/7 fits in the free 750 hours).
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (process.env.KEEP_ALIVE === '1' && selfUrl) {
    setInterval(() => fetch(selfUrl + '/healthz').catch(() => {}), 10 * 60 * 1000).unref();
    console.log('Keep-alive: aan');
  }

  app.listen(PORT, () => {
    console.log(`Landen draait op http://localhost:${PORT} (database: ${db.kind})`);
    console.log(`Familie-AI: ${process.env.ANTHROPIC_API_KEY ? 'aan' : 'uit (geen ANTHROPIC_API_KEY)'}`);
    if (!FAMILY_CODE) console.log('Let op: geen FAMILY_CODE ingesteld — iedereen met de link kan een account maken.');
  });
}

start().catch((err) => {
  console.error('Kon niet starten:', err);
  process.exit(1);
});
