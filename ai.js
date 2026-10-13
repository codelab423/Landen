'use strict';

// Family AI: a travel buddy that knows everyone's countries, wishlists, ideas and plans.
// Needs ANTHROPIC_API_KEY. Without it the endpoint answers 503 and the app hides the chat.

const Anthropic = require('@anthropic-ai/sdk');
const L = require('./public/countries.js');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 30;

const SYSTEM = `You are "Landen-AI", the travel buddy inside "Landen", a private web app where one Dutch family tracks the countries they have visited. Everyone in the family lives in the Netherlands.

Help them share ideas and plan trips together: suggest destinations, compare options, write day-by-day plans, rough budgets (always say they are estimates in euros), best travel periods, packing lists and things to do. Use the family data below: favour countries on their wishlists or that nobody in the family has visited yet, point out when someone in the family has already been somewhere (they can share tips), and mention the XP a country is worth when it helps (Tier 1 = 50 XP up to Tier 5 = 500 XP).

Answer in the language the user writes in (usually Dutch). Keep answers easy to scan on a phone: short paragraphs, **bold** for key words, "-" bullet lists, "##" headings for plans. Aim for under 300 words unless the user asks for a full plan. You have no live prices, flight times or availability, so say so when it matters. For countries with safety risks, tell them to check the official Dutch travel advice (nederlandwereldwijd.nl/reisadvies) before deciding.`;

function familyContext(snap, ideas, plans) {
  const name = (code) => (L.BY_CODE[code] ? L.BY_CODE[code].en : code);
  const lines = ['<family_data>'];
  snap.users.forEach((u) => {
    const v = snap.visited.get(u.id) || [];
    const w = snap.wish.get(u.id) || [];
    lines.push(`- ${u.name}: visited (${v.length}) ${v.map(name).join(', ') || 'none'}; wishlist: ${w.map(name).join(', ') || 'none'}`);
  });
  if (ideas.length) {
    lines.push('Ideas board (most votes first):');
    ideas.slice(0, 15).forEach((i) => lines.push(`- "${i.text}" by ${i.name}${i.country ? ` (${name(i.country)})` : ''}, ${i.votes} votes`));
  }
  if (plans.length) lines.push('Saved plans: ' + plans.slice(0, 10).map((p) => `"${p.title}"`).join(', '));
  lines.push('</family_data>');
  return lines.join('\n');
}

const usage = new Map(); // "userId:yyyy-mm-dd" -> count

function register(app, { h, requireUser, bad, family }) {
  const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

  app.post(
    '/api/ai/chat',
    requireUser,
    h(async (req, res) => {
      const settings = await family.getSettings();
      if (!client || settings.aiEnabled === false) return bad(res, 503, 'ai_off');

      const key = `${req.user.id}:${new Date().toISOString().slice(0, 10)}`;
      if ((usage.get(key) || 0) >= DAILY_LIMIT) return bad(res, 429, 'ai_limit');

      // Client sends the conversation so far; keep the last turns and only text.
      const history = (Array.isArray(req.body.messages) ? req.body.messages : [])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (!history.length || history[history.length - 1].role !== 'user') return bad(res, 400, 'text_required');
      while (history[0].role !== 'user') history.shift();

      const [snap, ideas, plans] = await Promise.all([family.familySnapshot(), family.listIdeas(), family.listPlans()]);
      usage.set(key, (usage.get(key) || 0) + 1);

      try {
        const response = await client.beta.messages.create({
          model: MODEL,
          max_tokens: 8000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' },
          system: [
            { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
            { type: 'text', text: familyContext(snap, ideas, plans) + `\nThe person chatting with you now is ${req.user.name}.` },
          ],
          messages: history,
        });
        if (response.stop_reason === 'refusal') return bad(res, 422, 'ai_refused');
        const text = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        res.json({ reply: text || '…', remaining: DAILY_LIMIT - usage.get(key) });
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) return bad(res, 429, 'ai_busy');
        if (err instanceof Anthropic.AuthenticationError) {
          console.error('AI: invalid ANTHROPIC_API_KEY');
          return bad(res, 503, 'ai_off');
        }
        if (err instanceof Anthropic.APIError) {
          console.error('AI error', err.status, err.message);
          return bad(res, 502, 'ai_error');
        }
        throw err;
      }
    })
  );
}

module.exports = { register };
