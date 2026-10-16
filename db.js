'use strict';

// Tiny database layer with the same async API for two backends:
//  - DATABASE_URL set → PostgreSQL (e.g. a free Neon database, for hosting)
//  - otherwise        → a local SQLite file in DATA_DIR (for running at home / with a volume)
// Queries use `?` placeholders; they are converted to $1, $2… for Postgres.

const path = require('path');
const fs = require('fs');

const SCHEMA_SQLITE = `
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
    created_at TEXT NOT NULL
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
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, code)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    country TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS idea_votes (
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (idea_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    countries TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );  CREATE TABLE IF NOT EXISTS challenge_wins (
    month TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    bonus INTEGER NOT NULL,
    code TEXT,
    amount INTEGER,
    won_at TEXT NOT NULL
  );  CREATE TABLE IF NOT EXISTS quiz_plays (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    guesses TEXT NOT NULL DEFAULT '[]',
    solved INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
`;

const SCHEMA_PG = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL,
    lang TEXT NOT NULL DEFAULT 'nl',
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS countries (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('visited', 'wish')),
    year INTEGER,
    note TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, code)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ideas (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    country TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS idea_votes (
    idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (idea_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    countries TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );  CREATE TABLE IF NOT EXISTS challenge_wins (
    month TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    challenge TEXT NOT NULL,
    bonus INTEGER NOT NULL,
    code TEXT,
    amount INTEGER,
    won_at TEXT NOT NULL
  );  CREATE TABLE IF NOT EXISTS quiz_plays (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    guesses TEXT NOT NULL DEFAULT '[]',
    solved INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    xp INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, day)
  );
`;

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

async function open({ databaseUrl, dataDir }) {
  if (databaseUrl) {
    const { Pool } = require('pg');
    // Neon's connection strings include `sslmode=require&channel_binding=require`.
    // Use full certificate checks (pg's current meaning of "require", minus the warning)
    // and pass channel binding as an option instead of a URL parameter.
    const url = new URL(databaseUrl);
    const channelBinding = url.searchParams.get('channel_binding') === 'require';
    url.searchParams.delete('channel_binding');
    if (url.searchParams.get('sslmode') === 'require') url.searchParams.set('sslmode', 'verify-full');
    const pool = new Pool({ connectionString: url.toString(), enableChannelBinding: channelBinding, max: 5 });
    // Neon closes idle connections when it scales to zero; without this the process would crash.
    pool.on('error', (err) => console.warn('Postgres idle connection closed:', err.message));
    await pool.query(SCHEMA_PG);
    // Migrations (safe to run on every start).
    await pool.query('ALTER TABLE countries ADD COLUMN IF NOT EXISTS visited_at TEXT');
    return {
      kind: 'postgres',
      all: async (sql, params = []) => (await pool.query(toPg(sql), params)).rows,
      get: async (sql, params = []) => (await pool.query(toPg(sql), params)).rows[0],
      run: async (sql, params = []) => {
        await pool.query(toPg(sql), params);
      },
    };
  }

  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'landen.db'));
  db.exec(SCHEMA_SQLITE);
  // Migrations (safe to run on every start).
  if (!db.prepare('PRAGMA table_info(countries)').all().some((c) => c.name === 'visited_at')) {
    db.exec('ALTER TABLE countries ADD COLUMN visited_at TEXT');
  }
  return {
    kind: 'sqlite',
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    get: async (sql, params = []) => db.prepare(sql).get(...params),
    run: async (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
  };
}

module.exports = { open };
