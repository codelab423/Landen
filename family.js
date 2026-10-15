'use strict';

// Family-wide features: dashboard, ideas board, plans and host settings.

const L = require('./public/countries.js');

const WIDGETS = ['stats', 'never', 'wanted', 'everyone', 'popular', 'unique', 'ask', 'rarest', 'continents', 'recent'];

// Settings live in a key/value table as JSON.
async function getSettings(db) {
  const rows = await db.all('SELECT key, value FROM settings');
  const s = { hiddenWidgets: [], aiEnabled: true };
  rows.forEach((r) => {
    try {
      s[r.key] = JSON.parse(r.value);
    } catch (e) {
      /* ignore broken values */
    }
  });
  return s;
}

async function setSetting(db, key, value) {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]
  );
}

// Everything the dashboard and the AI need, computed from the raw tables.
async function familySnapshot(db) {
  const users = (await db.all('SELECT id, name, color FROM users ORDER BY id')).map((u) => ({ id: Number(u.id), name: u.name, color: u.color }));
  const rows = await db.all('SELECT user_id, code, status, year, updated_at FROM countries ORDER BY updated_at DESC, code');
  const visited = new Map(users.map((u) => [u.id, []]));
  const wish = new Map(users.map((u) => [u.id, []]));
  const recent = [];
  rows.forEach((r) => {
    const id = Number(r.user_id);
    if (!visited.has(id) || !L.BY_CODE[r.code]) return;
    if (r.status === 'visited') {
      visited.get(id).push(r.code);
      if (r.code !== L.HOME) recent.push({ user: id, code: r.code, at: r.updated_at });
    } else wish.get(id).push(r.code);
  });
  return { users, visited, wish, recent };
}

function countBy(map) {
  const counts = {};
  map.forEach((codes, id) =>
    codes.forEach((c) => {
      (counts[c] = counts[c] || []).push(id);
    })
  );
  return counts; // code -> [userIds]
}

const byEase = (a, b) => L.BY_CODE[a].tier - L.BY_CODE[b].tier || L.BY_CODE[a].en.localeCompare(L.BY_CODE[b].en);

function buildDashboard(snap) {
  const { users, visited, wish, recent } = snap;
  const beenBy = countBy(visited);
  const wantedBy = countBy(wish);
  const allCodes = L.COUNTRIES.map((c) => c.code);
  const familyVisited = Object.keys(beenBy);
  const n = users.length;

  const totalBadges = users.reduce((s, u) => s + L.badgesFor(visited.get(u.id), wish.get(u.id).length).filter((b) => b.done).length, 0);

  // Wishes someone else in the family can tell you about.
  const ask = [];
  users.forEach((u) =>
    wish.get(u.id).forEach((code) => {
      const experts = (beenBy[code] || []).filter((id) => id !== u.id);
      if (experts.length) ask.push({ user: u.id, code, experts });
    })
  );

  const unique = users
    .map((u) => ({ user: u.id, codes: visited.get(u.id).filter((c) => beenBy[c].length === 1 && n > 1).sort(byEase).reverse() }))
    .filter((x) => x.codes.length);

  const rarest = familyVisited
    .filter((c) => L.BY_CODE[c].tier >= 3)
    .sort((a, b) => L.BY_CODE[b].tier - L.BY_CODE[a].tier || beenBy[a].length - beenBy[b].length)
    .slice(0, 8)
    .map((code) => ({ code, users: beenBy[code] }));

  return {
    users,
    stats: {
      members: n,
      ...L.familyTotals(users.map((u) => visited.get(u.id))),
      badges: totalBadges,
      wishes: Object.keys(wantedBy).length,
    },
    never: allCodes.filter((c) => !beenBy[c]).sort(byEase),
    wanted: Object.keys(wantedBy)
      .sort((a, b) => wantedBy[b].length - wantedBy[a].length || byEase(a, b))
      .slice(0, 8)
      .map((code) => ({ code, users: wantedBy[code] })),
    everyone: n > 1 ? familyVisited.filter((c) => c !== L.HOME && beenBy[c].length === n).sort(byEase) : [],
    popular: familyVisited
      .filter((c) => c !== L.HOME)
      .sort((a, b) => beenBy[b].length - beenBy[a].length || byEase(a, b))
      .slice(0, 8)
      .map((code) => ({ code, users: beenBy[code] })),
    unique,
    ask: ask.slice(0, 10),
    rarest,
    continents: Object.keys(L.CONTINENTS).map((k) => {
      const all = L.COUNTRIES.filter((c) => c.continent === k);
      return { key: k, done: all.filter((c) => beenBy[c.code]).length, total: all.length };
    }),
    recent: recent.slice(0, 8),
  };
}

