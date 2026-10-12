(function () {
  'use strict';

  const L = window.LANDEN;
  const PRESET_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0f766e', '#000000'];
  const VIEWS = ['map', 'list', 'wish', 'ranking', 'admin'];
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
  const tierBadge = (tier) => `<span class="tier-badge" style="background:${L.TIERS[tier].color}">${t('tier')} ${tier} · ${L.TIERS[tier][state.lang]}</span>`;
  const initials = (name) => (name || '?').trim().charAt(0).toUpperCase();

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
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
    return { visited, wish, xp, lvl: L.levelFor(xp) };
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
    if (v === 'admin' && !(state.me && state.me.isAdmin)) return 'map';
    return VIEWS.includes(v) ? v : 'map';
  }

  window.addEventListener('hashchange', render);

  // ---------- boot ----------

  async function boot() {
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

  function onLoggedIn(data) {
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
    ({ map: renderMap, list: renderList, wish: renderWish, ranking: renderRanking, admin: renderAdmin })[view](main);
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
      ['map', '🗺️ ' + t('navMap')],
      ['list', '🏆 ' + t('navList')],
      ['wish', '⭐ ' + t('navWish')],
      ['ranking', '👨‍👩‍👧‍👦 ' + t('navRanking')],
    ];
    if (state.me.isAdmin) links.push(['admin', '👑 ' + t('navAdmin')]);
    return `
      <header class="topbar"><div class="topbar-inner">
        <div class="logo">🌍 ${t('appName')}</div>
        <nav class="nav">${links.map(([k, label]) => `<a href="#/${k}" class="${k === view ? 'active' : ''}">${label}</a>`).join('')}</nav>
        <div class="top-right">
          <span class="pill" title="${t('xp')}">Lv ${s.lvl.index} · ${num(s.xp)} XP</span>
          ${langToggle()}
          <button class="avatar" id="profile-btn" style="background:${esc(state.me.color)}" title="${t('profile')}">${esc(initials(state.me.name))}</button>
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
      <div class="stat"><div class="label">${t('navWish')}</div>
        <div class="value">⭐ ${s.wish}</div>
        <div class="extra">${t('countries')}</div></div>
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
          </div>
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
          <div class="map-loading" id="map-loading">${t('mapLoading')}</div>
          <div class="zoom-btns">
            <button data-zoom="in" title="${t('zoomIn')}">+</button>
            <button data-zoom="out" title="${t('zoomOut')}">−</button>
            <button data-zoom="reset" title="${t('zoomReset')}">⟲</button>
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
        paintMap();
      })
    );
    const sel = document.getElementById('map-user');
    if (sel)
      sel.onchange = () => {
        const id = Number(sel.value);
        state.viewingId = id === state.me.id ? null : id;
        render();
      };
    main.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => zoomBy(b.dataset.zoom)));

    renderContinents(v.map);
    ensureMap().then(() => {
      const wrap = document.getElementById('map-wrap');
      if (!wrap) return;
      const loading = document.getElementById('map-loading');
      if (loading) loading.remove();
      if (mapState.node.parentNode === wrap) return paintMap();
      wrap.insertBefore(mapState.node, wrap.firstChild);
      paintMap();
    });
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

  function ensureMap() {
    if (mapState.loaded) return Promise.resolve();
    if (mapState.loading) return mapState.loading;
    mapState.loading = fetch('/data/world.json')
      .then((r) => r.json())
      .then(buildMap);
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
      if (v.area < 6) tiny.push({ code, country: L.BY_CODE[code], xy: path.centroid(v.feature) });
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

  function fillFor(code, map, color) {
    const row = map.get(code);
    const c = L.BY_CODE[code];
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
    if (state.mapMode === 'tier') {
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
    const status = row ? (row.status === 'visited' ? '✅ ' + t('visited') + (row.year ? ' (' + row.year + ')' : '') : '⭐ ' + t('wish')) : t('notVisited');
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
    let status = row ? row.status : null;

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
      <div class="choice">
        <button class="btn" data-status="visited">✅ ${t('visited')}<small>+${c.xp} XP</small></button>
        <button class="btn" data-status="wish">⭐ ${t('wish')}<small>${t('navWish')}</small></button>
      </div>
      <label class="field"><span>${t('year')}</span><input name="year" type="number" min="1900" max="2100" inputmode="numeric" value="${row && row.year ? row.year : ''}"></label>
      <label class="field"><span>${t('note')}</span><textarea name="note" rows="3" maxlength="500" placeholder="${t('notePlaceholder')}">${row && row.note ? esc(row.note) : ''}</textarea></label>
      <div class="error" id="c-error"></div>
      <div class="modal-foot">
        ${row ? `<button class="btn danger" id="c-remove">${t('remove')}</button>` : '<span></span>'}
        <div style="display:flex;gap:8px"><button class="btn" data-close>${t('cancel')}</button><button class="btn primary" id="c-save">${t('save')}</button></div>
      </div>`);

    const btns = m.querySelectorAll('[data-status]');
    const paint = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
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
          : `<div class="actions">
        <button class="icon-btn ${st === 'visited' ? 'on-visited' : ''}" data-toggle="visited" data-code="${c.code}" title="${t('visited')}">✓</button>
        <button class="icon-btn ${st === 'wish' ? 'on-wish' : ''}" data-toggle="wish" data-code="${c.code}" title="${t('wish')}">★</button>
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
          <span class="avatar" style="background:${esc(u.color)};cursor:default">${esc(initials(u.name))}</span>
          <div class="who"><b>${esc(u.name)}${u.id === state.me.id ? ` <span class="pill">${t('you')}</span>` : ''}</b>
            <small>${t('level')} ${lvl.index} · ${lvl.level[state.lang]} · ${u.visited} ${t('countries')} · ⭐ ${u.wish}</small>
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
    const union = new Set();
    users.forEach((u) => u.countries.forEach((r) => r.status === 'visited' && union.add(r.code)));
    main.innerHTML = `
      <h2>👑 ${t('adminTitle')}</h2><p class="sub">${t('adminSub')}</p>
      <div class="stats">
        <div class="stat"><div class="label">${t('totalFamily')}</div><div class="value">${union.size}</div><div class="extra">${t('uniqueCountries')}</div></div>
        <div class="stat"><div class="label">${t('xp')}</div><div class="value">${num(L.xpFor([...union]))}</div><div class="extra">${Math.round((union.size / 195) * 100)}% ${t('ofWorld')}</div></div>
      </div>
      <div class="card table-wrap"><table>
        <thead><tr><th>${t('name')}</th><th>${t('visited')}</th><th>⭐</th><th>XP</th><th>${t('level')}</th><th>${t('joined')}</th><th></th></tr></thead>
        <tbody>${users
          .map(
            (u) => `<tr>
            <td><div style="display:flex;align-items:center;gap:8px"><span class="avatar sm" style="background:${esc(u.color)}">${esc(initials(u.name))}</span>
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
          if (!confirm(t('confirmDelete', { name: u.name }))) return;
          await api('DELETE', `/api/admin/users/${u.id}`);
          if (state.viewingId === u.id) state.viewingId = null;
          loadAdminUsers();
        })
    );
  }

  // ---------- profile ----------

  function openProfile() {
    let color = state.me.color;
    const m = openModal(`
      <div class="modal-head"><span class="avatar" id="p-avatar" style="background:${esc(color)};width:52px;height:52px;font-size:22px">${esc(initials(state.me.name))}</span>
        <div><h3>${t('profile')}</h3><small>${esc(state.me.email)}</small></div></div>
      <label class="field"><span>${t('name')}</span><input name="name" value="${esc(state.me.name)}" maxlength="40"></label>
      <div class="field"><span>${t('yourColor')}</span></div>
      <div class="color-row">${PRESET_COLORS.map((c) => `<button type="button" data-color="${c}" style="background:${c}" class="${c === color ? 'on' : ''}"></button>`).join('')}
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
