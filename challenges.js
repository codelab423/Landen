'use strict';

// Monthly family challenge. Every month (Dutch calendar month) has one challenge, rotating
// through the list below. "First" challenges are won by the first family member whose tick
// qualifies; "most" challenges are decided when the month is over. A win is stored in
// challenge_wins, so the bonus XP stays even if the country is removed later.
// Bonus XP is kept apart from travel XP: it never changes levels, badges or the XP ranking.

const L = require('./public/countries.js');

const AMS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
const amsDay = (at) => AMS_DAY.format(at instanceof Date ? at : new Date(String(at).replace(' ', 'T') + 'Z'));
const monthOf = (at) => amsDay(at).slice(0, 7);
const prevMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

const CHALLENGES = [
  { id: 'first_tier3', kind: 'first', bonus: 100, qualifies: (c) => c.tier >= 3 },
  { id: 'most_countries', kind: 'most', bonus: 150, score: (codes) => codes.length },
  { id: 'first_new_continent', kind: 'first', bonus: 100, qualifies: (c, earlier) => !earlier.some((x) => L.BY_CODE[x].continent === c.continent) },
  { id: 'first_outside_europe', kind: 'first', bonus: 75, qualifies: (c) => c.continent !== 'EU' },
  { id: 'most_xp', kind: 'most', bonus: 150, score: (codes) => L.xpFor(codes) },
  { id: 'first_tier4', kind: 'first', bonus: 150, qualifies: (c) => c.tier >= 4 },
];

function challengeFor(month) {
  const [y, m] = month.split('-').map(Number);
  return CHALLENGES[(y * 12 + m - 1) % CHALLENGES.length];
}

// Everyone's visited countries; ticks of one month in the order they happened.
async function visitedRows(db) {
  return (await db.all("SELECT user_id, code, visited_at FROM countries WHERE status = 'visited'"))
    .filter((r) => L.BY_CODE[r.code])
    .map((r) => ({ user: Number(r.user_id), code: r.code, at: r.visited_at || null }));
}
const ticksIn = (rows, month) =>
  rows.filter((r) => r.at && r.code !== L.HOME && monthOf(r.at) === month).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

// The first qualifying tick of a month (or null).
function firstWinner(ch, rows, month) {
  for (const t of ticksIn(rows, month)) {
    // Countries this person had before this tick (older ones without a date count as earlier).
    const earlier = rows.filter((r) => r.user === t.user && r.code !== t.code && (!r.at || r.at < t.at)).map((r) => r.code);
    if (ch.qualifies(L.BY_CODE[t.code], earlier)) return { user: t.user, code: t.code, at: t.at, amount: null };
  }
  return null;
}

// Scores of a "most" challenge for a month, best first (ties: whoever got there first).
function standings(ch, rows, month) {
  const per = new Map();
  ticksIn(rows, month).forEach((t) => {
    if (!per.has(t.user)) per.set(t.user, { user: t.user, codes: [], last: t.at });
    const p = per.get(t.user);
    p.codes.push(t.code);
    p.last = t.at;
  });
  return [...per.values()]
    .map((p) => ({ user: p.user, score: ch.score(p.codes), last: p.last }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score || (a.last < b.last ? -1 : 1));
}

// Store winners that are known: this month's "first" challenge as soon as someone qualifies,
// and last month's challenge (any kind) once it is over. Safe to call often.
async function settle(db, now) {
  const current = monthOf(now || new Date());
  const settled = new Set((await db.all('SELECT month FROM challenge_wins')).map((r) => r.month));
  let rows = null;
  for (const month of [prevMonth(current), current]) {
    if (settled.has(month)) continue;
    const ch = challengeFor(month);
    if (ch.kind === 'most' && month === current) continue; // still running
    rows = rows || (await visitedRows(db));
    let win = null;
    if (ch.kind === 'first') win = firstWinner(ch, rows, month);
    else {
      const top = standings(ch, rows, month)[0];
      if (top) win = { user: top.user, code: null, at: top.last, amount: top.score };
    }
    if (!win) continue;
    await db.run(
      'INSERT INTO challenge_wins (month, user_id, challenge, bonus, code, amount, won_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (month) DO NOTHING',
      [month, win.user, ch.id, ch.bonus, win.code, win.amount, win.at]
    );
  }
}

// Bonus XP per user from challenges: Map(userId -> xp).
async function challengeBonus(db) {
  const out = new Map();
  (await db.all('SELECT user_id, bonus FROM challenge_wins')).forEach((r) => out.set(Number(r.user_id), (out.get(Number(r.user_id)) || 0) + Number(r.bonus)));
  return out;
}

// Everything the dashboard shows: this month's challenge, its winner or standings, last month's winner.
async function status(db, now) {
  const today = amsDay(now || new Date());
  const month = today.slice(0, 7);
  const ch = challengeFor(month);
  const [y, m, d] = today.split('-').map(Number);
  const daysLeft = new Date(Date.UTC(y, m, 0)).getUTCDate() - d; // days after today
  const wins = await db.all('SELECT month, user_id, challenge, bonus, code, amount, won_at FROM challenge_wins ORDER BY month DESC LIMIT 12');
  const toWin = (w) => w && { month: w.month, id: w.challenge, user: Number(w.user_id), bonus: Number(w.bonus), code: w.code || null, amount: w.amount == null ? null : Number(w.amount), at: w.won_at };
  const cur = wins.find((w) => w.month === month);
  const last = wins.find((w) => w.month === prevMonth(month));
  const out = { month, id: ch.id, kind: ch.kind, bonus: ch.bonus, daysLeft, winner: toWin(cur) || null, last: toWin(last) || null };
  if (ch.kind === 'most') out.standings = standings(ch, await visitedRows(db), month).slice(0, 5).map((s) => ({ user: s.user, score: s.score }));
  return out;
}

module.exports = { CHALLENGES, challengeFor, settle, status, challengeBonus, monthOf, prevMonth };
