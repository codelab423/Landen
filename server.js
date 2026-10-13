'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const L = require('./public/countries.js');
const database = require('./db.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATABASE_URL = process.env.DATABASE_URL || '';
const FAMILY_CODE = process.env.FAMILY_CODE || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_DAYS = 60;
const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#0ea5e9', '#a855f7'];
const OLD_DEFAULT_RED = '#e11d48';

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

async function countriesOf(userId) {
  const rows = await db.all('SELECT code, status, year, note, updated_at FROM countries WHERE user_id = ? ORDER BY updated_at DESC, code', [userId]);
  return rows.map((r) => ({ code: r.code, status: r.status, year: r.year, note: r.note, updatedAt: r.updated_at }));
}

function statsOf(rows) {
  const visited = rows.filter((r) => r.status === 'visited').map((r) => r.code);
  const xp = L.xpFor(visited);
  return {
    visited: visited.length,
    wish: rows.filter((r) => r.status === 'wish').length,
    xp,
    level: L.levelFor(xp).index,
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

// Very small brute-force guard for login/register.
const attempts = new Map();
function rateLimited(key) {
  const t = Date.now();
  const list = (attempts.get(key) || []).filter((x) => t - x < 15 * 60 * 1000);
  list.push(t);
  attempts.set(key, list);
  return list.length > 20;
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
const requireAdmin = (req, res, next) => (req.user && req.user.is_admin ? next() : bad(res, 403, 'forbidden'));

app.get(
  '/api/config',
  h(async (req, res) => {
    res.json({ needsFamilyCode: !!FAMILY_CODE, firstUser: (await userCount()) === 0 });
  })
);

app.post(
  '/api/register',
  h(async (req, res) => {
    if (rateLimited('reg:' + req.ip)) return bad(res, 429, 'too_many_attempts');
    const { email, password, name, familyCode, lang } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (!isEmail(mail)) return bad(res, 400, 'invalid_email');
    if (typeof password !== 'string' || password.length < 8) return bad(res, 400, 'password_too_short');
    if (!cleanName(name)) return bad(res, 400, 'name_required');
    if (FAMILY_CODE && familyCode !== FAMILY_CODE) return bad(res, 403, 'wrong_family_code');
    if (await db.get('SELECT 1 AS x FROM users WHERE email = ?', [mail])) return bad(res, 409, 'email_taken');

    const count = await userCount();
    const isAdmin = count === 0 || (ADMIN_EMAIL && mail === ADMIN_EMAIL) ? 1 : 0;
    const color = COLORS[count % COLORS.length];
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
    if (rateLimited('login:' + req.ip)) return bad(res, 429, 'too_many_attempts');
    const { email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    const user = await db.get('SELECT * FROM users WHERE email = ?', [mail]);
    if (!user || typeof password !== 'string' || !checkPassword(password, user.password_hash)) {
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
      `INSERT INTO countries (user_id, code, status, year, note, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, code) DO UPDATE SET status = excluded.status, year = excluded.year, note = excluded.note, updated_at = excluded.updated_at`,
      [req.user.id, code, status, y, n || null, now()]
    );
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

// Everyone in the family sees the scoreboard (names, colours, totals) — not each other's maps.
app.get(
  '/api/leaderboard',
  requireUser,
  h(async (req, res) => {
    const users = await db.all('SELECT id, name, color FROM users ORDER BY id');
    const board = [];
    for (const u of users) board.push({ id: u.id, name: u.name, color: u.color, ...statsOf(await countriesOf(u.id)) });
    board.sort((a, b) => b.xp - a.xp || b.visited - a.visited);
    res.json({ board });
  })
);

// ---------- host / admin ----------

app.get(
  '/api/admin/users',
  requireAdmin,
  h(async (req, res) => {
    const users = await db.all('SELECT * FROM users ORDER BY id');
    const out = [];
    for (const u of users) {
      const rows = await countriesOf(u.id);
      out.push({ ...publicUser(u), createdAt: u.created_at, ...statsOf(rows), countries: rows });
    }
    res.json({ users: out });
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

app.get('/healthz', (req, res) => res.send('ok'));

// ---------- static ----------

const mod = (...p) => path.join(__dirname, 'node_modules', ...p);
const vendor = {
  '/vendor/d3.min.js': mod('d3', 'dist', 'd3.min.js'),
  '/vendor/topojson-client.min.js': mod('topojson-client', 'dist', 'topojson-client.min.js'),
  '/data/world.json': mod('world-atlas', 'countries-10m.json'),
};
Object.entries(vendor).forEach(([url, file]) => {
  app.get(url, (req, res) => res.sendFile(file, { maxAge: '30d' }));
});
app.use('/flags', express.static(mod('flag-icons', 'flags', '4x3'), { maxAge: '30d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

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
  // Clean expired sessions once in a while.
  setInterval(() => db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]).catch(() => {}), 3600 * 1000).unref();
  app.listen(PORT, () => {
    console.log(`Landen draait op http://localhost:${PORT} (database: ${db.kind})`);
    if (!FAMILY_CODE) console.log('Let op: geen FAMILY_CODE ingesteld — iedereen met de link kan een account maken.');
  });
}

start().catch((err) => {
  console.error('Kon niet starten:', err);
  process.exit(1);
});
