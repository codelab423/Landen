'use strict';

// Daily country quiz (Worldle style): everyone gets the same country each day (Dutch calendar
// day) and guesses it from its outline. Max 6 guesses; every wrong guess gets the distance,
// the direction to the answer and how close it was. The answer stays on the server until the
// game is over. A correct guess gives a little bonus XP: (7 - guesses) × 10, so 60 down to 10.
// Quiz XP is bonus XP: it is kept apart from travel XP.

const crypto = require('crypto');
const L = require('./public/countries.js');
const geo = require('./geo.js');
const challenges = require('./challenges.js');

const MAX_GUESSES = 6;
const MIN_AREA = 0.03; // square degrees: leaves out dot-sized countries (Vatican, Nauru, …) that can't be recognised
const NEAR_KM = 4000; // outline: only the pieces of land near the main one (France without French Guiana)
const EPOCH = Date.UTC(2026, 9, 16, 12); // quiz #1 (days count from noon)

const AMS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = (now) => AMS_DAY.format(now || new Date());
const dayNumber = (day) => Math.round((Date.parse(day + 'T12:00:00Z') - EPOCH) / 86400000);
const xpForTries = (n) => (MAX_GUESSES + 1 - n) * 10;

// A fixed shuffled order of all recognisable countries: no repeats until the list is done.
let pool = null;
function quizPool() {
  if (pool) return pool;
  const list = [...geo.load().values()].filter((c) => c.area >= MIN_AREA).map((c) => c.code).sort();
  let seed = crypto.createHash('sha256').update('landen-quiz-v1').digest();
  for (let i = list.length - 1; i > 0; i--) {
    if (i % 8 === 0) seed = crypto.createHash('sha256').update(seed).digest();
    const j = seed.readUInt32BE((i % 8) * 4) % (i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  pool = list;
  return pool;
}

function answerFor(day) {
  const p = quizPool();
  const n = dayNumber(day);
  return p[((n % p.length) + p.length) % p.length];
}

// The outline to draw: the main land plus pieces within NEAR_KM, coordinates rounded.
function shapeOf(code) {
  const c = geo.load().get(code);
  const round = (ring) => ring.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
  const polys = c.geometry.coordinates.filter((poly) => {
    const lons = poly[0].map((p) => p[0]);
    const lats = poly[0].map((p) => p[1]);
    const mid = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    return geo.distanceKm(mid, c.centroid) <= NEAR_KM;
  });
  return { type: 'MultiPolygon', coordinates: polys.map((poly) => poly.map(round)) };
}

// Hint for one guess: distance, direction from the guess to the answer, and closeness in %.
function hint(guess, answer) {
  if (guess === answer) return { code: guess, km: 0, bearing: null, pct: 100, correct: true };
  const a = geo.centroid(guess);
  const b = geo.centroid(answer);
  const km = geo.distanceKm(a, b);
  return { code: guess, km: Math.round(km), bearing: Math.round(geo.bearing(a, b)), pct: Math.max(0, Math.round((1 - km / 20037) * 100)), correct: false };
}

async function playOf(db, userId, day) {
  const row = await db.get('SELECT guesses, solved, done, xp FROM quiz_plays WHERE user_id = ? AND day = ?', [userId, day]);
  let guesses = [];
  try {
    guesses = row ? JSON.parse(row.guesses) : [];
  } catch (e) {
    /* broken row: start over */
  }
  return { guesses, solved: !!(row && Number(row.solved)), done: !!(row && Number(row.done)), xp: row ? Number(row.xp) : 0 };
}

function publicState(day, play) {
  const answer = answerFor(day);
  return {
    day,
    number: dayNumber(day) + 1,
    max: MAX_GUESSES,
    shape: shapeOf(answer),
    guesses: play.guesses.map((g) => hint(g, answer)),
    solved: play.solved,
    done: play.done,
    xp: play.xp,
    answer: play.done ? answer : null, // only revealed when the game is over
  };
}

// Quiz XP per user: Map(userId -> xp).
async function quizBonus(db) {
  const out = new Map();
  (await db.all('SELECT user_id, xp FROM quiz_plays WHERE xp > 0')).forEach((r) => out.set(Number(r.user_id), (out.get(Number(r.user_id)) || 0) + Number(r.xp)));
  return out;
}

// All bonus XP (challenges + quiz) per user, kept apart from travel XP.
async function bonusByUser(db) {
  const [a, b] = await Promise.all([challenges.challengeBonus(db), quizBonus(db)]);
  const out = new Map(a);
  b.forEach((xp, id) => out.set(id, (out.get(id) || 0) + xp));
  return out;
}

// Family scoreboard: games, wins, current streak (solved days in a row up to today or
// yesterday), average guesses of the wins, quiz XP.
async function scores(db, now) {
  const users = (await db.all('SELECT id, name, color FROM users ORDER BY id')).map((u) => ({ id: Number(u.id), name: u.name, color: u.color }));
  const rows = await db.all('SELECT user_id, day, guesses, solved, done, xp FROM quiz_plays WHERE done = 1');
  const day = today(now);
  const n0 = dayNumber(day);
  return users
    .map((u) => {
      const mine = rows.filter((r) => Number(r.user_id) === u.id);
      const wins = mine.filter((r) => Number(r.solved));
      const solvedDays = new Set(wins.map((r) => dayNumber(r.day)));
      const failedToday = mine.some((r) => r.day === day && !Number(r.solved));
      let streak = 0;
      if (!failedToday) {
        let d = solvedDays.has(n0) ? n0 : n0 - 1;
        while (solvedDays.has(d)) {
          streak++;
          d--;
        }
      }
      let best = 0;
      let run = 0;
      [...solvedDays].sort((a, b) => a - b).forEach((d, i, arr) => {
        run = i && arr[i - 1] === d - 1 ? run + 1 : 1;
        best = Math.max(best, run);
      });
      const tries = wins.map((r) => {
        try {
          return JSON.parse(r.guesses).length;
        } catch (e) {
          return MAX_GUESSES;
        }
      });
      return {
        ...u,
        played: mine.length,
        won: wins.length,
        streak,
        bestStreak: best,
        avgGuesses: tries.length ? Math.round((tries.reduce((s, x) => s + x, 0) / tries.length) * 10) / 10 : null,
        xp: mine.reduce((s, r) => s + Number(r.xp), 0),
        today: mine.some((r) => r.day === day),
      };
    })
    .sort((a, b) => b.streak - a.streak || b.won - a.won || (a.avgGuesses || 9) - (b.avgGuesses || 9));
}

function register(app, { getDb, h, requireUser, bad, now }) {
  app.get(
    '/api/quiz',
    requireUser,
    h(async (req, res) => {
      const day = today();
      res.json(publicState(day, await playOf(getDb(), req.user.id, day)));
    })
  );

  app.post(
    '/api/quiz/guess',
    requireUser,
    h(async (req, res) => {
      const db = getDb();
      const day = today();
      const code = String((req.body && req.body.code) || '').toUpperCase();
      if (!L.BY_CODE[code]) return bad(res, 400, 'unknown_country');
      const play = await playOf(db, req.user.id, day);
      if (play.done) return bad(res, 409, 'quiz_done');
      if (play.guesses.includes(code)) return bad(res, 400, 'already_guessed');
      play.guesses.push(code);
      play.solved = code === answerFor(day);
      play.done = play.solved || play.guesses.length >= MAX_GUESSES;
      play.xp = play.solved ? xpForTries(play.guesses.length) : 0;
      await db.run(
        `INSERT INTO quiz_plays (user_id, day, guesses, solved, done, xp, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET guesses = excluded.guesses, solved = excluded.solved, done = excluded.done,
           xp = excluded.xp, updated_at = excluded.updated_at`,
        [req.user.id, day, JSON.stringify(play.guesses), play.solved ? 1 : 0, play.done ? 1 : 0, play.xp, now()]
      );
      res.json(publicState(day, play));
    })
  );

  app.get(
    '/api/quiz/scores',
    requireUser,
    h(async (req, res) => res.json({ scores: await scores(getDb()) }))
  );
}

module.exports = { register, answerFor, quizPool, hint, shapeOf, scores, bonusByUser, xpForTries, MAX_GUESSES };
