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
