'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const compression = require('compression');
const { DatabaseSync } = require('node:sqlite');
const L = require('./public/countries.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FAMILY_CODE = process.env.FAMILY_CODE || '';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const SESSION_DAYS = 60;
const COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5'];

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'landen.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'nl',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS countries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('visited', 'wish')),
    year INTEGER,
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, code)
  );
`);

// ---------- helpers ----------

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

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 86400 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  setSessionCookie(req, res, token, SESSION_DAYS * 86400);
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, color: u.color, lang: u.lang, isAdmin: !!u.is_admin };
}

function countriesOf(userId) {
  return db.prepare('SELECT code, status, year, note, updated_at AS updatedAt FROM countries WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
}

function statsOf(rows) {
  const visited = rows.filter((r) => r.status === 'visited').map((r) => r.code);
  const xp = L.xpFor(visited);
  const lvl = L.levelFor(xp);
  return {
    visited: visited.length,
    wish: rows.filter((r) => r.status === 'wish').length,
    xp,
    level: lvl.index,
  };
}

function bad(res, status, error) {
  res.status(status).json({ error });
}

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 200;
const isColor = (s) => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
const cleanName = (s) => (typeof s === 'string' ? s.trim().slice(0, 40) : '');

// Very small brute-force guard for login/register.
const attempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  list.push(now);
  attempts.set(key, list);
  return list.length > 20;
}

// ---------- app ----------

const app = express();
app.set('trust proxy', 1);
app.use(compression());
app.use(express.json({ limit: '50kb' }));

app.use((req, res, next) => {
  const token = parseCookies(req.headers.cookie).sid;
  if (token) {
    const row = db
      .prepare('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
      .get(token);
    if (row && row.expires_at > Date.now()) {
      req.user = row;
      req.sessionToken = token;
    }
  }
  next();
});

const requireUser = (req, res, next) => (req.user ? next() : bad(res, 401, 'not_logged_in'));
const requireAdmin = (req, res, next) => (req.user && req.user.is_admin ? next() : bad(res, 403, 'forbidden'));

app.get('/api/config', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  res.json({ needsFamilyCode: !!FAMILY_CODE, firstUser: userCount === 0 });
});

app.post('/api/register', (req, res) => {
  if (rateLimited('reg:' + req.ip)) return bad(res, 429, 'too_many_attempts');
  const { email, password, name, familyCode, lang } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  if (!isEmail(mail)) return bad(res, 400, 'invalid_email');
  if (typeof password !== 'string' || password.length < 8) return bad(res, 400, 'password_too_short');
  if (!cleanName(name)) return bad(res, 400, 'name_required');
  if (FAMILY_CODE && familyCode !== FAMILY_CODE) return bad(res, 403, 'wrong_family_code');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(mail)) return bad(res, 409, 'email_taken');

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const isAdmin = count === 0 || (ADMIN_EMAIL && mail === ADMIN_EMAIL) ? 1 : 0;
  const color = COLORS[count % COLORS.length];
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash, color, lang, is_admin) VALUES (?, ?, ?, ?, ?, ?)')
    .run(mail, cleanName(name), hashPassword(password), color, lang === 'en' ? 'en' : 'nl', isAdmin);
  createSession(req, res, Number(info.lastInsertRowid));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
});

app.post('/api/login', (req, res) => {
  if (rateLimited('login:' + req.ip)) return bad(res, 429, 'too_many_attempts');
  const { email, password } = req.body || {};
  const mail = String(email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(mail);
  if (!user || typeof password !== 'string' || !checkPassword(password, user.password_hash)) {
    return bad(res, 401, 'wrong_credentials');
  }
  createSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  if (req.sessionToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.sessionToken);
  setSessionCookie(req, res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user), countries: countriesOf(req.user.id) });
});

app.patch('/api/me', requireUser, (req, res) => {
  const { name, color, lang, currentPassword, newPassword } = req.body || {};
  const u = req.user;
  if (name !== undefined) {
    if (!cleanName(name)) return bad(res, 400, 'name_required');
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(cleanName(name), u.id);
  }
  if (color !== undefined) {
    if (!isColor(color)) return bad(res, 400, 'invalid_color');
    db.prepare('UPDATE users SET color = ? WHERE id = ?').run(color, u.id);
  }
  if (lang !== undefined) {
    db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(lang === 'en' ? 'en' : 'nl', u.id);
  }
  if (newPassword !== undefined) {
    if (typeof currentPassword !== 'string' || !checkPassword(currentPassword, u.password_hash)) {
      return bad(res, 401, 'wrong_password');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) return bad(res, 400, 'password_too_short');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(u.id, req.sessionToken);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)) });
});

app.put('/api/me/countries/:code', requireUser, (req, res) => {
  const code = String(req.params.code).toUpperCase();
  if (!L.BY_CODE[code]) return bad(res, 404, 'unknown_country');
  const { status, year, note } = req.body || {};
  if (status !== 'visited' && status !== 'wish') return bad(res, 400, 'invalid_status');
  const y = year === null || year === undefined || year === '' ? null : Number(year);
  if (y !== null && !(Number.isInteger(y) && y >= 1900 && y <= 2100)) return bad(res, 400, 'invalid_year');
  const n = typeof note === 'string' ? note.trim().slice(0, 500) : null;
  db.prepare(
    `INSERT INTO countries (user_id, code, status, year, note, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (user_id, code) DO UPDATE SET status = excluded.status, year = excluded.year, note = excluded.note, updated_at = excluded.updated_at`
  ).run(req.user.id, code, status, y, n || null);
  res.json({ countries: countriesOf(req.user.id) });
});

app.delete('/api/me/countries/:code', requireUser, (req, res) => {
  db.prepare('DELETE FROM countries WHERE user_id = ? AND code = ?').run(req.user.id, String(req.params.code).toUpperCase());
  res.json({ countries: countriesOf(req.user.id) });
});

// Everyone in the family sees the scoreboard (names, colours, totals) — not each other's maps.
app.get('/api/leaderboard', requireUser, (req, res) => {
  const users = db.prepare('SELECT id, name, color FROM users ORDER BY id').all();
  const board = users
    .map((u) => ({ id: u.id, name: u.name, color: u.color, ...statsOf(countriesOf(u.id)) }))
    .sort((a, b) => b.xp - a.xp || b.visited - a.visited);
  res.json({ board });
});

// ---------- host / admin ----------

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  res.json({
    users: users.map((u) => {
      const rows = countriesOf(u.id);
      return { ...publicUser(u), createdAt: u.created_at, ...statsOf(rows), countries: rows };
    }),
  });
});

app.post('/api/admin/users/:id/reset-password', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return bad(res, 404, 'not_found');
  const temp = crypto.randomBytes(6).toString('base64url');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(temp), id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ password: temp });
});

app.post('/api/admin/users/:id/admin', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 400, 'cannot_change_self');
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body && req.body.isAdmin ? 1 : 0, id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 400, 'cannot_change_self');
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

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

// Clean expired sessions once in a while.
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Landen draait op http://localhost:${PORT}`);
  if (!FAMILY_CODE) console.log('Let op: geen FAMILY_CODE ingesteld — iedereen met de link kan een account maken.');
});