function register(app, { getDb, h, requireUser, requireAdmin, bad, now }) {
  app.get(
    '/api/settings',
    requireUser,
    h(async (req, res) => {
      const s = await getSettings(getDb());
      res.json({ ...s, widgets: WIDGETS, aiAvailable: !!process.env.ANTHROPIC_API_KEY });
    })
  );

  app.put(
    '/api/admin/settings',
    requireAdmin,
    h(async (req, res) => {
      const { hiddenWidgets, aiEnabled } = req.body || {};
      if (Array.isArray(hiddenWidgets)) await setSetting(getDb(), 'hiddenWidgets', hiddenWidgets.filter((w) => WIDGETS.includes(w)));
      if (typeof aiEnabled === 'boolean') await setSetting(getDb(), 'aiEnabled', aiEnabled);
      res.json(await getSettings(getDb()));
    })
  );

  app.get(
    '/api/dashboard',
    requireUser,
    h(async (req, res) => {
      const db = getDb();
      const [snap, settings] = await Promise.all([familySnapshot(db), getSettings(db)]);
      res.json({ ...buildDashboard(snap), hiddenWidgets: settings.hiddenWidgets });
    })
  );

  // ---------- ideas ----------

  async function listIdeas(db, me) {
    const ideas = await db.all(
      `SELECT i.id, i.user_id, i.text, i.country, i.created_at, u.name, u.color
       FROM ideas i JOIN users u ON u.id = i.user_id ORDER BY i.id DESC`
    );
    const votes = await db.all('SELECT idea_id, user_id FROM idea_votes');
    return ideas
      .map((i) => {
        const voters = votes.filter((v) => Number(v.idea_id) === Number(i.id)).map((v) => Number(v.user_id));
        return {
          id: Number(i.id),
          user: Number(i.user_id),
          name: i.name,
          color: i.color,
          text: i.text,
          country: i.country,
          createdAt: i.created_at,
          votes: voters.length,
          mine: voters.includes(me),
        };
      })
      .sort((a, b) => b.votes - a.votes || b.id - a.id);
  }

  app.get(
    '/api/ideas',
    requireUser,
    h(async (req, res) => res.json({ ideas: await listIdeas(getDb(), req.user.id) }))
  );

  app.post(
    '/api/ideas',
    requireUser,
    h(async (req, res) => {
      const text = typeof req.body.text === 'string' ? req.body.text.trim().slice(0, 500) : '';
      const country = L.BY_CODE[req.body.country] ? req.body.country : null;
      if (!text) return bad(res, 400, 'text_required');
      await getDb().run('INSERT INTO ideas (user_id, text, country, created_at) VALUES (?, ?, ?, ?)', [req.user.id, text, country, now()]);
      res.json({ ideas: await listIdeas(getDb(), req.user.id) });
    })
  );

  app.post(
    '/api/ideas/:id/vote',
    requireUser,
    h(async (req, res) => {
      const db = getDb();
      const id = Number(req.params.id);
      if (!(await db.get('SELECT 1 AS x FROM ideas WHERE id = ?', [id]))) return bad(res, 404, 'not_found');
      if (await db.get('SELECT 1 AS x FROM idea_votes WHERE idea_id = ? AND user_id = ?', [id, req.user.id])) {
        await db.run('DELETE FROM idea_votes WHERE idea_id = ? AND user_id = ?', [id, req.user.id]);
      } else {
        await db.run('INSERT INTO idea_votes (idea_id, user_id) VALUES (?, ?)', [id, req.user.id]);
      }
      res.json({ ideas: await listIdeas(db, req.user.id) });
    })
  );

  app.delete(
    '/api/ideas/:id',
    requireUser,
    h(async (req, res) => {
      const db = getDb();
      const idea = await db.get('SELECT user_id FROM ideas WHERE id = ?', [Number(req.params.id)]);
      if (!idea) return bad(res, 404, 'not_found');
      if (Number(idea.user_id) !== req.user.id && !req.user.is_admin) return bad(res, 403, 'forbidden');
      await db.run('DELETE FROM idea_votes WHERE idea_id = ?', [Number(req.params.id)]);
      await db.run('DELETE FROM ideas WHERE id = ?', [Number(req.params.id)]);
      res.json({ ideas: await listIdeas(db, req.user.id) });
    })
  );

  // ---------- plans ----------

  async function listPlans(db) {
    const rows = await db.all(
      `SELECT p.id, p.user_id, p.title, p.body, p.countries, p.created_at, u.name, u.color
       FROM plans p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC`
    );
    return rows.map((p) => ({
      id: Number(p.id),
      user: Number(p.user_id),
      name: p.name,
      color: p.color,
      title: p.title,
      body: p.body,
      countries: p.countries ? p.countries.split(',').filter((c) => L.BY_CODE[c]) : [],
      createdAt: p.created_at,
    }));
  }

  app.get(
    '/api/plans',
    requireUser,
    h(async (req, res) => res.json({ plans: await listPlans(getDb()) }))
  );

  app.post(
    '/api/plans',
    requireUser,
    h(async (req, res) => {
      const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
      const body = typeof req.body.body === 'string' ? req.body.body.trim().slice(0, 20000) : '';
      const countries = Array.isArray(req.body.countries) ? req.body.countries.filter((c) => L.BY_CODE[c]).slice(0, 30) : [];
      if (!title || !body) return bad(res, 400, 'text_required');
      await getDb().run('INSERT INTO plans (user_id, title, body, countries, created_at) VALUES (?, ?, ?, ?, ?)', [
        req.user.id,
        title,
        body,
        countries.join(','),
        now(),
      ]);
      res.json({ plans: await listPlans(getDb()) });
    })
  );

  app.delete(
    '/api/plans/:id',
    requireUser,
    h(async (req, res) => {
      const db = getDb();
      const plan = await db.get('SELECT user_id FROM plans WHERE id = ?', [Number(req.params.id)]);
      if (!plan) return bad(res, 404, 'not_found');
      if (Number(plan.user_id) !== req.user.id && !req.user.is_admin) return bad(res, 403, 'forbidden');
      await db.run('DELETE FROM plans WHERE id = ?', [Number(req.params.id)]);
      res.json({ plans: await listPlans(db) });
    })
  );

  return { familySnapshot: () => familySnapshot(getDb()), listIdeas: () => listIdeas(getDb(), 0), listPlans: () => listPlans(getDb()), getSettings: () => getSettings(getDb()) };
}

module.exports = { register, WIDGETS };
