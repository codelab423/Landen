(function () {
  'use strict';

  const L = window.LANDEN;
  const PRESET_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#6366f1', '#14b8a6', '#0ea5e9', '#a855f7', '#0f766e', '#334155'];
  const VIEWS = ['dash', 'map', 'list', 'wish', 'badges', 'timeline', 'ideas', 'ranking', 'admin'];
  const $app = document.getElementById('app');
  const $tooltip = document.getElementById('tooltip');
  const $toasts = document.getElementById('toasts');
  const $modalRoot = document.getElementById('modal-root');

  const state = {
    config: null,
    me: null,
    mine: new Map(), // code -> {status, year, note}
    lang: storedLang() || ((navigator.language || 'nl').toLowerCase().startsWith('en') ? 'en' : 'nl'),
    viewingId: null, // admin: whose map is shown (null = own)
    adminUsers: null,
    mapMode: 'mine',
    family: null, // /api/family result for the family map
    settings: { hiddenWidgets: [], aiEnabled: true, aiAvailable: false, widgets: [] },
    ideasTab: 'ideas',
    aiChat: [],
    aiBusy: false,
    people: [], // [{id, name, color}] of the whole family, for avatars
    filters: { q: '', tier: '', continent: '', status: '' },
    authMode: 'login',
  };

  // ---------- utils ----------

  function storedLang() {
    try {
      return localStorage.getItem('landen-lang');
    } catch (e) {
      return null;
    }
  }

  function t(key, vars) {
    let s = (I18N[state.lang] && I18N[state.lang][key]) || I18N.nl[key] || key;
    if (vars) Object.keys(vars).forEach((k) => (s = s.split('{' + k + '}').join(vars[k])));
    return s;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  const num = (n) => Number(n).toLocaleString(state.lang === 'nl' ? 'nl-NL' : 'en-GB');
  const cname = (c) => c[state.lang];
  const flag = (code, cls) => `<img class="flag ${cls || ''}" src="/flags/${code.toLowerCase()}.svg" alt="" loading="lazy">`;
  const tierBadge = (tier) => `<span class="tier-badge" style="background:${L.TIERS[tier].badge}">${t('tier')} ${tier} · ${L.TIERS[tier][state.lang]}</span>`;
  // Avatar letters: one initial, or two (first + last name, e.g. AT / AR) when another
  // family member's name starts with the same letter.
  function initials(name) {
    const words = String(name || '?').trim().split(/\s+/);
    const first = words[0].charAt(0).toUpperCase();
    const clash = (state.people || []).some((p) => p.name !== name && String(p.name || '').trim().charAt(0).toUpperCase() === first);
    if (!clash) return first;
    if (words.length > 1) return first + words[words.length - 1].charAt(0).toUpperCase();
    return first + words[0].charAt(1).toLowerCase();
  }

  // Free Render servers fall asleep. When a request takes long, tell people why.
  let pendingSlow = 0;
  function wakeBanner(show) {
    let el = document.getElementById('wake-banner');
    if (show && !el) {
      el = document.createElement('div');
      el.id = 'wake-banner';
      el.className = 'wake-banner';
      el.setAttribute('role', 'status');
      el.innerHTML = `<span class="globe-spin" aria-hidden="true">🌍</span><span>${t('waking')}</span>`;
      document.body.appendChild(el);
    } else if (!show && el) el.remove();
  }

  async function api(method, url, body) {
    let slow = false;
    const timer = setTimeout(() => {
      slow = true;
      pendingSlow++;
      wakeBanner(true);
    }, 3000);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'same-origin',
      });
    } finally {
      clearTimeout(timer);
      if (slow && --pendingSlow === 0) wakeBanner(false);
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      /* empty */
    }
    if (!res.ok) {
      const err = new Error(data.error || 'generic');
      err.code = data.error || 'generic';
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const errText = (e) => (I18N[state.lang]['err_' + e.code] ? t('err_' + e.code) : t('err_generic'));

  function toast(text, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = text;
    $toasts.appendChild(el);
    setTimeout(() => el.remove(), kind === 'level' ? 4500 : 2600);
  }

  function setMine(rows) {
    state.mine = new Map(rows.map((r) => [r.code, r]));
  }

  function statsFor(map) {
    const visited = [];
    let wish = 0;
    map.forEach((r, code) => (r.status === 'visited' ? visited.push(code) : wish++));
    const xp = L.xpFor(visited);
    return { visited, wish, xp, lvl: L.levelFor(xp), badges: L.badgesFor(visited, wish) };
  }

  // The country data currently shown on the map / lists (own, or someone else's for the host).
  function viewed() {
    if (state.viewingId && state.adminUsers) {
      const u = state.adminUsers.find((x) => x.id === state.viewingId);
      if (u) return { user: u, map: new Map(u.countries.map((r) => [r.code, r])), readOnly: u.id !== state.me.id };
    }
    return { user: state.me, map: state.mine, readOnly: false };
  }

  // ---------- routing ----------

  function currentView() {
    const v = location.hash.replace('#/', '');
    if (v === 'admin' && !(state.me && state.me.isAdmin)) return 'dash';
    return VIEWS.includes(v) ? v : 'dash';
  }

  window.addEventListener('hashchange', render);

  // ---------- boot ----------

  async function boot() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    document.documentElement.lang = state.lang;
    try {
      state.config = await api('GET', '/api/config');
    } catch (e) {
      state.config = { needsFamilyCode: false, firstUser: false };
    }
    try {
      const data = await api('GET', '/api/me');
      onLoggedIn(data);
    } catch (e) {
      state.authMode = state.config.firstUser ? 'register' : 'login';
      render();
    }
  }

  async function loadSettings() {
    try {
      state.settings = await api('GET', '/api/settings');
    } catch (e) {
      /* keep defaults */
    }
  }

  async function loadPeople() {
    try {
      state.people = (await api('GET', '/api/people')).people;
    } catch (e) {
      /* avatars fall back to one letter */
    }
  }

  async function onLoggedIn(data) {
    loadSettings();
    await loadPeople();
    state.me = data.user;
    if (data.user.lang && !storedLang()) state.lang = data.user.lang;
    setMine(data.countries);
    render();
    if (state.me.isAdmin) loadAdminUsers();
  }

  async function loadAdminUsers() {
    try {
      state.adminUsers = (await api('GET', '/api/admin/users')).users;
      const v = currentView();
      if (v === 'admin' || v === 'map') render();
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- render ----------

  function render() {
    hideTooltip();
    document.documentElement.lang = state.lang;
    if (!state.me) return renderAuth();
    const view = currentView();
    $app.innerHTML = shell(view) + '<main id="main"></main>';
    bindShell();
    const main = document.getElementById('main');
    ({ dash: renderDashboard, map: renderMap, list: renderList, wish: renderWish, badges: renderBadges, timeline: renderTimeline, ideas: renderIdeas, ranking: renderRanking, admin: renderAdmin })[view](main);
  }

  function langToggle() {
    return `<div class="lang-toggle">
      <button data-lang="nl" class="${state.lang === 'nl' ? 'on' : ''}">NL</button>
      <button data-lang="en" class="${state.lang === 'en' ? 'on' : ''}">EN</button>
    </div>`;
  }

  function bindLang(root) {
    root.querySelectorAll('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        state.lang = b.dataset.lang;
        try {
          localStorage.setItem('landen-lang', state.lang);
        } catch (e) {
          /* ignore */
        }
        if (state.me) api('PATCH', '/api/me', { lang: state.lang }).catch(() => {});
        render();
      })
    );
  }

  // ---------- auth ----------

  function renderAuth() {
    const reg = state.authMode === 'register';
    $app.innerHTML = `
      <div class="auth-wrap">
        <form class="auth-card" id="auth-form" novalidate>
          <div style="display:flex;justify-content:space-between;align-items:start">
            <h1>🌍 ${t('appName')}</h1>
            ${langToggle()}
          </div>
          <p class="tagline">${t('tagline')}</p>
          ${reg && state.config.firstUser ? `<div class="hint">👑 ${t('firstUserHint')}</div>` : ''}
          ${reg ? `<label class="field"><span>${t('name')}</span><input name="name" autocomplete="name" required maxlength="40"></label>` : ''}
          <label class="field"><span>${t('email')}</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>${t('password')}</span><input name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="8"></label>
          ${reg && state.config.needsFamilyCode ? `<label class="field"><span>${t('familyCode')}</span><input name="familyCode" required></label>` : ''}
          <div class="error" id="auth-error"></div>
          <button class="btn primary block" type="submit">${reg ? t('register') : t('login')}</button>
          <div class="switch-line">${reg ? t('haveAccount') : t('noAccount')}
            <button type="button" class="linkish" id="auth-switch">${reg ? t('login') : t('register')}</button>
          </div>
        </form>
      </div>`;
    bindLang($app);
    document.getElementById('auth-switch').onclick = () => {
      state.authMode = reg ? 'login' : 'register';
      renderAuth();
    };
    document.getElementById('auth-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target));
      const btn = ev.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const data = await api('POST', reg ? '/api/register' : '/api/login', { ...fd, lang: state.lang });
        state.config.firstUser = false;
        const me = await api('GET', '/api/me');
        onLoggedIn(me || data);
      } catch (e) {
        document.getElementById('auth-error').textContent = errText(e);
        btn.disabled = false;
      }
    };
  }

  // ---------- shell ----------

  function shell(view) {
    const s = statsFor(state.mine);
    const links = [
      ['dash', '📊 ' + t('navDash')],
      ['map', '🗺️ ' + t('navMap')],
      ['list', '🏆 ' + t('navList')],
      ['wish', '⭐ ' + t('navWish')],
      ['badges', '🏅 ' + t('navBadges')],
      ['timeline', '🕒 ' + t('navTimeline')],
      ['ideas', '💡 ' + t('navIdeas')],
      ['ranking', '👨‍👩‍👧‍👦 ' + t('navRanking')],
    ];
    if (state.me.isAdmin) links.push(['admin', '👑 ' + t('navAdmin')]);
    return `
      <header class="topbar"><div class="topbar-inner">
        <div class="logo"><span>🌍</span><span class="logo-text">${t('appName')}</span></div>
        <nav class="nav">${links.map(([k, label]) => `<a href="#/${k}" class="${k === view ? 'active' : ''}">${label}</a>`).join('')}</nav>
        <div class="top-right">
          <span class="pill" title="${t('xp')}">Lv ${s.lvl.index} · ${num(s.xp)} XP</span>
          ${langToggle()}
          <button class="avatar" id="profile-btn" style="background:${esc(state.me.color)}" title="${t('profile')} · ${esc(state.me.name)}" aria-label="${t('profile')} · ${esc(state.me.name)}">${esc(initials(state.me.name))}</button>
        </div>
      </div></header>`;
  }

  function bindShell() {
    bindLang($app);
    document.getElementById('profile-btn').onclick = openProfile;
  }

  function statCards(map) {
    const s = statsFor(map);
    const lv = s.lvl;
    const pct = lv.next ? Math.round(((s.xp - lv.level.xp) / (lv.next.xp - lv.level.xp)) * 100) : 100;
    return `<div class="stats">
      <div class="stat"><div class="label">${t('countriesVisited')}</div>
        <div class="value">${s.visited.length} <small style="font-size:14px;color:var(--muted)">/ 195</small></div>
        <div class="extra">${Math.round((s.visited.length / 195) * 100)}% ${t('ofWorld')}</div></div>
      <div class="stat"><div class="label">${t('xp')}</div>
        <div class="value">${num(s.xp)}</div>
        <div class="extra">/ ${num(L.MAX_XP)}</div></div>
      <div class="stat"><div class="label">${t('level')} ${lv.index}</div>
        <div class="value">${lv.level[state.lang]}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="extra">${lv.next ? t('nextLevel', { n: num(lv.next.xp - s.xp), name: lv.next[state.lang] }) : t('maxLevel')}</div></div>
      <div class="stat"><div class="label">${t('navBadges')}</div>
        <div class="value">🏅 ${s.badges.filter((b) => b.done).length} <small style="font-size:14px;color:var(--muted)">/ ${s.badges.length}</small></div>
        <div class="extra">⭐ ${s.wish} ${t('onWishlist')}</div></div>
    </div>`;
  }

  // ---------- map view ----------

  const mapState = { svg: null, node: null, zoom: null, loaded: false, loading: null, byCode: new Map(), dots: null };

  function renderMap(main) {
    const v = viewed();
    const canPick = state.me.isAdmin && state.adminUsers && state.adminUsers.length > 1;
    main.innerHTML = `
      ${statCards(v.map)}
      <div class="card map-card">
        ${v.readOnly ? `<div class="readonly-banner">👀 ${t('readOnly', { name: esc(v.user.name) })}</div>` : ''}
        <div class="map-toolbar">
          <div class="seg">
            <button data-mode="mine" class="${state.mapMode === 'mine' ? 'on' : ''}">${t('mapMine')}</button>
            <button data-mode="tier" class="${state.mapMode === 'tier' ? 'on' : ''}">${t('mapTiers')}</button>
            <button data-mode="family" class="${state.mapMode === 'family' ? 'on' : ''}">${t('mapFamily')}</button>
          </div>
          <button class="btn small" id="surprise" title="${t('surpriseHint')}">🎲 ${t('surprise')}</button>
          <span class="spacer"></span>
          ${
            canPick
              ? `<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600">${t('viewingMapOf')}
                  <select id="map-user">${state.adminUsers
                    .map((u) => `<option value="${u.id}" ${u.id === (state.viewingId || state.me.id) ? 'selected' : ''}>${esc(u.name)}${u.id === state.me.id ? ' (' + t('me') + ')' : ''}</option>`)
                    .join('')}</select></label>`
              : ''
          }
        </div>
        <div class="map-wrap" id="map-wrap">
          <div class="map-loading" id="map-loading" role="status" aria-live="polite">
            <div class="map-skeleton" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
            <div class="globe-spin" aria-hidden="true">🌍</div>
            <span>${t('mapLoading')}</span>
          </div>
          <div class="zoom-btns">
            <button data-zoom="in" title="${t('zoomIn')}" aria-label="${t('zoomIn')}">+</button>
            <button data-zoom="out" title="${t('zoomOut')}" aria-label="${t('zoomOut')}">−</button>
            <button data-zoom="reset" title="${t('zoomReset')}" aria-label="${t('zoomReset')}">⟲</button>
          </div>
        </div>
        <div class="legend" id="legend"></div>
      </div>
      <div class="card"><h2>${t('continentProgress')}</h2><p class="sub">${t('clickHint')}</p>
        <div class="grid" id="continents"></div></div>`;

    main.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        state.mapMode = b.dataset.mode;
        main.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
        if (state.mapMode === 'family') loadFamily().then(paintMap);
        paintMap();
      })
    );
    document.getElementById('surprise').onclick = surprise;
    if (state.mapMode === 'family') loadFamily().then(paintMap);
    const sel = document.getElementById('map-user');
    if (sel)
      sel.onchange = () => {
        const id = Number(sel.value);
        state.viewingId = id === state.me.id ? null : id;
        render();
      };
    main.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => zoomBy(b.dataset.zoom)));

    renderContinents(v.map);
    ensureMap()
      .catch(() => {
        const l = document.getElementById('map-loading');
        if (l) l.querySelector('span').textContent = t('mapError');
        return Promise.reject();
      })
      .then(() => {
        const wrap = document.getElementById('map-wrap');
        if (!wrap) return;
        const loading = document.getElementById('map-loading');
        if (loading) loading.remove();
        if (mapState.node.parentNode === wrap) return paintMap();
        wrap.insertBefore(mapState.node, wrap.firstChild);
        paintMap();
      })
      .catch(() => {});
  }

  function renderContinents(map) {
    const el = document.getElementById('continents');
    el.innerHTML = Object.keys(L.CONTINENTS)
      .map((k) => {
        const all = L.COUNTRIES.filter((c) => c.continent === k);
        const done = all.filter((c) => map.get(c.code) && map.get(c.code).status === 'visited');
        const pct = Math.round((done.length / all.length) * 100);
        return `<div class="cont"><b><span>${L.CONTINENTS[k][state.lang]}</span><span>${done.length}/${all.length}</span></b>
          <div class="bar"><i style="width:${pct}%"></i></div><small>${pct}% · ${num(L.xpFor(done.map((c) => c.code)))} XP</small></div>`;
      })
      .join('');
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = reject;
      document.head.appendChild(el);
    });
  }

  // The map (d3 + topojson + map data) is only loaded when the map page is opened.
  function ensureMap() {
    if (mapState.loaded) return Promise.resolve();
    if (mapState.loading) return mapState.loading;
    const v = (state.config && state.config.mapVersion) || '';
    mapState.loading = Promise.all([
      fetch('/data/world.json?v=' + v).then((r) => r.json()),
      window.d3 ? null : loadScript('/vendor/d3.min.js'),
      window.topojson ? null : loadScript('/vendor/topojson-client.min.js'),
    ])
      .then(([world]) => buildMap(world))
      .catch((e) => {
        mapState.loading = null;
        throw e;
      });
    return mapState.loading;
  }

  function buildMap(world) {
    const W = 1000;
    const H = 500;
    const features = topojson
      .feature(world, world.objects.countries)
      .features.filter((f) => f.id !== '010') // no Antarctica
      .map(fixWinding);
    const projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'FeatureCollection', features });
    const path = d3.geoPath(projection);

    const svg = d3.create('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');
    const defs = svg.append('defs');
    const pat = defs.append('pattern').attr('id', 'wish-pattern').attr('patternUnits', 'userSpaceOnUse').attr('width', 4).attr('height', 4).attr('patternTransform', 'rotate(45)');
    pat.append('rect').attr('width', 4).attr('height', 4).attr('fill', '#fde68a');
    pat.append('rect').attr('width', 2).attr('height', 4).attr('fill', '#f59e0b');

    svg.append('path').attr('d', path({ type: 'Sphere' })).attr('fill', 'transparent');
    const g = svg.append('g');

    const area = new Map(); // code -> {area, biggest feature}
    features.forEach((f) => {
      const c = L.BY_ID[f.id] || (L.EXTRA_SHAPES[f.properties.name] && L.BY_CODE[L.EXTRA_SHAPES[f.properties.name]]);
      f.country = c || null;
      if (c) {
        const a = path.area(f);
        const prev = area.get(c.code);
        if (!prev) area.set(c.code, { area: a, feature: f, biggest: a });
        else {
          prev.area += a;
          if (a > prev.biggest) Object.assign(prev, { feature: f, biggest: a });
        }
      }
    });

    g.selectAll('path.country')
      .data(features)
      .join('path')
      .attr('class', (f) => 'country' + (f.country ? ' clickable' : ''))
      .attr('d', path)
      .each(function (f) {
        if (!f.country) return;
        const list = mapState.byCode.get(f.country.code) || [];
        list.push(this);
        mapState.byCode.set(f.country.code, list);
      });

    // Tiny countries get a clickable dot so you can actually hit them.
    const tiny = [];
    area.forEach((v, code) => {
      if (v.area < 6) {
        // Some micro-states (Vatican City) have no area at all; fall back to the middle of their bounds.
        let xy = path.centroid(v.feature);
        if (!isFinite(xy[0])) {
          const [[x0, y0], [x1, y1]] = d3.geoBounds(v.feature);
          xy = projection([(x0 + x1) / 2, (y0 + y1) / 2]);
        }
        tiny.push({ code, country: L.BY_CODE[code], xy });
      }
    });
    mapState.dots = g
      .selectAll('circle.dot')
      .data(tiny.filter((d) => isFinite(d.xy[0])))
      .join('circle')
      .attr('class', 'dot')
      .attr('cx', (d) => d.xy[0])
      .attr('cy', (d) => d.xy[1])
      .attr('r', 3);

    const targets = g.selectAll('path.clickable, circle.dot');
    targets
      .on('pointermove', (ev, d) => {
        if (ev.pointerType === 'mouse') showTooltip(ev, d.country);
      })
      .on('pointerleave', hideTooltip)
      .on('click', (ev, d) => {
        hideTooltip();
        openCountry(d.country.code);
      });

    mapState.zoom = d3
      .zoom()
      .scaleExtent([1, 80])
      .translateExtent([[0, 0], [W, H]])
      .on('zoom', (ev) => {
        g.attr('transform', ev.transform);
        mapState.dots.attr('r', Math.max(0.15, 3 / Math.sqrt(ev.transform.k)) );
        hideTooltip();
      });
    svg.call(mapState.zoom).on('dblclick.zoom', null);

    mapState.svg = svg;
    mapState.node = svg.node();
    mapState.loaded = true;
  }

  // A few shapes in the source data are wound the wrong way, which makes d3 fill
  // the whole globe instead of the country. Flip any polygon bigger than a hemisphere.
  function fixWinding(f) {
    const g = f.geometry;
    if (!g) return f;
    const flip = (rings) => {
      const poly = { type: 'Polygon', coordinates: rings };
      return d3.geoArea(poly) > 2 * Math.PI ? rings.map((r) => r.slice().reverse()) : rings;
    };
    if (g.type === 'Polygon') g.coordinates = flip(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(flip);
    return f;
  }

  function zoomBy(kind) {
    if (!mapState.svg) return;
    const s = mapState.svg.transition().duration(350);
    if (kind === 'in') s.call(mapState.zoom.scaleBy, 2);
    else if (kind === 'out') s.call(mapState.zoom.scaleBy, 0.5);
    else s.call(mapState.zoom.transform, d3.zoomIdentity);
  }

  async function loadFamily() {
    try {
      state.family = await api('GET', '/api/family');
    } catch (e) {
      /* keep the old data */
    }
  }

  // "Surprise me": a random country you haven't been to yet, wishlist countries twice as likely.
  function surprise() {
    const pool = [];
    L.COUNTRIES.forEach((c) => {
      const row = state.mine.get(c.code);
      if (row && row.status === 'visited') return;
      pool.push(c.code);
      if (row) pool.push(c.code);
    });
    if (!pool.length) return toast('🌍 ' + t('seenItAll'));
    const code = pool[Math.floor(Math.random() * pool.length)];
    state.viewingId = null;
    toast('🎲 ' + t('surpriseToast', { country: cname(L.BY_CODE[code]) }));
    openCountry(code);
  }

  function fillFor(code, map, color) {
    const row = map.get(code);
    const c = L.BY_CODE[code];
    if (state.mapMode === 'family') {
      const f = state.family;
      const n = f ? f.counts[code] || 0 : 0;
      if (!n) return { fill: 'var(--land)', opacity: 1 };
      return { fill: 'var(--brand-2)', opacity: 0.25 + 0.75 * (n / Math.max(1, f.members)) };
    }
    if (state.mapMode === 'tier') return { fill: L.TIERS[c.tier].color, opacity: row && row.status === 'visited' ? 1 : 0.32 };
    if (!row) return { fill: 'var(--land)', opacity: 1 };
    if (row.status === 'visited') return { fill: color, opacity: 1 };
    return { fill: 'url(#wish-pattern)', opacity: 1 };
  }

  function paintMap() {
    if (!mapState.loaded) return;
    const v = viewed();
    const color = v.user.color;
    mapState.svg.selectAll('path.country').each(function (f) {
      if (!f.country) {
        this.style.fill = 'var(--land-other)';
        this.style.fillOpacity = 1;
        return;
      }
      const s = fillFor(f.country.code, v.map, color);
      this.style.fill = s.fill;
      this.style.fillOpacity = s.opacity;
    });
    mapState.dots.each(function (d) {
      const s = fillFor(d.code, v.map, color);
      this.style.fill = s.fill === 'var(--land)' ? '#94a3b8' : s.fill;
      this.style.fillOpacity = Math.max(0.6, s.opacity);
    });

    const legend = document.getElementById('legend');
    if (!legend) return;
    if (state.mapMode === 'family') {
      const m = state.family ? state.family.members : 0;
      legend.innerHTML = `<span>${t('familyLegend')}</span>
        <span><i class="swatch" style="background:var(--brand-2);opacity:0.4"></i>${t('familyFew')}</span>
        <span><i class="swatch" style="background:var(--brand-2)"></i>${t('familyAll', { n: m })}</span>
        <span><i class="swatch" style="background:var(--land)"></i>${t('familyNone')}</span>`;
    } else if (state.mapMode === 'tier') {
      legend.innerHTML = [1, 2, 3, 4, 5]
        .map((n) => `<span><i class="swatch" style="background:${L.TIERS[n].color}"></i>${t('tier')} ${n} · ${L.TIERS[n][state.lang]} · ${L.TIERS[n].xp} XP</span>`)
        .join('');
    } else {
      legend.innerHTML = `
        <span><i class="swatch" style="background:${esc(color)}"></i>${t('visited')}</span>
        <span><i class="swatch wish"></i>${t('wish')}</span>
        <span><i class="swatch" style="background:var(--land)"></i>${t('notVisited')}</span>
        <span><i class="swatch" style="background:var(--land-other);outline:1px solid var(--border)"></i>${t('otherTerritory')}</span>`;
    }
  }

  function showTooltip(ev, c) {
    const row = viewed().map.get(c.code);
    let status = row ? (row.status === 'visited' ? '✅ ' + t('visited') + (row.year ? ' (' + row.year + ')' : '') : '⭐ ' + t('wish')) : t('notVisited');
    const f = state.family;
    if (state.mapMode === 'family' && f) {
      status = '👨‍👩‍👧‍👦 ' + t('familyCount', { n: f.counts[c.code] || 0, m: f.members });
      if (f.who && f.who[c.code]) {
        const names = f.who[c.code].map((id) => (f.users.find((u) => u.id === id) || {}).name).filter(Boolean);
        status += '<br>' + names.map(esc).join(', ');
      }
    }
    $tooltip.innerHTML = `<b>${cname(c)}</b>${tierBadge(c.tier)} <strong>${c.xp} XP</strong><div style="margin-top:4px;color:var(--muted)">${status}</div>`;
    $tooltip.hidden = false;
    const pad = 14;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    const r = $tooltip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    $tooltip.style.left = x + 'px';
    $tooltip.style.top = y + 'px';
  }

  function hideTooltip() {
    $tooltip.hidden = true;
  }

  // ---------- country modal ----------

  function openCountry(code) {
    const c = L.BY_CODE[code];
    const v = viewed();
    const row = v.map.get(code);
    const home = code === L.HOME;
    let status = home ? 'visited' : row ? row.status : null;

    if (v.readOnly) {
      openModal(`
        <div class="modal-head">${flag(code, 'big')}<div><h3>${cname(c)}</h3><small>${L.CONTINENTS[c.continent][state.lang]}</small><div>${tierBadge(c.tier)} <b>${c.xp} XP</b></div></div></div>
        <p><b>${esc(v.user.name)}:</b> ${row ? (row.status === 'visited' ? '✅ ' + t('visited') : '⭐ ' + t('wish')) : t('notVisited')}
        ${row && row.year ? ' · ' + row.year : ''}</p>
        ${row && row.note ? `<p style="white-space:pre-wrap">${esc(row.note)}</p>` : ''}
        <div class="modal-foot"><span></span><button class="btn" data-close>${t('close')}</button></div>`);
      return;
    }

    const m = openModal(`
      <div class="modal-head">${flag(code, 'big')}<div><h3>${cname(c)}</h3><small>${L.CONTINENTS[c.continent][state.lang]}</small><div>${tierBadge(c.tier)} <b>${c.xp} XP</b></div></div></div>
      ${
        home
          ? `<div class="hint">🏠 ${t('homeCountry')}</div>`
          : `<div class="choice">
        <button class="btn" data-status="visited">✅ ${t('visited')}<small>+${c.xp} XP</small></button>
        <button class="btn" data-status="wish">⭐ ${t('wish')}<small>${t('navWish')}</small></button>
      </div>`
      }
      <label class="field"><span>${t('year')}</span><input name="year" type="number" min="1900" max="2100" inputmode="numeric" value="${row && row.year ? row.year : ''}"></label>
      <label class="field"><span>${t('note')}</span><textarea name="note" rows="3" maxlength="500" placeholder="${t('notePlaceholder')}">${row && row.note ? esc(row.note) : ''}</textarea></label>
      <div class="error" id="c-error"></div>
      <div class="modal-foot">
        ${row && !home ? `<button class="btn danger" id="c-remove">${t('remove')}</button>` : '<span></span>'}
        <div style="display:flex;gap:8px"><button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="c-save">${t('save')}</button></div>
      </div>`);

    const btns = m.querySelectorAll('[data-status]');
    const save = m.querySelector('#c-save');
    const hint = m.querySelector('#c-error');
    // Nothing chosen and nothing stored yet → there is nothing to save.
    const paint = () => {
      btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
      save.disabled = !status && !row;
      hint.textContent = save.disabled ? t('pickStatus') : '';
    };
    paint();
    btns.forEach((b) =>
      b.addEventListener('click', () => {
        status = status === b.dataset.status ? null : b.dataset.status;
        paint();
      })
    );
    m.querySelector('#c-save').onclick = async () => {
      const year = m.querySelector('[name=year]').value;
      const note = m.querySelector('[name=note]').value;
      try {
        if (!status) {
          if (row) await setCountry(code, null);
        } else await setCountry(code, status, year ? Number(year) : null, note);
        closeModal();
      } catch (e) {
        m.querySelector('#c-error').textContent = errText(e);
      }
    };
    const rm = m.querySelector('#c-remove');
    if (rm)
      rm.onclick = async () => {
        await setCountry(code, null);
        closeModal();
      };
  }

  async function setCountry(code, status, year, note) {
    const before = statsFor(state.mine);
    const wasVisited = state.mine.get(code) && state.mine.get(code).status === 'visited';
    const data = status
      ? await api('PUT', '/api/me/countries/' + code, { status, year: year == null ? null : year, note: note || '' })
      : await api('DELETE', '/api/me/countries/' + code);
    setMine(data.countries);
    const after = statsFor(state.mine);
    const c = L.BY_CODE[code];
    if (status === 'visited' && !wasVisited) toast('🎉 ' + t('xpGained', { xp: c.xp, country: cname(c) }), 'xp');
    else toast(status ? t('saved') : t('removed'));
    if (after.lvl.index > before.lvl.index) setTimeout(() => toast(t('levelUp', { name: after.lvl.level[state.lang] }), 'level'), 500);
    const had = new Set(before.badges.filter((b) => b.done).map((b) => b.id));
    after.badges
      .filter((b) => b.done && !had.has(b.id))
      .forEach((b, i) => setTimeout(() => toast(`${b.icon} ${t('badgeUnlocked', { name: b[state.lang] })}`, 'level'), 1200 + i * 900));
    if (state.family) loadFamily().then(() => currentView() === 'map' && paintMap());
    if (state.me.isAdmin) loadAdminUsers();
    refreshAfterChange();
  }

  function refreshAfterChange() {
    // Re-render without losing the map zoom or the list scroll position.
    const y = window.scrollY;
    if (currentView() === 'map' && mapState.loaded) {
      const main = document.getElementById('main');
      main.querySelector('.stats').outerHTML = statCards(viewed().map);
      renderContinents(viewed().map);
      document.querySelector('.topbar').outerHTML = shell('map');
      bindShell();
      paintMap();
    } else {
      render();
    }
    window.scrollTo(0, y);
  }

  // ---------- modal helpers ----------

  function openModal(html) {
    $modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const back = $modalRoot.firstChild;
    back.addEventListener('click', (e) => {
      if (e.target === back || e.target.closest('[data-close]')) closeModal();
    });
    const first = back.querySelector('input, textarea');
    if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
    return back.querySelector('.modal');
  }

  // Promise-based confirmation dialog; resolves true only when the danger button is pressed.
  function confirmModal({ icon, title, text, confirmLabel }) {
    return new Promise((resolve) => {
      const m = openModal(`
        <div class="modal-head"><span style="font-size:36px" aria-hidden="true">${icon || '⚠️'}</span><div><h3 id="cm-title">${title}</h3></div></div>
        <p class="confirm-text">${text}</p>
        <div class="modal-foot">
          <span></span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
            <button class="btn" id="cm-cancel">${t('cancel')}</button>
            <button class="btn danger-solid" id="cm-ok">${confirmLabel}</button>
          </div>
        </div>`);
      m.setAttribute('aria-labelledby', 'cm-title');
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        observer.disconnect();
        closeModal();
        resolve(v);
      };
      // Closing the dialog any other way (Esc, clicking outside) counts as "cancel".
      const observer = new MutationObserver(() => {
        if (!$modalRoot.contains(m)) finish(false);
      });
      observer.observe($modalRoot, { childList: true });
      m.querySelector('#cm-cancel').onclick = () => finish(false);
      m.querySelector('#cm-ok').onclick = () => finish(true);
      m.querySelector('#cm-cancel').focus(); // the safe choice has focus
    });
  }

  function closeModal() {
    $modalRoot.innerHTML = '';
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // ---------- list views ----------

  function countryRow(c, rank, map, readOnly) {
    const row = map.get(c.code);
    const st = row ? row.status : '';
    return `<div class="row ${st}" style="--user-color:${esc(viewed().user.color)}">
      <span class="rank">${rank ? '#' + rank : ''}</span>
      ${flag(c.code)}
      <div class="info" data-open="${c.code}"><b>${cname(c)}</b><small>${L.CONTINENTS[c.continent][state.lang]}${row && row.year ? ' · ' + row.year : ''}</small></div>
      ${tierBadge(c.tier)}
      <span class="xp">${c.xp} XP</span>
      ${
        readOnly
          ? ''
          : c.code === L.HOME
          ? `<div class="actions"><span class="icon-btn on-visited" role="img" title="${t('homeCountry')}" aria-label="${t('homeCountry')}">🏠</span></div>`
          : `<div class="actions">
        <button class="icon-btn ${st === 'visited' ? 'on-visited' : ''}" data-toggle="visited" data-code="${c.code}"
          title="${t(st === 'visited' ? 'unmarkVisited' : 'markVisitedLabel', { country: cname(c) })}"
          aria-label="${t(st === 'visited' ? 'unmarkVisited' : 'markVisitedLabel', { country: cname(c) })}" aria-pressed="${st === 'visited'}"><span aria-hidden="true">✓</span></button>
        <button class="icon-btn ${st === 'wish' ? 'on-wish' : ''}" data-toggle="wish" data-code="${c.code}"
          title="${t(st === 'wish' ? 'unmarkWish' : 'markWishLabel', { country: cname(c) })}"
          aria-label="${t(st === 'wish' ? 'unmarkWish' : 'markWishLabel', { country: cname(c) })}" aria-pressed="${st === 'wish'}"><span aria-hidden="true">★</span></button>
      </div>`
      }
    </div>`;
  }

  function bindRows(root) {
    root.querySelectorAll('[data-open]').forEach((el) => (el.onclick = () => openCountry(el.dataset.open)));
    root.querySelectorAll('[data-toggle]').forEach(
      (el) =>
        (el.onclick = async () => {
          const code = el.dataset.code;
          const want = el.dataset.toggle;
          const row = state.mine.get(code);
          el.disabled = true;
          try {
            if (row && row.status === want) await setCountry(code, null);
            else await setCountry(code, want, row ? row.year : null, row ? row.note : '');
          } catch (e) {
            toast(errText(e));
            el.disabled = false;
          }
        })
    );
  }

  function renderList(main) {
    const v = viewed();
    const f = state.filters;
    main.innerHTML = `
      <h2>${t('tierList')}</h2><p class="sub">${t('tierListSub')}</p>
      ${v.readOnly ? `<div class="readonly-banner" style="border-radius:10px;margin-bottom:12px">👀 ${t('readOnly', { name: esc(v.user.name) })}</div>` : ''}
      <div class="filters">
        <input class="search" id="f-q" placeholder="${t('search')}" value="${esc(f.q)}" type="search">
        <select id="f-tier"><option value="">${t('allTiers')}</option>${[5, 4, 3, 2, 1]
          .map((n) => `<option value="${n}" ${String(n) === f.tier ? 'selected' : ''}>${t('tier')} ${n} · ${L.TIERS[n][state.lang]}</option>`)
          .join('')}</select>
        <select id="f-cont"><option value="">${t('allContinents')}</option>${Object.keys(L.CONTINENTS)
          .map((k) => `<option value="${k}" ${k === f.continent ? 'selected' : ''}>${L.CONTINENTS[k][state.lang]}</option>`)
          .join('')}</select>
        <select id="f-status">${[
          ['', t('allStatus')],
          ['visited', t('onlyVisited')],
          ['wish', t('onlyWish')],
          ['none', t('onlyNot')],
        ]
          .map(([k, l]) => `<option value="${k}" ${k === f.status ? 'selected' : ''}>${l}</option>`)
          .join('')}</select>
      </div>
      <div id="list-body"></div>`;

    const body = document.getElementById('list-body');
    const draw = () => {
      const q = f.q.trim().toLowerCase();
      // Hardest first; within a tier alphabetical. Rank = position in the full 195 list.
      const ranked = L.COUNTRIES.slice().sort((a, b) => b.tier - a.tier || cname(a).localeCompare(cname(b), state.lang));
      const rankOf = new Map(ranked.map((c, i) => [c.code, i + 1]));
      const shown = ranked.filter((c) => {
        const row = v.map.get(c.code);
        if (q && !c.nl.toLowerCase().includes(q) && !c.en.toLowerCase().includes(q)) return false;
        if (f.tier && String(c.tier) !== f.tier) return false;
        if (f.continent && c.continent !== f.continent) return false;
        if (f.status === 'visited' && !(row && row.status === 'visited')) return false;
        if (f.status === 'wish' && !(row && row.status === 'wish')) return false;
        if (f.status === 'none' && row) return false;
        return true;
      });
      if (!shown.length) {
        body.innerHTML = `<div class="empty">${t('noResults')}</div>`;
        return;
      }
      let html = '';
      [5, 4, 3, 2, 1].forEach((tier) => {
        const group = shown.filter((c) => c.tier === tier);
        if (!group.length) return;
        const total = L.COUNTRIES.filter((c) => c.tier === tier);
        const done = total.filter((c) => v.map.get(c.code) && v.map.get(c.code).status === 'visited').length;
        html += `<div class="tier-head">${tierBadge(tier)} <span>${L.TIERS[tier].xp} XP</span><small>${done}/${total.length} ${t('visited').toLowerCase()}</small></div>
          <div class="rows">${group.map((c) => countryRow(c, rankOf.get(c.code), v.map, v.readOnly)).join('')}</div>`;
      });
      body.innerHTML = html;
      bindRows(body);
    };
    draw();

    const on = (id, key, evt) =>
      document.getElementById(id).addEventListener(evt || 'change', (e) => {
        f[key] = e.target.value;
        draw();
      });
    on('f-q', 'q', 'input');
    on('f-tier', 'tier');
    on('f-cont', 'continent');
    on('f-status', 'status');
  }

  function renderWish(main) {
    const v = viewed();
    const wishes = L.COUNTRIES.filter((c) => v.map.get(c.code) && v.map.get(c.code).status === 'wish').sort((a, b) => b.tier - a.tier);
    const potential = wishes.reduce((s, c) => s + c.xp, 0);
    main.innerHTML = `
      <h2>⭐ ${t('wishTitle')}</h2>
      <p class="sub">${wishes.length ? t('wishPotential', { xp: num(potential) }) : ''}</p>
      ${v.readOnly ? `<div class="readonly-banner" style="border-radius:10px;margin-bottom:12px">👀 ${t('readOnly', { name: esc(v.user.name) })}</div>` : ''}
      ${
        wishes.length
          ? `<div class="rows">${wishes
              .map((c) => {
                const row = v.map.get(c.code);
                return `<div class="row wish">
                ${flag(c.code)}
                <div class="info" data-open="${c.code}"><b>${cname(c)}</b><small>${L.CONTINENTS[c.continent][state.lang]}${row.note ? ' · ' + esc(row.note) : ''}</small></div>
                ${tierBadge(c.tier)}<span class="xp">+${c.xp} XP</span>
                ${v.readOnly ? '' : `<button class="btn small primary" data-toggle="visited" data-code="${c.code}">✅ ${t('markVisited')}</button>`}
              </div>`;
              })
              .join('')}</div>`
          : `<div class="card empty">${t('wishEmpty')}</div>`
      }`;
    bindRows(main);
  }

  // ---------- badges ----------

  function renderBadges(main) {
    const v = viewed();
    const s = statsFor(v.map);
    const done = s.badges.filter((b) => b.done).length;
    // Unlocked first, then the ones you're closest to.
    const sorted = s.badges.slice().sort((a, b) => b.done - a.done || b.have / b.need - a.have / a.need);
    main.innerHTML = `
      <h2>🏅 ${t('badgesTitle')}</h2>
      <p class="sub">${t('badgesSub', { n: done, m: s.badges.length })}</p>
      ${v.readOnly ? `<div class="readonly-banner" style="border-radius:10px;margin-bottom:12px">👀 ${t('readOnly', { name: esc(v.user.name) })}</div>` : ''}
      <div class="badges">${sorted
        .map(
          (b) => `<div class="badge ${b.done ? 'done' : ''}">
          <div class="badge-icon">${b.icon}</div>
          <b>${b[state.lang]}</b>
          <small>${state.lang === 'nl' ? b.dnl : b.den}</small>
          ${b.done ? `<span class="pill">✓ ${t('unlocked')}</span>` : `<div class="bar"><i style="width:${Math.round((b.have / b.need) * 100)}%"></i></div><small>${b.have} / ${b.need}</small>`}
        </div>`
        )
        .join('')}</div>`;
  }

  // ---------- small render helpers ----------

  const chip = (code) => `<button class="chip" data-open="${code}">${flag(code, 'sm')}${cname(L.BY_CODE[code])}</button>`;

  function userById(users, id) {
    return users.find((u) => u.id === id) || { name: '?', color: '#94a3b8' };
  }

  function avatars(users, ids, max) {
    const shown = ids.slice(0, max || 5);
    const extra = ids.length - shown.length;
    return `<span class="avatars">${shown
      .map((id) => {
        const u = userById(users, id);
        return `<span class="avatar xs" style="background:${esc(u.color)}" title="${esc(u.name)}" aria-label="${esc(u.name)}">${esc(initials(u.name))}</span>`;
      })
      .join('')}${extra > 0 ? `<span class="avatar xs more">+${extra}</span>` : ''}</span>`;
  }

  function names(users, ids) {
    return ids.map((id) => esc(userById(users, id).name)).join(', ');
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return t('today');
    if (days === 1) return t('yesterday');
    if (days < 30) return t('daysAgo', { n: days });
    return d.toLocaleDateString(state.lang === 'nl' ? 'nl-NL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Tiny, safe Markdown: escape everything first, then add headings, bold, lists and line breaks.
  function md(text) {
    const lines = esc(text).split('\n');
    let html = '';
    let list = null;
    const close = () => {
      if (list) html += `</${list}>`;
      list = null;
    };
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
    lines.forEach((line) => {
      let m;
      if ((m = line.match(/^\s*#{1,6}\s+(.*)$/))) {
        close();
        html += `<h4>${inline(m[1])}</h4>`;
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== 'ul') {
          close();
          html += '<ul>';
          list = 'ul';
        }
        html += `<li>${inline(m[1])}</li>`;
      } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
        if (list !== 'ol') {
          close();
          html += '<ol>';
          list = 'ol';
        }
        html += `<li>${inline(m[1])}</li>`;
      } else if (!line.trim()) {
        close();
      } else {
        close();
        html += `<p>${inline(line)}</p>`;
      }
    });
    close();
    return html;
  }

  function countryOptions(selected) {
    return L.COUNTRIES.slice()
      .sort((a, b) => cname(a).localeCompare(cname(b), state.lang))
      .map((c) => `<option value="${c.code}" ${c.code === selected ? 'selected' : ''}>${cname(c)}</option>`)
      .join('');
  }

  // ---------- dashboard ----------

  const WIDGET_ICONS = {
    stats: '📈',
    next: '🎯',
    never: '🧭',
    wanted: '😍',
    everyone: '🤝',
    popular: '🔥',
    unique: '🦄',
    ask: '💬',
    rarest: '💎',
    continents: '🌐',
    recent: '🕒',
  };

  async function renderDashboard(main) {
    const s = statsFor(state.mine);
    const lv = s.lvl;
    const pct = lv.next ? Math.round(((s.xp - lv.level.xp) / (lv.next.xp - lv.level.xp)) * 100) : 100;
    main.innerHTML = `
      <section class="hero">
        <div class="hero-text">
          <h1>${t('hello', { name: esc(state.me.name) })} 👋</h1>
          <p>${t('heroLine', { n: s.visited.length, level: lv.level[state.lang] })}</p>
          <div class="hero-bar"><i style="width:${pct}%"></i></div>
          <small>${lv.next ? t('nextLevel', { n: num(lv.next.xp - s.xp), name: lv.next[state.lang] }) : t('maxLevel')}</small>
        </div>
        <div class="hero-actions">
          <a class="btn glass" href="#/map">🗺️ ${t('navMap')}</a>
          <a class="btn glass" href="#/ideas">💡 ${t('navIdeas')}</a>
          ${state.me.isAdmin ? `<button class="btn glass" id="dash-manage">⚙️ ${t('manageDash')}</button>` : ''}
        </div>
      </section>
      <div class="widgets" id="widgets"><div class="empty">…</div></div>`;
    const manage = document.getElementById('dash-manage');
    if (manage) manage.onclick = openDashSettings;

    let d;
    try {
      d = await api('GET', '/api/dashboard');
    } catch (e) {
      document.getElementById('widgets').innerHTML = `<div class="empty">${errText(e)}</div>`;
      return;
    }
    if (currentView() !== 'dash') return;
    const hidden = new Set(d.hiddenWidgets || []);
    const order = ['stats', 'next', 'wanted', 'never', 'ask', 'popular', 'everyone', 'rarest', 'unique', 'continents', 'recent'];
    const el = document.getElementById('widgets');
    el.innerHTML = order
      .filter((k) => !hidden.has(k))
      .map((k) => {
        const body = WIDGETS[k](d);
        return `<article class="widget w-${k}"><header><span class="w-icon">${WIDGET_ICONS[k]}</span><div><h3>${t('w_' + k)}</h3><small>${t('w_' + k + '_sub')}</small></div></header>${body}</article>`;
      })
      .join('');
    el.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openCountry(b.dataset.open)));
  }

  // Badges you're closest to, with what's still missing.
  function nextBadges(max) {
    const s = statsFor(state.mine);
    return s.badges
      .filter((b) => !b.done)
      .sort((a, b) => a.need - a.have - (b.need - b.have) || b.have / b.need - a.have / a.need)
      .slice(0, max);
  }

  function unitLabel(n, unit) {
    return t((n === 1 ? 'unit1_' : 'unitN_') + unit);
  }

  const WIDGETS = {
    next() {
      const list = nextBadges(3);
      if (!list.length) return `<p class="w-empty">${t('w_next_all')}</p>`;
      return `<ul class="next-list">${list
        .map((b) => {
          const left = b.need - b.have;
          const name = `<b>${b.icon} ${b[state.lang]}</b>`;
          const what =
            b.missing && b.missing.length <= 3
              ? `${t('nextMissing', { n: left, unit: unitLabel(left, b.unit), badge: name })} <span class="chips">${b.missing.map(chip).join('')}</span>`
              : t('nextCount', { n: left, unit: unitLabel(left, b.unit), badge: name });
          return `<li><div>${what}</div><div class="bar" title="${b.have}/${b.need}"><i style="width:${Math.round((b.have / b.need) * 100)}%"></i></div></li>`;
        })
        .join('')}</ul><a class="linkish" href="#/badges">${t('allBadges')} →</a>`;
    },
    stats(d) {
      const s = d.stats;
      const cell = (v, label) => `<div class="mini"><b>${v}</b><small>${label}</small></div>`;
      return `<div class="minis">
        ${cell(s.members, t('members'))}
        ${cell(`${s.countries}<span>/195</span>`, t('countries'))}
        ${cell(Math.round((s.countries / 195) * 100) + '%', t('ofWorld'))}
        ${cell(num(s.xpSum), t('xpSum'))}
        ${cell(num(s.xpUnique), t('xpUnique'))}
        ${cell('🏅 ' + s.badges, t('navBadges'))}
        ${cell('⭐ ' + s.wishes, t('dreamCountries'))}
      </div>`;
    },
    never(d) {
      const easy = d.never.slice(0, 12);
      return `<p class="big-number">${d.never.length}<small> ${t('countries')}</small></p>
        <p class="w-hint">${t('easiestFirst')}</p>
        <div class="chips">${easy.map(chip).join('')}${d.never.length > easy.length ? `<span class="chip ghost">+${d.never.length - easy.length}</span>` : ''}</div>`;
    },
    wanted(d) {
      if (!d.wanted.length) return `<p class="w-empty">${t('w_wanted_empty')}</p>`;
      return `<ol class="rank-list">${d.wanted
        .map((w) => `<li>${chip(w.code)}<span class="spacer"></span>${avatars(d.users, w.users)}<b>${w.users.length}×</b></li>`)
        .join('')}</ol>`;
    },
    everyone(d) {
      if (!d.everyone.length) return `<p class="w-empty">${t('w_everyone_empty')}</p>`;
      return `<div class="chips">${d.everyone.map(chip).join('')}</div>`;
    },
    popular(d) {
      if (!d.popular.length) return `<p class="w-empty">${t('w_popular_empty')}</p>`;
      const n = d.stats.members || 1;
      return `<ol class="rank-list">${d.popular
        .map(
          (p) => `<li>${chip(p.code)}<span class="spacer"></span>
            <span class="mini-bar"><i style="width:${Math.round((p.users.length / n) * 100)}%"></i></span><b>${p.users.length}/${n}</b></li>`
        )
        .join('')}</ol>`;
    },
    unique(d) {
      if (!d.unique.length) return `<p class="w-empty">${t('w_unique_empty')}</p>`;
      return d.unique
        .map((u) => {
          const who = userById(d.users, u.user);
          return `<div class="who-row"><span class="avatar xs" style="background:${esc(who.color)}" title="${esc(who.name)}" aria-label="${esc(who.name)}">${esc(initials(who.name))}</span><b>${esc(who.name)}</b>
            <div class="chips">${u.codes.slice(0, 8).map(chip).join('')}${u.codes.length > 8 ? `<span class="chip ghost">+${u.codes.length - 8}</span>` : ''}</div></div>`;
        })
        .join('');
    },
    ask(d) {
      if (!d.ask.length) return `<p class="w-empty">${t('w_ask_empty')}</p>`;
      return `<ul class="ask-list">${d.ask
        .map(
          (a) =>
            `<li><b>${esc(userById(d.users, a.user).name)}</b> ${t('wantsTo')} ${chip(a.code)} → ${t('askTo')} <b>${names(d.users, a.experts)}</b></li>`
        )
        .join('')}</ul>`;
    },
    rarest(d) {
      if (!d.rarest.length) return `<p class="w-empty">${t('w_rarest_empty')}</p>`;
      return `<ol class="rank-list">${d.rarest
        .map((r) => `<li>${chip(r.code)}${tierBadge(L.BY_CODE[r.code].tier)}<span class="spacer"></span>${avatars(d.users, r.users)}</li>`)
        .join('')}</ol>`;
    },
    continents(d) {
      return d.continents
        .map(
          (c) => `<div class="cont-row"><span>${L.CONTINENTS[c.key][state.lang]}</span>
            <span class="mini-bar wide"><i style="width:${Math.round((c.done / c.total) * 100)}%"></i></span><b>${c.done}/${c.total}</b></div>`
        )
        .join('');
    },
    recent(d) {
      if (!d.recent.length) return `<p class="w-empty">${t('w_recent_empty')}</p>`;
      // Ticks by the same person within an hour of each other become one (expandable) line.
      const toTime = (at) => new Date(String(at).replace(' ', 'T') + 'Z').getTime();
      const groups = [];
      d.recent.forEach((r) => {
        const last = groups[groups.length - 1];
        if (last && last.user === r.user && toTime(last.items[last.items.length - 1].at) - toTime(r.at) < 3600000) last.items.push(r);
        else groups.push({ user: r.user, items: [r] });
      });
      return `<ul class="feed">${groups
        .slice(0, 8)
        .map((g) => {
          const u = userById(d.users, g.user);
          const face = `<span class="avatar xs" style="background:${esc(u.color)}" title="${esc(u.name)}" aria-label="${esc(u.name)}">${esc(initials(u.name))}</span>`;
          const xp = L.xpFor(g.items.map((r) => r.code));
          if (g.items.length === 1) {
            const r = g.items[0];
            return `<li>${face}<span><b>${esc(u.name)}</b> ${t('wasIn')} ${chip(r.code)} <small>+${xp} XP · ${timeAgo(r.at)}</small></span></li>`;
          }
          return `<li>${face}<details class="feed-group"><summary><b>${esc(u.name)}</b> ${t('addedN', { n: g.items.length })}
            <small>+${num(xp)} XP · ${timeAgo(g.items[0].at)}</small></summary>
            <div class="chips">${g.items.map((r) => chip(r.code)).join('')}</div></details></li>`;
        })
        .join('')}</ul>`;
    },
  };

  function openDashSettings() {
    const st = state.settings;
    const hidden = new Set(st.hiddenWidgets || []);
    const m = openModal(`
      <div class="modal-head"><span style="font-size:36px">⚙️</span><div><h3>${t('manageDash')}</h3><small>${t('manageDashSub')}</small></div></div>
      <div class="check-list">${(st.widgets || Object.keys(WIDGETS))
        .map(
          (k) => `<label class="check"><input type="checkbox" data-w="${k}" ${hidden.has(k) ? '' : 'checked'}> ${WIDGET_ICONS[k]} ${t('w_' + k)}</label>`
        )
        .join('')}</div>
      <h4 style="margin:16px 0 6px">🤖 ${t('aiTitle')}</h4>
      <label class="check"><input type="checkbox" id="ai-on" ${st.aiEnabled !== false ? 'checked' : ''} ${st.aiAvailable ? '' : 'disabled'}> ${t('aiToggle')}</label>
      ${st.aiAvailable ? '' : `<p class="hint">${t('aiNoKey')}</p>`}
      <div class="error" id="ds-error"></div>
      <div class="modal-foot"><span></span><div style="display:flex;gap:8px"><button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="ds-save">${t('save')}</button></div></div>`);
    m.querySelector('#ds-save').onclick = async () => {
      const hiddenWidgets = [...m.querySelectorAll('[data-w]')].filter((c) => !c.checked).map((c) => c.dataset.w);
      try {
        const s = await api('PUT', '/api/admin/settings', { hiddenWidgets, aiEnabled: m.querySelector('#ai-on').checked });
        Object.assign(state.settings, s);
        closeModal();
        toast(t('saved'));
        render();
      } catch (e) {
        m.querySelector('#ds-error').textContent = errText(e);
      }
    };
  }

  // ---------- ideas, plans & AI ----------

  function renderIdeas(main) {
    const tab = state.ideasTab;
    main.innerHTML = `
      <div class="page-head">
        <div><h2>💡 ${t('ideasTitle')}</h2><p class="sub">${t('ideasSub')}</p></div>
        <div class="seg big">
          <button data-tab="ideas" class="${tab === 'ideas' ? 'on' : ''}">💡 ${t('tabIdeas')}</button>
          <button data-tab="plans" class="${tab === 'plans' ? 'on' : ''}">🗓️ ${t('tabPlans')}</button>
          <button data-tab="ai" class="${tab === 'ai' ? 'on' : ''}">🤖 ${t('tabAi')}</button>
        </div>
      </div>
      <div id="ideas-body"></div>`;
    main.querySelectorAll('[data-tab]').forEach(
      (b) =>
        (b.onclick = () => {
          state.ideasTab = b.dataset.tab;
          renderIdeas(main);
        })
    );
    const body = document.getElementById('ideas-body');
    ({ ideas: renderIdeaBoard, plans: renderPlans, ai: renderAi })[tab](body);
  }

  // Starter suggestions for empty Ideas / Plans, based on the family's wishlists.
  async function familyHints() {
    if (state.dashCache && Date.now() - state.dashCache.at < 5 * 60000) return state.dashCache.data;
    try {
      const data = await api('GET', '/api/dashboard');
      state.dashCache = { at: Date.now(), data };
      return data;
    } catch (e) {
      return null;
    }
  }

  async function starterIdeas() {
    const d = await familyHints();
    const out = [];
    if (d) {
      const firstName = (id) => userById(d.users, id).name.split(' ')[0];
      d.wanted.slice(0, 1).forEach((w) => out.push({ text: t('sugGoTo', { country: cname(L.BY_CODE[w.code]), n: w.users.length }), country: w.code }));
      d.ask.slice(0, 1).forEach((a) => out.push({ text: t('sugAskTips', { country: cname(L.BY_CODE[a.code]), name: firstName(a.experts[0]) }), country: a.code }));
      const easy = d.never.find((c) => L.BY_CODE[c].tier === 1);
      if (easy) out.push({ text: t('sugWeekend', { country: cname(L.BY_CODE[easy]) }), country: easy });
    }
    if (out.length < 3) out.push({ text: t('sugSummer'), country: '' });
    return out.slice(0, 3);
  }

  async function renderIdeaBoard(body) {
    body.innerHTML = `
      <form class="card composer" id="idea-form">
        <textarea name="text" rows="2" maxlength="500" placeholder="${t('ideaPlaceholder')}" required></textarea>
        <div class="composer-row">
          <select name="country"><option value="">🌍 ${t('ideaCountry')}</option>${countryOptions('')}</select>
          <button class="btn primary" type="submit">${t('share')}</button>
        </div>
      </form>
      <div id="idea-list" class="idea-list"><div class="empty">…</div></div>`;
    const list = document.getElementById('idea-list');
    const draw = (ideas) => {
      if (currentView() !== 'ideas' || !document.getElementById('idea-list')) return;
      list.innerHTML = ideas.length
        ? ideas
            .map(
              (i) => `<article class="idea">
          <button class="vote ${i.mine ? 'on' : ''}" data-vote="${i.id}" title="${t('vote')}" aria-label="${t('vote')} (${i.votes})" aria-pressed="${i.mine}">👍<b>${i.votes}</b></button>
          <div class="idea-body">
            <p>${esc(i.text)}</p>
            <footer>
              <span class="avatar xs" style="background:${esc(i.color)}" title="${esc(i.name)}" aria-label="${esc(i.name)}">${esc(initials(i.name))}</span>
              <span>${esc(i.name)} · ${timeAgo(i.createdAt)}</span>
              ${i.country ? chip(i.country) : ''}
              ${i.user === state.me.id || state.me.isAdmin ? `<button class="linkish danger" data-del-idea="${i.id}">${t('remove')}</button>` : ''}
            </footer>
          </div>
        </article>`
            )
            .join('')
        : `<div class="card empty-start"><p><b>${t('ideasEmpty')}</b></p><p class="sub">${t('startHint')}</p><div class="starter" id="idea-starters">…</div></div>`;
      if (!ideas.length)
        starterIdeas().then((sugs) => {
          const box = document.getElementById('idea-starters');
          if (!box) return;
          box.innerHTML = sugs.map((s, i) => `<button class="btn starter-btn" data-starter="${i}">💡 ${esc(s.text)}</button>`).join('');
          box.querySelectorAll('[data-starter]').forEach(
            (b) =>
              (b.onclick = () => {
                const s = sugs[Number(b.dataset.starter)];
                const form = document.getElementById('idea-form');
                form.text.value = s.text;
                form.country.value = s.country;
                form.text.focus();
              })
          );
        });
      list.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openCountry(b.dataset.open)));
      list.querySelectorAll('[data-vote]').forEach((b) => (b.onclick = async () => draw((await api('POST', `/api/ideas/${b.dataset.vote}/vote`)).ideas)));
      list.querySelectorAll('[data-del-idea]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (!confirm(t('confirmRemove'))) return;
            draw((await api('DELETE', `/api/ideas/${b.dataset.delIdea}`)).ideas);
          })
      );
    };
    document.getElementById('idea-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target));
      try {
        draw((await api('POST', '/api/ideas', fd)).ideas);
        ev.target.reset();
        toast('💡 ' + t('ideaShared'));
      } catch (e) {
        toast(errText(e));
      }
    };
    try {
      draw((await api('GET', '/api/ideas')).ideas);
    } catch (e) {
      list.innerHTML = `<div class="empty">${errText(e)}</div>`;
    }
  }

  async function renderPlans(body) {
    body.innerHTML = `
      <details class="card composer" id="plan-new">
        <summary><b>➕ ${t('newPlan')}</b></summary>
        <form id="plan-form">
          <label class="field"><span>${t('planTitle')}</span><input name="title" maxlength="120" required placeholder="${t('planTitlePh')}"></label>
          <label class="field"><span>${t('planCountry')}</span><select name="country"><option value="">—</option>${countryOptions('')}</select></label>
          <label class="field"><span>${t('planBody')}</span><textarea name="body" rows="7" required placeholder="${t('planBodyPh')}"></textarea></label>
          <button class="btn primary" type="submit">${t('save')}</button>
        </form>
      </details>
      <div id="plan-list" class="plan-list"><div class="empty">…</div></div>`;
    const list = document.getElementById('plan-list');
    const draw = (plans) => {
      if (!document.getElementById('plan-list')) return;
      list.innerHTML = plans.length
        ? plans
            .map(
              (p) => `<details class="plan card">
          <summary>
            <div class="plan-head">
              <h3>${esc(p.title)}</h3>
              <small><span class="avatar xs" style="background:${esc(p.color)}" title="${esc(p.name)}" aria-label="${esc(p.name)}">${esc(initials(p.name))}</span> ${esc(p.name)} · ${timeAgo(p.createdAt)}</small>
            </div>
            <div class="chips">${p.countries.map(chip).join('')}</div>
          </summary>
          <div class="md">${md(p.body)}</div>
          ${p.user === state.me.id || state.me.isAdmin ? `<button class="btn small danger" data-del-plan="${p.id}">${t('remove')}</button>` : ''}
        </details>`
            )
            .join('')
        : `<div class="card empty-start"><p><b>${t('plansEmpty')}</b></p><p class="sub">${t('startHint')}</p><div class="starter" id="plan-starters">…</div></div>`;
      if (!plans.length)
        familyHints().then((d) => {
          const box = document.getElementById('plan-starters');
          if (!box) return;
          const codes = d && d.wanted.length ? d.wanted.slice(0, 2).map((w) => w.code) : [];
          box.innerHTML =
            codes.map((c) => `<button class="btn starter-btn" data-plan-for="${c}">🗓️ ${esc(t('planFor', { country: cname(L.BY_CODE[c]) }))}</button>`).join('') +
            `<button class="btn starter-btn" data-plan-ai="${codes[0] || ''}">🤖 ${t('planWithAi')}</button>`;
          box.querySelectorAll('[data-plan-for]').forEach(
            (b) =>
              (b.onclick = () => {
                const c = b.dataset.planFor;
                const form = document.getElementById('plan-form');
                document.getElementById('plan-new').open = true;
                form.title.value = t('planFor', { country: cname(L.BY_CODE[c]) });
                form.country.value = c;
                form.body.value = t('planTemplate');
                form.title.focus();
              })
          );
          box.querySelector('[data-plan-ai]').onclick = (e) => {
            const c = e.currentTarget.dataset.planAi;
            state.aiPrefill = c ? t('aiPlanFor', { country: cname(L.BY_CODE[c]) }) : t('aiSug1');
            state.ideasTab = 'ai';
            renderIdeas(document.getElementById('main'));
          };
        });
      list.querySelectorAll('[data-open]').forEach(
        (b) =>
          (b.onclick = (e) => {
            e.preventDefault();
            openCountry(b.dataset.open);
          })
      );
      list.querySelectorAll('[data-del-plan]').forEach(
        (b) =>
          (b.onclick = async () => {
            if (!confirm(t('confirmRemove'))) return;
            draw((await api('DELETE', `/api/plans/${b.dataset.delPlan}`)).plans);
          })
      );
    };
    document.getElementById('plan-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = Object.fromEntries(new FormData(ev.target));
      try {
        draw((await api('POST', '/api/plans', { title: fd.title, body: fd.body, countries: fd.country ? [fd.country] : [] })).plans);
        ev.target.reset();
        document.getElementById('plan-new').open = false;
        toast('🗓️ ' + t('planSaved'));
      } catch (e) {
        toast(errText(e));
      }
    };
    try {
      draw((await api('GET', '/api/plans')).plans);
    } catch (e) {
      list.innerHTML = `<div class="empty">${errText(e)}</div>`;
    }
  }

  function renderAi(body) {
    const st = state.settings;
    if (!st.aiAvailable || st.aiEnabled === false) return renderFreeAi(body);
    const suggestions = [t('aiSug1'), t('aiSug2'), t('aiSug3'), t('aiSug4')];
    body.innerHTML = `
      <div class="card chat">
        <div class="chat-log" id="chat-log"></div>
        <div class="chat-sugs" id="chat-sugs">${suggestions.map((s) => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <form class="chat-input" id="chat-form">
          <textarea name="q" rows="1" maxlength="2000" placeholder="${t('aiPlaceholder')}"></textarea>
          <button class="btn primary" type="submit" id="chat-send">➤</button>
        </form>
        <div class="chat-foot"><small>${t('aiFoot')}</small>${state.aiChat.length ? `<button class="linkish" id="chat-clear">${t('aiClear')}</button>` : ''}</div>
      </div>`;
    const log = document.getElementById('chat-log');
    const draw = () => {
      log.innerHTML = state.aiChat.length
        ? state.aiChat
            .map((m, i) =>
              m.role === 'user'
                ? `<div class="msg me"><div class="bubble">${esc(m.content)}</div></div>`
                : `<div class="msg ai"><span class="ai-face">🤖</span><div class="bubble md">${md(m.content)}
                    <div class="msg-actions"><button class="linkish" data-save-plan="${i}">🗓️ ${t('saveAsPlan')}</button><button class="linkish" data-share-idea="${i}">💡 ${t('shareAsIdea')}</button></div></div></div>`
            )
            .join('') + (state.aiBusy ? `<div class="msg ai"><span class="ai-face">🤖</span><div class="bubble typing"><i></i><i></i><i></i></div></div>` : '')
        : `<div class="chat-hello"><div style="font-size:44px">🤖</div><p>${t('aiHello', { name: esc(state.me.name) })}</p></div>`;
      log.scrollTop = log.scrollHeight;
      document.getElementById('chat-sugs').hidden = state.aiChat.length > 0;
      log.querySelectorAll('[data-save-plan]').forEach((b) => (b.onclick = () => saveReplyAsPlan(Number(b.dataset.savePlan))));
      log.querySelectorAll('[data-share-idea]').forEach((b) => (b.onclick = () => shareReplyAsIdea(Number(b.dataset.shareIdea))));
    };
    const send = async (q) => {
      q = q.trim();
      if (!q || state.aiBusy) return;
      state.aiChat.push({ role: 'user', content: q });
      state.aiBusy = true;
      draw();
      try {
        const r = await api('POST', '/api/ai/chat', { messages: state.aiChat });
        state.aiChat.push({ role: 'assistant', content: r.reply });
      } catch (e) {
        state.aiChat.pop();
        toast(errText(e));
      }
      state.aiBusy = false;
      if (currentView() === 'ideas' && state.ideasTab === 'ai' && document.getElementById('chat-log')) renderAi(body);
    };
    const form = document.getElementById('chat-form');
    const ta = form.querySelector('textarea');
    if (state.aiPrefill) {
      ta.value = state.aiPrefill;
      state.aiPrefill = null;
      ta.focus();
    }
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      const q = ta.value;
      ta.value = '';
      send(q);
    };
    body.querySelectorAll('[data-sug]').forEach((b) => (b.onclick = () => send(b.dataset.sug)));
    const clear = document.getElementById('chat-clear');
    if (clear)
      clear.onclick = () => {
        state.aiChat = [];
        renderAi(body);
      };
    draw();
  }

  // Free mode: build the question with all family data, copy it and open claude.ai.
  // The family pastes Claude's answer back to save it as a plan or idea.
  function renderFreeAi(body) {
    const suggestions = [t('aiSug1'), t('aiSug2'), t('aiSug3'), t('aiSug4')];
    let base = null;
    api('GET', '/api/ai/prompt')
      .then((r) => (base = r.prompt))
      .catch(() => {});
    body.innerHTML = `
      <div class="card free-ai">
        <div class="free-head"><span class="w-icon">🤖</span><div><h3>${t('freeAiTitle')}</h3><small>${t('freeAiSub')}</small></div></div>
        <ol class="steps"><li>${t('freeStep1')}</li><li>${t('freeStep2')}</li><li>${t('freeStep3')}</li></ol>
        <div class="chips" style="margin-bottom:10px">${suggestions.map((s) => `<button class="chip" data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        <textarea id="free-q" rows="3" maxlength="2000" placeholder="${t('aiPlaceholder')}"></textarea>
        <div class="composer-row" style="margin-top:10px">
          <button class="btn primary" id="free-go">📋 ${t('freeGo')}</button>
        </div>
        <textarea id="free-fallback" rows="6" readonly hidden></textarea>
      </div>
      <div class="card free-ai">
        <div class="free-head"><span class="w-icon">📥</span><div><h3>${t('freeBackTitle')}</h3><small>${t('freeBackSub')}</small></div></div>
        <label class="field"><span>${t('planTitle')}</span><input id="free-title" maxlength="120" placeholder="${t('planTitlePh')}"></label>
        <textarea id="free-answer" rows="8" placeholder="${t('freePastePh')}"></textarea>
        <div class="composer-row" style="margin-top:10px;flex-wrap:wrap">
          <button class="btn primary" id="free-plan">🗓️ ${t('saveAsPlan')}</button>
          <button class="btn" id="free-idea">💡 ${t('shareAsIdea')}</button>
        </div>
      </div>
      ${state.me.isAdmin && !state.settings.aiAvailable ? `<p class="hint">💡 ${t('freeAdminHint')}</p>` : ''}`;
    const q = document.getElementById('free-q');
    if (state.aiPrefill) {
      q.value = state.aiPrefill;
      state.aiPrefill = null;
    }
    body.querySelectorAll('[data-sug]').forEach(
      (b) =>
        (b.onclick = () => {
          q.value = b.dataset.sug;
          q.focus();
        })
    );
    document.getElementById('free-go').onclick = async () => {
      const question = q.value.trim();
      if (!question) return toast(t('err_text_required'));
      if (!document.getElementById('free-title').value) document.getElementById('free-title').value = question.slice(0, 80);
      const full = (base || '') + question;
      // Open the tab right away (inside the click) so popup blockers allow it.
      const url = full.length < 6000 ? 'https://claude.ai/new?q=' + encodeURIComponent(full) : 'https://claude.ai/new';
      window.open(url, '_blank', 'noopener');
      try {
        await navigator.clipboard.writeText(full);
        toast('📋 ' + t('freeCopied'));
      } catch (e) {
        const fb = document.getElementById('free-fallback');
        fb.hidden = false;
        fb.value = full;
        fb.select();
        toast(t('freeCopyManual'));
      }
    };
    const answer = () => document.getElementById('free-answer').value.trim();
    document.getElementById('free-plan').onclick = async () => {
      const text = answer();
      const title = document.getElementById('free-title').value.trim() || q.value.trim().slice(0, 80);
      if (!text || !title) return toast(t('err_text_required'));
      try {
        await api('POST', '/api/plans', { title, body: text, countries: mentionedCountries(text) });
        toast('🗓️ ' + t('planSaved'));
        document.getElementById('free-answer').value = '';
      } catch (e) {
        toast(errText(e));
      }
    };
    document.getElementById('free-idea').onclick = async () => {
      const text = answer();
      if (!text) return toast(t('err_text_required'));
      const first = text
        .split('\n')
        .map((l) => l.replace(/[#*\-•]/g, '').trim())
        .find((l) => l.length > 10);
      const idea = prompt(t('ideaPlaceholder'), (first || text).slice(0, 200));
      if (!idea) return;
      try {
        await api('POST', '/api/ideas', { text: idea, country: mentionedCountries(text)[0] || '' });
        toast('💡 ' + t('ideaShared'));
      } catch (e) {
        toast(errText(e));
      }
    };
  }

  // The question that led to an AI answer makes a good plan title.
  function questionBefore(i) {
    for (let j = i - 1; j >= 0; j--) if (state.aiChat[j].role === 'user') return state.aiChat[j].content;
    return t('tabAi');
  }

  function mentionedCountries(text) {
    const lower = text.toLowerCase();
    return L.COUNTRIES.filter((c) => lower.includes(c.nl.toLowerCase()) || lower.includes(c.en.toLowerCase()))
      .map((c) => c.code)
      .filter((c) => c !== L.HOME)
      .slice(0, 8);
  }

  async function saveReplyAsPlan(i) {
    const reply = state.aiChat[i].content;
    const title = prompt(t('planTitle'), questionBefore(i).slice(0, 80));
    if (!title) return;
    try {
      await api('POST', '/api/plans', { title, body: reply, countries: mentionedCountries(reply) });
      toast('🗓️ ' + t('planSaved'));
    } catch (e) {
      toast(errText(e));
    }
  }

  async function shareReplyAsIdea(i) {
    const reply = state.aiChat[i].content;
    const first = reply
      .split('\n')
      .map((l) => l.replace(/[#*\-•]/g, '').trim())
      .find((l) => l.length > 10);
    const text = prompt(t('ideaPlaceholder'), (first || questionBefore(i)).slice(0, 200));
    if (!text) return;
    try {
      await api('POST', '/api/ideas', { text, country: mentionedCountries(reply)[0] || '' });
      toast('💡 ' + t('ideaShared'));
    } catch (e) {
      toast(errText(e));
    }
  }

  // ---------- timeline ----------

  // Year of a trip: the travel year if someone filled it in, otherwise the year it was ticked.
  const tripYear = (i) => i.year || (i.visitedAt ? Number(i.visitedAt.slice(0, 4)) : null);

  async function renderTimeline(main) {
    main.innerHTML = `
      <div class="page-head">
        <div><h2>🕒 ${t('timelineTitle')}</h2><p class="sub">${t('timelineSub')}</p></div>
        <label class="tl-filter">${t('timelineWho')}
          <select id="tl-who"><option value="">${t('everyone')}</option>${state.people
            .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
            .join('')}</select></label>
      </div>
      <div id="tl-body"><div class="empty">…</div></div>`;
    let data;
    try {
      data = await api('GET', '/api/timeline');
    } catch (e) {
      document.getElementById('tl-body').innerHTML = `<div class="empty">${errText(e)}</div>`;
      return;
    }
    if (currentView() !== 'timeline') return;
    const sel = document.getElementById('tl-who');
    const body = document.getElementById('tl-body');
    const draw = () => {
      const who = Number(sel.value) || null;
      const items = data.items.filter((i) => !who || i.user === who);
      const byYear = new Map();
      items.forEach((i) => {
        const y = tripYear(i) || 'none';
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(i);
      });
      const years = [...byYear.keys()].sort((a, b) => (a === 'none' ? 1 : b === 'none' ? -1 : b - a));
      if (!years.length) {
        body.innerHTML = `<div class="card empty">${t('timelineEmpty')}</div>`;
        return;
      }
      body.innerHTML = `<ol class="timeline">${years
        .map((y) => {
          const list = byYear.get(y);
          const perUser = new Map();
          list.forEach((i) => {
            if (!perUser.has(i.user)) perUser.set(i.user, []);
            perUser.get(i.user).push(i);
          });
          return `<li class="tl-year">
            <div class="tl-dot" aria-hidden="true"></div>
            <h3>${y === 'none' ? t('noDate') : y} <small>${t(list.length === 1 ? 'countries1' : 'countriesN', { n: list.length })} · +${num(L.xpFor(list.map((i) => i.code)))} XP</small></h3>
            ${[...perUser.entries()]
              .map(([uid, trips]) => {
                const u = userById(data.users, uid);
                return `<div class="tl-person">
                  <span class="avatar xs" style="background:${esc(u.color)}" title="${esc(u.name)}" aria-label="${esc(u.name)}">${esc(initials(u.name))}</span>
                  <b>${esc(u.name)}</b><small>${trips.length}</small>
                  <div class="chips">${trips
                    .map((i) => {
                      const ticked = i.visitedAt ? t('tickedOn', { date: new Date(i.visitedAt.replace(' ', 'T') + 'Z').toLocaleDateString(state.lang === 'nl' ? 'nl-NL' : 'en-GB') }) : '';
                      return `<button class="chip" data-open="${i.code}" title="${esc(ticked)}">${flag(i.code, 'sm')}${cname(L.BY_CODE[i.code])}</button>`;
                    })
                    .join('')}</div>
                </div>`;
              })
              .join('')}
          </li>`;
        })
        .join('')}</ol>
        <p class="hint">📅 ${t('timelineHint')}</p>`;
      body.querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => openCountry(b.dataset.open)));
    };
    sel.onchange = draw;
    draw();
  }

  // ---------- leaderboard ----------

  async function renderRanking(main) {
    main.innerHTML = `<h2>${t('rankingTitle')}</h2><p class="sub">&nbsp;</p><div id="lb"></div>`;
    let board;
    try {
      board = (await api('GET', '/api/leaderboard')).board;
    } catch (e) {
      main.querySelector('#lb').innerHTML = `<div class="empty">${errText(e)}</div>`;
      return;
    }
    if (currentView() !== 'ranking') return;
    const medals = ['🥇', '🥈', '🥉'];
    main.querySelector('#lb').innerHTML = board.length
      ? board
          .map((u, i) => {
            const lvl = L.levelFor(u.xp);
            return `<div class="lb-row ${u.id === state.me.id ? 'me' : ''}">
          <div class="medal">${medals[i] || i + 1}</div>
          <span class="avatar" style="background:${esc(u.color)};cursor:default" title="${esc(u.name)}" aria-label="${esc(u.name)}">${esc(initials(u.name))}</span>
          <div class="who"><b>${esc(u.name)}${u.id === state.me.id ? ` <span class="pill">${t('you')}</span>` : ''}</b>
            <small>${t('level')} ${lvl.index} · ${lvl.level[state.lang]} · ${u.visited} ${t('countries')} · 🏅 ${u.badges} · ⭐ ${u.wish}</small>
            <div class="bar"><i style="width:${Math.round((u.visited / 195) * 100)}%;background:${esc(u.color)}"></i></div></div>
          <div class="score">${num(u.xp)} XP<small>${Math.round((u.visited / 195) * 100)}% ${t('ofWorld')}</small></div>
        </div>`;
          })
          .join('')
      : `<div class="empty">${t('rankingEmpty')}</div>`;
  }

  // ---------- admin ----------

  function renderAdmin(main) {
    const users = state.adminUsers;
    if (!users) {
      main.innerHTML = `<div class="empty">…</div>`;
      loadAdminUsers();
      return;
    }
    const totals = L.familyTotals(users.map((u) => u.countries.filter((r) => r.status === 'visited').map((r) => r.code)));
    main.innerHTML = `
      <h2>👑 ${t('adminTitle')}</h2><p class="sub">${t('adminSub')}</p>
      <div class="stats">
        <div class="stat"><div class="label">${t('totalFamily')}</div><div class="value">${totals.countries}</div><div class="extra">${t('uniqueCountries')} · ${Math.round((totals.countries / 195) * 100)}% ${t('ofWorld')}</div></div>
        <div class="stat"><div class="label">${t('xpSum')}</div><div class="value">${num(totals.xpSum)}</div><div class="extra">${t('xpSumHint')}</div></div>
        <div class="stat"><div class="label">${t('xpUnique')}</div><div class="value">${num(totals.xpUnique)}</div><div class="extra">${t('xpUniqueHint')}</div></div>
      </div>
      <div class="card table-wrap"><table>
        <thead><tr><th>${t('name')}</th><th>${t('visited')}</th><th>⭐</th><th>XP</th><th>${t('level')}</th><th>${t('joined')}</th><th></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
            <td><div style="display:flex;align-items:center;gap:8px"><span class="avatar sm" style="background:${esc(u.color)}" title="${esc(u.name)}" aria-label="${esc(u.name)}">${esc(initials(u.name))}</span>
              <div><b>${esc(u.name)}</b>${u.isAdmin ? `<span class="pill">${t('host')}</span>` : ''}<br><small style="color:var(--muted)">${esc(u.email)}</small>
              <div class="flags-strip">${u.countries
                .filter((r) => r.status === 'visited')
                .map((r) => `<img src="/flags/${r.code.toLowerCase()}.svg" title="${esc(cname(L.BY_CODE[r.code]))}" alt="${r.code}" loading="lazy">`)
                .join('')}</div></div></div></td>
            <td>${u.visited}</td><td>${u.wish}</td><td><b>${num(u.xp)}</b></td><td>${u.level}</td>
            <td>${esc((u.createdAt || '').slice(0, 10))}</td>
            <td>
              <button class="btn small" data-view="${u.id}">🗺️ ${t('viewMap')}</button>
              ${
                u.id !== state.me.id
                  ? `<button class="btn small" data-reset="${u.id}">🔑 ${t('resetPassword')}</button>
                     <button class="btn small" data-admin="${u.id}" data-to="${u.isAdmin ? 0 : 1}">${u.isAdmin ? t('removeAdmin') : t('makeAdmin')}</button>
                     <button class="btn small danger" data-del="${u.id}">${t('deleteUser')}</button>`
                  : ''
              }
            </td></tr>`
          )
          .join('')}</tbody></table></div>`;

    const byId = (id) => users.find((u) => u.id === Number(id));
    main.querySelectorAll('[data-view]').forEach(
      (b) =>
        (b.onclick = () => {
          const id = Number(b.dataset.view);
          state.viewingId = id === state.me.id ? null : id;
          location.hash = '#/map';
        })
    );
    main.querySelectorAll('[data-reset]').forEach(
      (b) =>
        (b.onclick = async () => {
          const u = byId(b.dataset.reset);
          if (!confirm(t('confirmReset', { name: u.name }))) return;
          const { password } = await api('POST', `/api/admin/users/${u.id}/reset-password`);
          alert(t('tempPassword', { name: u.name, pw: password }));
        })
    );
    main.querySelectorAll('[data-admin]').forEach(
      (b) =>
        (b.onclick = async () => {
          await api('POST', `/api/admin/users/${b.dataset.admin}/admin`, { isAdmin: b.dataset.to === '1' });
          loadAdminUsers();
        })
    );
    main.querySelectorAll('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          const u = byId(b.dataset.del);
          const ok = await confirmModal({
            icon: '🗑️',
            title: t('deleteTitle', { name: esc(u.name) }),
            text: t('deleteText', { name: `<b>${esc(u.name)}</b>`, n: u.visited }),
            confirmLabel: t('deleteConfirm', { name: esc(u.name) }),
          });
          if (!ok) return;
          await api('DELETE', `/api/admin/users/${u.id}`);
          if (state.viewingId === u.id) state.viewingId = null;
          loadPeople();
          loadAdminUsers();
        })
    );
  }

  // ---------- profile ----------

  function openProfile() {
    let color = state.me.color;
    // Colours are unique per family member: show who already has which one.
    const takenBy = {};
    state.people.forEach((p) => {
      if (p.id !== state.me.id) takenBy[String(p.color).toLowerCase()] = p.name;
    });
    const m = openModal(`
      <div class="modal-head"><span class="avatar" id="p-avatar" style="background:${esc(color)};width:52px;height:52px;font-size:22px" title="${esc(state.me.name)}">${esc(initials(state.me.name))}</span>
        <div><h3>${t('profile')}</h3><small>${esc(state.me.email)}</small></div></div>
      <label class="field"><span>${t('name')}</span><input name="name" value="${esc(state.me.name)}" maxlength="40"></label>
      <div class="field"><span>${t('yourColor')}</span></div>
      <div class="color-row">${PRESET_COLORS.map((c) => {
        const who = takenBy[c.toLowerCase()];
        return `<button type="button" data-color="${c}" style="background:${c}" class="${c === color ? 'on' : ''} ${who ? 'taken' : ''}"
          ${who ? 'disabled' : ''} title="${who ? esc(t('colorTaken', { name: who })) : c}" aria-label="${who ? esc(t('colorTaken', { name: who })) : c}"></button>`;
      }).join('')}
        <input type="color" id="p-custom" value="${esc(color)}" title="…"></div>
      <details style="margin-bottom:12px"><summary style="cursor:pointer;font-weight:600">${t('changePassword')}</summary>
        <label class="field" style="margin-top:10px"><span>${t('currentPassword')}</span><input name="cur" type="password" autocomplete="current-password"></label>
        <label class="field"><span>${t('newPassword')}</span><input name="new" type="password" autocomplete="new-password" minlength="8"></label>
      </details>
      <div class="error" id="p-error"></div>
      <div class="modal-foot">
        <button class="btn danger" id="p-logout">${t('logout')}</button>
        <div style="display:flex;gap:8px"><button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="p-save">${t('save')}</button></div>
      </div>`);

    const pick = (c) => {
      color = c;
      m.querySelector('#p-avatar').style.background = c;
      m.querySelectorAll('[data-color]').forEach((b) => b.classList.toggle('on', b.dataset.color === c));
    };
    m.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => pick(b.dataset.color)));
    m.querySelector('#p-custom').oninput = (e) => pick(e.target.value);
    m.querySelector('#p-logout').onclick = async () => {
      await api('POST', '/api/logout').catch(() => {});
      state.me = null;
      state.mine = new Map();
      state.adminUsers = null;
      state.viewingId = null;
      state.authMode = 'login';
      closeModal();
      render();
    };
    m.querySelector('#p-save').onclick = async () => {
      const body = { name: m.querySelector('[name=name]').value, color };
      const cur = m.querySelector('[name=cur]').value;
      const nw = m.querySelector('[name=new]').value;
      if (nw) Object.assign(body, { currentPassword: cur, newPassword: nw });
      try {
        state.me = (await api('PATCH', '/api/me', body)).user;
        await loadPeople();
        closeModal();
        toast(t('saved'));
        if (state.me.isAdmin) loadAdminUsers();
        render();
      } catch (e) {
        m.querySelector('#p-error').textContent = errText(e);
      }
    };
  }

  boot();
})();
