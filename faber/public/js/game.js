(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const t = (k, a) => window.I18N.t(k, a);
  const DEFS = window.DEFS;
  const Sprites = window.Sprites;
  const now = () => Date.now();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, n) => a + (b - a) * n;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const worldName = id => t('worlds.world') + ' ' + String(id || 'w1').replace(/\D/g, '');
  const itemLabel = type => {
    if (!type) return '';
    const s = t('item.' + type);
    return s === 'item.' + type ? type : s;
  };
  const bldLabel = type => t('bld.' + type);
  const resLabel = r => t('res.' + r);

  /* ========================================================
     canvas
     ======================================================== */
  const canvas = $('#game');
  const ctx = canvas.getContext('2d', { alpha: false });
  let vw = window.innerWidth, vh = window.innerHeight, dpr = 1;
  let grassTexture = Sprites.createGrassTexture();
  let grassPattern = null;
  function resize() {
    vw = window.innerWidth; vh = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    grassPattern = ctx.createPattern(grassTexture, 'repeat');
  }
  window.addEventListener('resize', resize);
  resize();

  /* ========================================================
     audio
     ======================================================== */
  let actx = null;
  function audio() {
    if (!App.sound) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    } catch (e) { return null; }
  }
  function tone(freq, dur, type, vol, slideTo) {
    const ac = audio(); if (!ac) return;
    try {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, ac.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ac.currentTime + dur);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.08, ac.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(g).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur + 0.02);
    } catch (e) {}
  }
  function noise(dur, vol) {
    const ac = audio(); if (!ac) return;
    try {
      const len = Math.floor(ac.sampleRate * dur);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ac.createBufferSource(); src.buffer = buf;
      const g = ac.createGain(); g.gain.value = vol || 0.06;
      const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      src.connect(f).connect(g).connect(ac.destination);
      src.start();
    } catch (e) {}
  }
  const sfx = {
    click() { tone(620, 0.06, 'triangle', 0.035, 520); },
    swing() { noise(0.08, 0.035); tone(220, 0.08, 'sawtooth', 0.02, 140); },
    hit() { noise(0.12, 0.07); tone(150, 0.1, 'square', 0.035, 90); },
    hurt() { tone(190, 0.16, 'sawtooth', 0.06, 90); noise(0.14, 0.05); },
    collect() { tone(660, 0.09, 'sine', 0.06); setTimeout(() => tone(880, 0.1, 'sine', 0.05), 60); },
    gold() { tone(1050, 0.1, 'sine', 0.05); setTimeout(() => tone(1400, 0.14, 'sine', 0.04), 70); },
    build() { noise(0.16, 0.06); tone(180, 0.12, 'triangle', 0.05, 120); },
    craft() { tone(440, 0.08, 'triangle', 0.05); setTimeout(() => tone(660, 0.1, 'triangle', 0.05), 80); },
    upgrade() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.13, 'triangle', 0.045), i * 80)); },
    event() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'sine', 0.055), i * 130)); },
    death() { tone(220, 0.6, 'sawtooth', 0.06, 60); },
    error() { tone(200, 0.18, 'square', 0.04, 160); },
    chat() { tone(800, 0.05, 'sine', 0.025); }
  };
  let lastToastKey = '', lastToastAt = 0;
  function play(k) { try { sfx[k] && sfx[k](); } catch (e) {} }

  /* ========================================================
     app / menu
     ======================================================== */
  const App = {
    token: lsGet('faber_token', '') || '',
    profile: null,
    rank: null,
    config: null,
    sound: lsGet('faber_sound', '1') !== '0',
    authGender: 'male',
    setGender: 'male',
    pendingPlay: false,
    googleReady: false,
    googleInit: false,
    busy: false,
    leaderboard: null
  };

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (App.token) headers.Authorization = 'Bearer ' + App.token;
    const res = await fetch(path, Object.assign({}, opts, { headers }));
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) {
      const err = new Error(data.error || 'http_' + res.status);
      err.status = res.status; err.data = data;
      throw err;
    }
    return data;
  }

  function toast(text, type) {
    if (!text) return;
    const key = text + '|' + (type || '');
    if (key === lastToastKey && now() - lastToastAt < 700) return;
    lastToastKey = key; lastToastAt = now();
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { el.classList.add('fade'); setTimeout(() => el.remove(), 400); }, 3200);
  }

  function toastKey(key, args, type) {
    if (!key) return;
    const full = key.includes('.') ? key : 'toast.' + key;
    toast(t(full, args), type);
  }

  function openScreen(id) {
    closeScreen();
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  }
  function closeScreen() {
    ['screenAuth', 'screenWorlds', 'screenLeaderboard', 'screenHowto', 'screenSettings'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }
  const isScreenOpen = () => ['screenAuth', 'screenWorlds', 'screenLeaderboard', 'screenHowto', 'screenSettings']
    .some(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });

  function updateSoundBtn() {
    const b = $('#soundBtn');
    b.classList.toggle('off', !App.sound);
    b.textContent = App.sound ? '♪' : '♪';
    const chk = $('#setSound');
    if (chk) chk.checked = App.sound;
    const lbl = $('#setSoundLabel');
    if (lbl) lbl.textContent = t(App.sound ? 'settings.on' : 'settings.off');
  }
  function updateLangButtons() {
    $$('#langSwitch button').forEach(b => b.classList.toggle('active', b.dataset.lang === window.I18N.lang));
    const sel = $('#setLang');
    if (sel) sel.value = window.I18N.lang;
  }

  function updateProfileUI() {
    const p = App.profile;
    const nameEl = $('#pcName'), avatar = $('#pcAvatar');
    const signOut = $('#btnSignOut'), edit = $('#btnEditProfile');
    if (p) {
      nameEl.textContent = p.nickname;
      nameEl.className = 'profile-name ' + (p.gender === 'female' ? 'female' : 'male');
      avatar.textContent = (p.nickname || '?').slice(0, 1).toUpperCase();
      avatar.className = 'avatar' + (p.gender === 'female' ? ' female' : '');
      $('#pcGold').textContent = p.gold != null ? p.gold : 0;
      $('#pcRank').textContent = App.rank ? '#' + App.rank : '—';
      $('#pcClan').textContent = p.clan ? p.clan.name : t('clan.no_clan').split('.')[0] === 'clan.no_clan' ? '' : '';
      if (p.clan) $('#pcClan').textContent = p.clan.name;
      else $('#pcClan').textContent = '';
      signOut.classList.remove('hidden');
      edit.textContent = t('menu.settings');
    } else {
      nameEl.textContent = '—';
      nameEl.className = 'profile-name';
      avatar.textContent = '?';
      avatar.className = 'avatar';
      $('#pcGold').textContent = '0';
      $('#pcRank').textContent = '—';
      $('#pcClan').textContent = t('menu.guest');
      signOut.classList.add('hidden');
      edit.textContent = t('menu.login');
    }
    updateMenuOnline();
  }

  function updateMenuOnline() {
    let n = 0;
    if (App.config && App.config.worlds) for (const w of App.config.worlds) n += w.players || 0;
    $('#menuOnline').textContent = (App.config ? t('menu.online') : '—') + (App.config ? ': ' + n + ' ' + t('hud.players') : '');
  }

  async function loadMe() {
    if (!App.token) { App.profile = null; updateProfileUI(); return; }
    try {
      const data = await api('/api/me');
      App.profile = data.profile;
      App.rank = data.rank;
    } catch (e) {
      if (e.status === 401) { App.token = ''; lsSet('faber_token', ''); App.profile = null; App.rank = null; }
    }
    updateProfileUI();
    if (isSettingsOpen()) fillSettings();
  }
  const isSettingsOpen = () => { const el = $('#screenSettings'); return el && !el.classList.contains('hidden'); };

  async function fetchConfig() {
    try {
      App.config = await api('/api/config');
      updateMenuOnline();
      renderWorlds();
    } catch (e) {
      toast(t('err.connection'), 'warn');
    }
  }

  function resetAuthForm() {
    $('#authError').classList.add('hidden');
    if (!App.profile) { /* keep typed nick */ }
  }

  function openAuth() {
    resetAuthForm();
    $('#googleNote').classList.add('hidden');
    const block = $('#googleBlock');
    if (App.config && App.config.googleClientId) {
      block.classList.remove('hidden');
      initGoogle();
    } else {
      block.classList.add('hidden');
      $('#googleNote').classList.remove('hidden');
    }
    openScreen('screenAuth');
    setTimeout(() => $('#authNick').focus(), 60);
  }

  function setAuthGender(g) {
    App.authGender = g;
    $$('#authGender button').forEach(b => b.classList.toggle('active', b.dataset.gender === g));
  }
  function setSettingsGender(g) {
    App.setGender = g;
    $$('#setGender button').forEach(b => b.classList.toggle('active', b.dataset.gender === g));
  }

  async function guestLogin() {
    if (App.busy) return;
    const nick = $('#authNick').value.trim();
    const errEl = $('#authError');
    errEl.classList.add('hidden');
    if (nick.length < 2) { errEl.textContent = t('auth.err_nick'); errEl.classList.remove('hidden'); return; }
    App.busy = true;
    $('#btnGuest').disabled = true;
    try {
      const data = await api('/api/auth/guest', { method: 'POST', body: JSON.stringify({ nickname: nick, gender: App.authGender }) });
      onAuthSuccess(data);
    } catch (e) {
      errEl.textContent = e.data && e.data.error === 'nickname_taken' ? t('auth.err_taken') : t('auth.err_nick');
      errEl.classList.remove('hidden');
    } finally {
      App.busy = false;
      $('#btnGuest').disabled = false;
    }
  }

  function onAuthSuccess(data) {
    App.token = data.token;
    App.profile = data.profile;
    lsSet('faber_token', data.token);
    updateProfileUI();
    loadMe();
    closeScreen();
    play('click');
    toast(t('auth.welcome') + ', ' + data.profile.nickname + '!', 'gold');
    if (App.pendingPlay) { App.pendingPlay = false; openWorlds(); }
  }

  async function googleLogin(credential) {
    if (App.busy) return;
    App.busy = true;
    const errEl = $('#authError');
    errEl.classList.add('hidden');
    try {
      const data = await api('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, nickname: $('#authNick').value.trim(), gender: App.authGender })
      });
      onAuthSuccess(data);
    } catch (e) {
      errEl.textContent = e.data && e.data.error === 'google_disabled' ? t('auth.google_missing') : t('err.google');
      errEl.classList.remove('hidden');
    } finally { App.busy = false; }
  }

  function initGoogle() {
    if (!App.config || !App.config.googleClientId) return;
    if (App.googleReady) return;
    if (window.google && window.google.accounts && window.google.accounts.id) { renderGoogle(); return; }
    if (document.getElementById('gsi-script')) return;
    const s = document.createElement('script');
    s.id = 'gsi-script';
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => renderGoogle();
    s.onerror = () => { $('#googleNote').classList.remove('hidden'); };
    document.head.appendChild(s);
  }
  function renderGoogle() {
    if (!window.google || !window.google.accounts || !App.config.googleClientId) return;
    try {
      if (!App.googleInit) {
        window.google.accounts.id.initialize({
          client_id: App.config.googleClientId,
          callback: res => { if (res && res.credential) googleLogin(res.credential); },
          auto_select: false,
          cancel_on_tap_outside: true
        });
        App.googleInit = true;
      }
      const btn = $('#googleBtn');
      btn.innerHTML = '';
      window.google.accounts.id.renderButton(btn, {
        theme: 'outline', size: 'large', shape: 'rect', text: 'continue_with',
        width: 330, locale: ({ tr: 'tr', en: 'en', ru: 'ru', az: 'az' })[window.I18N.lang] || 'en'
      });
      App.googleReady = true;
    } catch (e) { $('#googleNote').classList.remove('hidden'); }
  }

  function openWorlds() {
    renderWorlds();
    fetchConfig();
    openScreen('screenWorlds');
  }
  function renderWorlds() {
    const list = $('#worldList');
    if (!list) return;
    const worlds = App.config ? App.config.worlds : [
      { id: 'w1', players: 0, max: 50 }, { id: 'w2', players: 0, max: 50 }, { id: 'w3', players: 0, max: 50 }
    ];
    list.innerHTML = worlds.map((w, i) => {
      const pct = clamp((w.players || 0) / (w.max || 50) * 100, 0, 100);
      const full = (w.players || 0) >= (w.max || 50);
      return '<div class="world-card" data-world="' + esc(w.id) + '">' +
        '<div class="wc-emblem">' + (i + 1) + '</div>' +
        '<div class="wc-body"><h3>' + esc(worldName(w.id)) + '</h3>' +
        '<div class="world-pop">' + (w.players || 0) + ' / ' + (w.max || 50) + ' ' + t('worlds.players') + '</div>' +
        '<div class="world-bar ' + (full ? 'full' : pct > 75 ? 'hot' : '') + '"><i style="width:' + pct + '%"></i></div></div>' +
        '<button class="btn ' + (full ? '' : 'btn-gold') + '" data-enter="' + esc(w.id) + '" ' + (full ? 'disabled' : '') + '>' +
        (full ? t('worlds.full') : t('worlds.enter')) + '</button></div>';
    }).join('');
    list.querySelectorAll('[data-enter]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const id = btn.dataset.enter;
        const w = App.config && App.config.worlds.find(x => x.id === id);
        if (w && w.players >= w.max) { toast(t('worlds.full_msg'), 'warn'); return; }
        enterWorld(id);
      });
    });
  }

  async function openLeaderboard() {
    openScreen('screenLeaderboard');
    try {
      const data = await api('/api/leaderboard');
      App.leaderboard = data;
      renderLeaderboard(data);
    } catch (e) {
      const body = $('#lbBody');
      body.innerHTML = '';
      $('#lbEmpty').classList.remove('hidden');
    }
  }
  function renderLeaderboard(data) {
    const body = $('#lbBody');
    if (!body) return;
    const top = data && data.top ? data.top : [];
    $('#lbEmpty').classList.toggle('hidden', top.length > 0);
    body.innerHTML = top.map(r => {
      const mine = App.profile && r.id === App.profile.id;
      return '<tr class="' + (mine ? 'me' : '') + '">' +
        '<td><span class="lb-rank r' + (r.rank <= 3 ? r.rank : '') + '">' + r.rank + '</span></td>' +
        '<td><span class="lb-name ' + (r.gender === 'female' ? 'female' : 'male') + '">' + esc(r.name) + '</span></td>' +
        '<td><span class="lb-clan">' + esc(r.clan || '—') + '</span></td>' +
        '<td><span class="lb-gold">' + (r.gold || 0) + '</span></td></tr>';
    }).join('');
  }

  function openHowto() { openScreen('screenHowto'); }
  function fillSettings() {
    const p = App.profile;
    $('#setNick').value = p ? p.nickname : '';
    setSettingsGender(p ? p.gender : 'male');
    $('#setAccountName').textContent = p ? p.nickname : '—';
    $('#setAccountGold').textContent = p ? (p.gold || 0) + ' ' + t('hud.gold') : '—';
    const av = $('#setAvatar');
    av.textContent = p ? p.nickname.slice(0, 1).toUpperCase() : '?';
    av.className = 'avatar small' + (p && p.gender === 'female' ? ' female' : '');
    $('#setLang').value = window.I18N.lang;
    $('#setMsg').classList.add('hidden');
    updateSoundBtn();
  }
  function openSettings() {
    fillSettings();
    openScreen('screenSettings');
  }
  async function saveSettings() {
    if (!App.profile) {
      const m = $('#setMsg');
      m.textContent = t('auth.login_required');
      m.classList.remove('hidden');
      return;
    }
    const msg = $('#setMsg');
    msg.classList.add('hidden');
    const nick = $('#setNick').value.trim();
    try {
      const data = await api('/api/profile', {
        method: 'POST',
        body: JSON.stringify({ nickname: nick, gender: App.setGender })
      });
      App.profile = data.profile;
      updateProfileUI();
      fillSettings();
      msg.textContent = t('settings.saved');
      msg.className = 'form-error form-success';
      msg.classList.remove('hidden');
      play('craft');
    } catch (e) {
      msg.className = 'form-error';
      msg.textContent = e.data && e.data.error === 'nickname_taken' ? t('auth.err_taken') : t('auth.err_nick');
      msg.classList.remove('hidden');
    }
  }

  function signOut() {
    App.token = ''; App.profile = null; App.rank = null;
    lsSet('faber_token', '');
    updateProfileUI();
    closeScreen();
    toast(t('menu.logout'), null);
  }

  /* ========================================================
     connect / session lifecycle
     ======================================================== */
  let S = null;
  let ws = null;
  let rafId = 0;
  let intentionalClose = false;
  let connectingWorld = null;

  function showConnect(on, textKey) {
    const el = $('#connectOverlay');
    el.classList.toggle('hidden', !on);
    if (on && textKey) $('#connectText').textContent = t(textKey);
    if (on) $('#connectText').textContent = t(textKey || 'misc.connecting');
  }

  function enterWorld(worldId) {
    if (!App.profile || !App.token) { App.pendingPlay = true; openAuth(); return; }
    if (ws) { intentionalClose = true; try { ws.close(); } catch (e) {} ws = null; }
    if (S) cleanupSession();
    connectingWorld = worldId;
    closeScreen();
    showConnect(true, 'misc.connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = proto + '//' + location.host + '/ws?token=' + encodeURIComponent(App.token);
    let opened = false;
    try { ws = new WebSocket(url); } catch (e) {
      showConnect(false); toast(t('err.connection'), 'warn'); return;
    }
    const failsafe = setTimeout(() => {
      if (!S && connectingWorld === worldId) {
        showConnect(false);
        toast(t('err.connection'), 'warn');
        try { ws.close(); } catch (e) {}
        ws = null;
      }
    }, 14000);
    const sock = ws;
    sock.onopen = () => {
      opened = true;
      sock.send(JSON.stringify({ t: 'join', world: worldId }));
    };
    sock.onmessage = ev => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg) return;
      if (msg.t === 'welcome') {
        clearTimeout(failsafe);
        connectingWorld = null;
        showConnect(false);
        enterGame(msg);
        return;
      }
      if (msg.t === 'error') {
        clearTimeout(failsafe);
        connectingWorld = null;
        showConnect(false);
        toastKey(msg.key || 'err.connection', null, 'warn');
        intentionalClose = true;
        try { sock.close(); } catch (e) {}
        ws = null;
        return;
      }
      handlePacket(msg);
    };
    sock.onclose = () => {
      clearTimeout(failsafe);
      if (ws !== sock) return;
      ws = null;
      showConnect(false);
      connectingWorld = null;
      if (S) {
        cleanupSession();
        openScreen('screenWorlds');
        toast(t('err.connection'), 'warn');
      } else if (opened && !intentionalClose && !App.busy) {
        toast(t('err.connection'), 'warn');
      }
      intentionalClose = false;
    };
    sock.onerror = () => {};
  }

  function enterGame(welcome) {
    intentionalClose = false;
    App.profile = welcome.profile || App.profile;
    updateProfileUI();
    const you = welcome.you;
    S = {
      ws,
      worldId: welcome.world.id,
      size: welcome.world.size,
      border: welcome.world.border,
      me: {
        id: you.id, name: you.name, gender: you.gender, clanId: welcome.profile && welcome.profile.clan ? welcome.profile.clan.id : null,
        x: you.x, y: you.y, dir: 0, moving: false, hp: 100, maxHp: 100, dead: false, respawnAt: 0,
        wood: 0, stone: 0, gold: App.profile ? App.profile.gold : 0,
        inv: [], hot: new Array(DEFS.PLAYER.hotSize).fill(null), sel: 0, shieldUntil: now() + 6000,
        swingUntil: 0, armorTier: 0, weaponTier: 0, weaponType: 'wooden_sword', armorValue: 0
      },
      players: new Map(),
      buildings: new Map(),
      ground: new Map(),
      farmState: new Map(),
      event: welcome.event || { active: false, nextAt: now() + DEFS.WORLD.eventEveryMs },
      clan: welcome.clan || null,
      clanList: [],
      chest: null,
      camera: { x: you.x, y: you.y },
      mouse: { x: vw / 2, y: vh / 2, wx: you.x, wy: you.y },
      buildType: null,
      attackHeld: false,
      lastAttack: 0,
      lastInputAt: 0,
      lastDust: 0,
      particles: [],
      floats: [],
      arrows: [],
      shake: 0,
      paused: false,
      chestWasOpen: false,
      promptText: '',
      deathShown: false,
      lastHud: 0,
      lastMap: 0,
      lastPrompt: 0,
      lastEventUi: 0,
      chatOpen: false,
      eventNotified: false
    };
    for (const p of welcome.players || []) addRemote(p);
    for (const b of welcome.buildings || []) {
      S.buildings.set(b.id, b);
      if (b.type && DEFS.BUILDINGS[b.type] && DEFS.BUILDINGS[b.type].cat === 'farm') {
        S.farmState.set(b.id, { total: Math.floor((b.wood || 0) + (b.stone || 0)), gold: 0 });
      }
    }
    for (const g of welcome.ground || []) S.ground.set(g.id, g);
    $('#minimapLabel').textContent = worldName(S.worldId);
    $('#worldPill').textContent = worldName(S.worldId) + ' · 0 ' + t('hud.players');
    document.body.classList.add('in-game');
    $('#hud').classList.remove('hidden');
    closeScreen();
    hideAllUI();
    hideDeath();
    $('#connectOverlay').classList.add('hidden');
    buildHotbarDOM();
    buildInventoryDOM();
    renderAllSelf();
    S.camera.x = S.me.x; S.camera.y = S.me.y;
    updateEventUI(true);
    if (!rafId) { rafId = requestAnimationFrame(loop); }
    play('click');
  }

  function cleanupSession() {
    S = null;
    ws = null;
    document.body.classList.remove('in-game');
    $('#hud').classList.add('hidden');
    $('#connectOverlay').classList.add('hidden');
    hideAllUI();
    hideDeath();
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    App.profile && loadMe();
  }

  function leaveWorld() {
    intentionalClose = true;
    if (ws) { try { ws.close(); } catch (e) {} }
    const wasIn = !!S;
    cleanupSession();
    ws = null;
    hideAllUI();
    closeScreen();
    openHome();
    if (wasIn) loadMe();
  }

  function openHome() {
    closeScreen();
    const pause = $('#pauseOverlay');
    if (pause) pause.classList.add('hidden');
    document.body.classList.remove('in-game');
    $('#hud').classList.add('hidden');
  }

  /* ========================================================
     protocol handlers
     ======================================================== */
  function addRemote(p) {
    if (!S || !p || p.id === S.me.id) return;
    S.players.set(p.id, {
      id: p.id, name: p.name, gender: p.gender, clanTag: p.clanTag || null, clanId: p.clanId || null,
      x: p.x, y: p.y, tx: p.x, ty: p.y, dir: 0, moving: false, hp: p.hp == null ? 100 : p.hp,
      dead: !!p.dead, armorTier: 0, weaponTier: 0, weaponType: 'wooden_sword',
      swingUntil: 0, lastSeen: now()
    });
  }

  function updateOwnGear() {
    const it = S.me.hot[S.me.sel];
    const def = it && DEFS.ITEMS[it.type];
    S.me.weaponTier = def && def.kind === 'weapon' ? def.tier : 0;
    S.me.weaponType = def && def.kind === 'weapon' ? it.type : 'wooden_sword';
    S.me.armorTier = def && def.kind === 'armor' ? def.tier : 0;
    S.me.armorValue = def && def.kind === 'armor' ? def.armor : 0;
  }
  function weaponTypeFromTier(v) {
    return ['wooden_sword', 'wooden_sword', 'stone_sword', 'iron_sword', 'steel_sword', 'golden_sword', 'legendary_sword'][v] || 'wooden_sword';
  }

  function handlePacket(msg) {
    if (!S) return;
    try {
      switch (msg.t) {
        case 'self': applySelf(msg); break;
        case 's': applyState(msg); break;
        case 'pjoin': {
          addRemote(msg.p);
          updateWorldCount(1);
          break;
        }
        case 'pleave': {
          S.players.delete(msg.id);
          updateWorldCount(-1);
          break;
        }
        case 'pupd': {
          const p = S.players.get(msg.id);
          if (p) {
            if (msg.name) p.name = msg.name;
            if (msg.gender) p.gender = msg.gender;
            if (msg.clanTag !== undefined) p.clanTag = msg.clanTag;
          }
          break;
        }
        case 'badd': {
          const b = msg.b;
          S.buildings.set(b.id, b);
          if (DEFS.BUILDINGS[b.type] && DEFS.BUILDINGS[b.type].cat === 'farm') {
            S.farmState.set(b.id, { total: Math.floor((b.wood || 0) + (b.stone || 0)), gold: 0 });
          }
          play('build');
          break;
        }
        case 'brem': {
          S.buildings.delete(msg.id);
          S.farmState.delete(msg.id);
          if (S.chest && S.chest.id === msg.id) closeChest();
          break;
        }
        case 'bhp': {
          const b = S.buildings.get(msg.id);
          if (b) b.hp = msg.hp;
          break;
        }
        case 'bupd': {
          S.buildings.set(msg.b.id, msg.b);
          break;
        }
        case 'gadd': S.ground.set(msg.g.id, msg.g); break;
        case 'grem': S.ground.delete(msg.id); break;
        case 'farm': {
          for (const a of msg.bs || []) {
            S.farmState.set(a[0], { total: a[1] || 0, gold: a[2] || 0 });
          }
          break;
        }
        case 'chest': {
          S.chest = { id: msg.id, goldChest: !!msg.goldChest, slots: msg.slots || [] };
          openChestUI();
          break;
        }
        case 'clan': {
          S.clan = msg.info || null;
          S.me.clanId = S.clan ? S.clan.id : null;
          if (!S.clan) S.clanList = S.clanList || [];
          renderClan();
          break;
        }
        case 'clans': {
          S.clanList = (msg.data && msg.data.list) || [];
          if (msg.data && msg.data.own && !S.clan) { S.clan = msg.data.own; S.me.clanId = S.clan.id; }
          renderClan();
          break;
        }
        case 'chat': addChat(msg); break;
        case 'sys': addSystem('sys.' + msg.key, msg.args); break;
        case 'toast': {
          const type = /event|gold|clan_created/.test(msg.key) ? 'gold' : /no_resources|not_owner|full|error/.test(msg.key) ? 'warn' : null;
          toastKey(msg.key, msg.args, type);
          if (msg.key === 'under_attack') play('hurt');
          if (msg.key === 'event_started') play('event');
          break;
        }
        case 'ev': {
          S.event = { active: msg.active, x: msg.x, y: msg.y, nextAt: msg.nextAt, winner: msg.winner };
          updateEventUI(true);
          if (msg.active) { play('event'); S.eventNotified = false; }
          break;
        }
        case 'death': {
          const p = S.players.get(msg.id);
          if (p) { p.dead = true; p.hp = 0; }
          break;
        }
        case 'died': {
          S.me.dead = true; S.me.hp = 0; S.me.respawnAt = msg.respawnAt || (now() + 4000);
          showDeath(msg.by);
          play('death');
          break;
        }
        case 'respawned': {
          S.me.dead = false;
          S.me.x = msg.x; S.me.y = msg.y;
          S.camera.x = msg.x; S.camera.y = msg.y;
          hideDeath();
          play('upgrade');
          break;
        }
        case 'hit': {
          addFloat(msg.x, msg.y, '-' + msg.dmg, '#ffd36e');
          spawnBurst(msg.x, msg.y, '#f3cf7a', 6);
          play('hit');
          break;
        }
        case 'hitb': {
          addFloat(msg.x, msg.y, '-' + msg.dmg, '#ffe0a0');
          spawnBurst(msg.x, msg.y, '#c9a35b', 6);
          play('hit');
          break;
        }
        case 'hurt': {
          addFloat(msg.x, msg.y, '-' + msg.dmg, '#ff8a7a');
          spawnBurst(msg.x, msg.y, '#e86a5a', 8);
          S.shake = Math.max(S.shake, 7);
          play('hurt');
          break;
        }
        case 'swing': {
          const p = S.players.get(msg.id);
          if (p) p.swingUntil = now() + 220;
          break;
        }
        case 'shot': {
          S.arrows.push({ x: msg.x, y: msg.y, tx: msg.tx, ty: msg.ty, start: now() });
          break;
        }
        case 'error': toastKey(msg.key || 'err.connection', null, 'warn'); break;
        case 'pong': break;
        default: break;
      }
    } catch (e) { console.warn('packet error', msg.t, e); }
  }

  function applySelf(msg) {
    const m = S.me;
    m.hp = msg.hp;
    m.dead = !!msg.dead;
    m.respawnAt = msg.respawnAt || 0;
    m.wood = msg.wood || 0;
    m.stone = msg.stone || 0;
    m.gold = msg.gold || 0;
    m.inv = (msg.inv || []).map(i => ({ uid: i.u, type: i.t }));
    m.hot = (msg.hot || []).map(i => i ? { uid: i.u, type: i.t } : null);
    while (m.hot.length < DEFS.PLAYER.hotSize) m.hot.push(null);
    m.sel = msg.sel || 0;
    m.shieldUntil = msg.shieldUntil || 0;
    updateOwnGear();
    if (App.profile) App.profile.gold = m.gold;
    renderAllSelf();
    if (m.dead && !S.deathShown) showDeath(null);
    if (!m.dead && S.deathShown) hideDeath();
  }

  function applyState(msg) {
    const meArr = msg.me || [];
    for (const a of msg.ps || []) {
      let p = S.players.get(a[0]);
      if (!p) {
        addRemote({ id: a[0], name: '...', gender: 'male', x: a[1], y: a[2], hp: a[5] });
        p = S.players.get(a[0]);
      }
      if (!p) continue;
      p.tx = a[1]; p.ty = a[2];
      if (dist(p.x, p.y, a[1], a[2]) > 400) { p.x = a[1]; p.y = a[2]; }
      p.dir = a[3]; p.moving = !!a[4]; p.hp = a[5]; p.dead = !!a[6];
      if (a[7]) p.swingUntil = now() + 200;
      p.armorTier = a[8] || 0;
      p.weaponTier = a[9] || 0;
      p.weaponType = weaponTypeFromTier(p.weaponTier);
      p.lastSeen = now();
    }
    if (meArr.length === 2 && !S.me.dead) {
      const err = dist(S.me.x, S.me.y, meArr[0], meArr[1]);
      if (err > 85) {
        S.me.x = meArr[0]; S.me.y = meArr[1];
      }
    }
    const m = S.me;
    m.shieldUntil = m.shieldUntil || 0;
  }

  function updateWorldCount(delta) {
    S.worldDelta = (S.worldDelta || 0) + delta;
    const n = clamp((welcomePlayerCount || 0) + S.worldDelta, 0, 50);
    $('#worldPill').textContent = worldName(S.worldId) + ' · ' + n + ' ' + t('hud.players');
  }
  let welcomePlayerCount = 0;

  /* ========================================================
     UI data (me)
     ======================================================== */
  const UI = { hot: [], inv: [], lastInvSig: '' };

  function buildHotbarDOM() {
    const bar = $('#hotbar');
    bar.innerHTML = '';
    UI.hot = [];
    for (let i = 0; i < DEFS.PLAYER.hotSize; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot empty';
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i === 9 ? '0' : String(i + 1);
      const cv = document.createElement('canvas');
      cv.width = 42; cv.height = 42;
      slot.appendChild(num); slot.appendChild(cv);
      slot.addEventListener('click', () => {
        if (!S) return;
        play('click');
        send({ t: 'sel', slot: i });
      });
      slot.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (!S || !S.me.hot[i]) return;
        send({ t: 'hot', uid: S.me.hot[i].uid, slot: -1 });
      });
      bar.appendChild(slot);
      UI.hot.push({ el: slot, canvas: cv });
    }
  }

  function renderHotbar() {
    const m = S.me;
    for (let i = 0; i < UI.hot.length; i++) {
      const slot = UI.hot[i];
      const item = m.hot[i];
      slot.el.classList.toggle('empty', !item);
      slot.el.classList.toggle('selected', i === m.sel);
      const c = slot.canvas.getContext('2d');
      c.clearRect(0, 0, 42, 42);
      if (item) {
        Sprites.drawItemIcon(slot.canvas, item.type);
        const def = DEFS.ITEMS[item.type];
        let extra = '';
        if (def) extra = def.kind === 'weapon' ? ' · ' + def.dmg + ' ' + t('craft.dmg') : ' · ' + def.armor + ' ' + t('craft.armor_stat');
        slot.el.title = itemLabel(item.type) + extra;
      } else slot.el.title = '';
    }
  }

  function buildInventoryDOM() {
    const grid = $('#invGrid');
    grid.innerHTML = '';
    UI.inv = [];
    for (let i = 0; i < DEFS.PLAYER.invSize; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot empty';
      const cv = document.createElement('canvas');
      cv.width = 46; cv.height = 46;
      slot.appendChild(cv);
      slot.addEventListener('click', () => {
        if (!S) return;
        const item = S.me.inv[i];
        if (!item) return;
        play('click');
        send({ t: 'hot', uid: item.uid });
      });
      grid.appendChild(slot);
      UI.inv.push({ el: slot, canvas: cv });
    }
  }

  function renderInventory() {
    if (!S) return;
    const panel = $('#inventoryPanel');
    if (panel.classList.contains('hidden')) return;
    const m = S.me;
    for (let i = 0; i < UI.inv.length; i++) {
      const slot = UI.inv[i];
      const item = m.inv[i];
      slot.el.classList.toggle('empty', !item);
      const c = slot.canvas.getContext('2d');
      c.clearRect(0, 0, 46, 46);
      if (item) {
        Sprites.drawItemIcon(slot.canvas, item.type);
        const def = DEFS.ITEMS[item.type];
        slot.el.title = itemLabel(item.type) + (def ? (def.kind === 'weapon' ? ' · ' + def.dmg + ' ' + t('craft.dmg') : ' · ' + def.armor + ' ' + t('craft.armor_stat')) : '');
      } else { slot.el.title = ''; }
    }
    $('#invWood').textContent = Math.floor(m.wood);
    $('#invStone').textContent = Math.floor(m.stone);
    $('#invGold').textContent = m.gold;
    renderEquip();
  }

  function renderEquip() {
    const box = $('#invEquip');
    const m = S.me;
    const item = m.hot[m.sel];
    let weapon = null, armor = null;
    if (item && DEFS.ITEMS[item.type]) {
      if (DEFS.ITEMS[item.type].kind === 'weapon') weapon = item;
      else armor = item;
    }
    const cards = [
      { label: t('inv.weapon'), item: weapon, empty: t('item.fist') },
      { label: t('inv.armor'), item: armor, empty: '—' }
    ];
    box.innerHTML = cards.map(c => '<div class="equip-card"><canvas width="34" height="34"></canvas><div>' +
      '<div class="eq-label">' + esc(c.label) + '</div><div class="eq-name">' + esc(c.item ? itemLabel(c.item.type) : c.empty) + '</div></div></div>').join('');
    const canvases = box.querySelectorAll('canvas');
    cards.forEach((c, i) => {
      Sprites.drawItemIcon(canvases[i], c.item ? c.item.type : 'fist');
    });
  }

  function renderAllSelf() {
    if (!S) return;
    const m = S.me;
    const hp = clamp(m.hp, 0, 100);
    const fill = $('#hpFill');
    fill.style.width = hp + '%';
    fill.className = 'hp-fill' + (hp <= 25 ? ' crit' : hp <= 55 ? ' low' : '');
    $('#hpText').textContent = Math.max(0, Math.round(hp)) + ' / 100';
    $('#woodVal').textContent = Math.floor(m.wood);
    $('#stoneVal').textContent = Math.floor(m.stone);
    $('#goldVal').textContent = m.gold;
    $('#goldHudVal').textContent = m.gold;
    $('#invWood').textContent = Math.floor(m.wood);
    $('#invStone').textContent = Math.floor(m.stone);
    $('#invGold').textContent = m.gold;
    if (App.profile) { App.profile.gold = m.gold; $('#pcGold').textContent = m.gold; }
    renderHotbar();
    renderInventory();
    renderChestInv();
    if (!$('#buildPanel').classList.contains('hidden')) renderBuildMenu();
    if (!$('#craftPanel').classList.contains('hidden')) renderCraftMenu();
  }

  /* ========================================================
     inventory / chest / menus
     ======================================================== */
  const panelIds = ['buildPanel', 'craftPanel', 'clanPanel'];
  function hideSidePanels() {
    panelIds.forEach(id => $('#' + id).classList.add('hidden'));
  }
  function hideAllUI() {
    hideSidePanels();
    ['inventoryPanel', 'chestPanel', 'mapOverlay', 'pauseOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    $('#chatRow').classList.add('hidden');
    if (S) { S.buildType = null; S.chatOpen = false; S.chest = null; S.paused = false; }
    else {
      const row = $('#chatRow'); if (row) row.classList.add('hidden');
    }
  }
  function toggleSidePanel(id) {
    if (!S) return;
    const el = document.getElementById(id);
    const showing = !el.classList.contains('hidden');
    hideSidePanels();
    hideModalPanels();
    if (showing) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    if (id === 'buildPanel') renderBuildMenu();
    if (id === 'craftPanel') renderCraftMenu();
    if (id === 'clanPanel') { renderClan(); send({ t: 'clans' }); }
    play('click');
  }
  function hideModalPanels() {
    ['inventoryPanel', 'chestPanel', 'mapOverlay'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    if (S) S.chest = null;
  }
  function toggleInventory() {
    if (!S) return;
    const el = $('#inventoryPanel');
    const showing = !el.classList.contains('hidden');
    hideModalPanels();
    hideSidePanels();
    if (showing) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    renderInventory();
    play('click');
  }
  function toggleMap() {
    if (!S) return;
    const el = $('#mapOverlay');
    const showing = !el.classList.contains('hidden');
    hideModalPanels();
    hideSidePanels();
    if (showing) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    drawBigMap();
    play('click');
  }
  function closeChest() {
    $('#chestPanel').classList.add('hidden');
    if (S) S.chest = null;
  }
  function openChestUI() {
    if (!S || !S.chest) return;
    hideSidePanels();
    hideModalPanels();
    S.chest = S.chest;
    $('#chestPanel').classList.remove('hidden');
    $('#chestTitle').textContent = S.chest.goldChest ? t('chest.gold') : t('chest.player');
    $('#chestSafe').classList.toggle('hidden', !S.chest.goldChest);
    renderChestInv();
    play('click');
  }
  function renderChestInv() {
    const panel = $('#chestPanel');
    if (!panel || panel.classList.contains('hidden') || !S || !S.chest) return;
    const grid = $('#chestGrid');
    const inv = $('#chestInvGrid');
    grid.innerHTML = '';
    inv.innerHTML = '';
    for (let i = 0; i < DEFS.PLAYER.chestSize; i++) {
      const type = S.chest.slots[i] || null;
      const slot = document.createElement('div');
      slot.className = 'slot' + (type ? '' : ' empty');
      const cv = document.createElement('canvas');
      cv.width = 46; cv.height = 46;
      slot.appendChild(cv);
      if (type) {
        Sprites.drawItemIcon(cv, type);
        slot.title = itemLabel(type);
        slot.addEventListener('click', () => {
          send({ t: 'chest', id: S.chest.id, dir: 'out', uid: 'c' + i });
          play('click');
        });
      }
      grid.appendChild(slot);
    }
    for (let i = 0; i < S.me.inv.length && i < DEFS.PLAYER.invSize; i++) {
      const item = S.me.inv[i];
      const slot = document.createElement('div');
      slot.className = 'slot' + (item ? '' : ' empty');
      const cv = document.createElement('canvas');
      cv.width = 38; cv.height = 38;
      slot.appendChild(cv);
      if (item) {
        Sprites.drawItemIcon(cv, item.type);
        slot.title = itemLabel(item.type);
        slot.addEventListener('click', () => {
          send({ t: 'chest', id: S.chest.id, dir: 'in', uid: item.uid });
          play('click');
        });
      }
      inv.appendChild(slot);
    }
  }

  function costChips(cost) {
    if (!cost) return '';
    return Object.keys(cost).map(k => {
      const have = S ? (k === 'gold' ? S.me.gold : S.me[k]) : 0;
      const bad = have < cost[k];
      return '<span class="cost-chip' + (bad ? ' bad' : '') + '"><i class="' + k + '"></i>' + cost[k] + ' ' + resLabel(k) + '</span>';
    }).join('');
  }

  function renderBuildMenu() {
    if (!S) return;
    const list = $('#buildList');
    list.innerHTML = '';
    for (const type of DEFS.BUILD_ORDER) {
      const def = DEFS.BUILDINGS[type];
      if (!def) continue;
      const afford = DEFS.canAfford({ wood: S.me.wood, stone: S.me.stone, gold: S.me.gold }, def.cost);
      const cat = def.cat === 'defense' ? t('build.defense') : def.cat === 'farm' ? t('build.farm') : t('build.storage');
      const btn = document.createElement('button');
      btn.className = 'build-row' + (S.buildType === type ? ' selected' : '');
      btn.innerHTML = '<span class="row-icon"><canvas width="46" height="46"></canvas></span>' +
        '<span class="row-main"><span class="row-name">' + esc(bldLabel(type)) + '</span>' +
        '<span class="row-sub">' + esc(cat) + ' · ' + def.hp + ' HP' + (def.cat === 'farm' ? ' · ' + t('hud.level') + ' 1' : '') + '</span>' +
        '<span class="row-cost">' + costChips(def.cost) + '</span></span>' +
        '<span class="row-side"><span class="afford-dot' + (afford ? '' : ' no') + '"></span><span class="row-tag">' + (S.buildType === type ? '✦' : '') + '</span></span>';
      Sprites.drawBuildingIcon(btn.querySelector('canvas'), type);
      btn.addEventListener('click', () => {
        if (!S) return;
        S.buildType = type;
        hideSidePanels();
        play('click');
        toast(t('build.place'), null);
      });
      list.appendChild(btn);
    }
  }

  function renderCraftMenu() {
    if (!S) return;
    const list = $('#craftList');
    list.innerHTML = '';
    const groups = [
      { title: t('craft.weapons'), items: DEFS.CRAFT_ORDER.filter(k => DEFS.ITEMS[k].kind === 'weapon') },
      { title: t('craft.armors'), items: DEFS.CRAFT_ORDER.filter(k => DEFS.ITEMS[k].kind === 'armor') }
    ];
    for (const g of groups) {
      const head = document.createElement('div');
      head.className = 'section-label';
      head.textContent = g.title;
      list.appendChild(head);
      for (const type of g.items) {
        const def = DEFS.ITEMS[type];
        const afford = DEFS.canAfford({ wood: S.me.wood, stone: S.me.stone, gold: S.me.gold }, def.cost);
        const btn = document.createElement('button');
        btn.className = 'craft-row';
        let pips = '';
        for (let i = 1; i <= 5; i++) pips += '<i class="' + (i <= def.tier ? 'on' : '') + '"></i>';
        btn.innerHTML = '<span class="row-icon"><canvas width="46" height="46"></canvas></span>' +
          '<span class="row-main"><span class="row-name">' + esc(itemLabel(type)) + '</span>' +
          '<span class="row-sub">' + (def.kind === 'weapon' ? t('craft.dmg') + ' ' + def.dmg : t('craft.armor_stat') + ' ' + def.armor) + ' · ' + t('craft.tier') + ' ' + def.tier + '</span>' +
          '<span class="row-cost">' + costChips(def.cost) + '</span></span>' +
          '<span class="row-side"><span class="tier-pips">' + pips + '</span><span class="afford-dot' + (afford ? '' : ' no') + '"></span></span>';
        Sprites.drawItemIcon(btn.querySelector('canvas'), type);
        btn.addEventListener('click', () => {
          if (!S) return;
          if (!afford) { toast(t('toast.no_resources'), 'warn'); return; }
          send({ t: 'craft', item: type });
          play('craft');
        });
        list.appendChild(btn);
      }
    }
  }

  function renderClan() {
    if (!S) return;
    const panel = $('#clanPanel');
    if (!panel || panel.classList.contains('hidden')) return;
    const body = $('#clanBody');
    const clan = S.clan;
    if (clan) {
      let html = '<div class="clan-meta"><div><b>' + esc(clan.name) + '</b><div><span class="clan-tag-badge">' + esc(clan.name.replace(/\s+/g, '').slice(0, 5).toUpperCase()) + '</span> · ' + clan.members.length + ' / ' + (clan.maxMembers || 20) + ' ' + t('clan.member_count') + '</div></div><span>' + (clan.isLeader ? '★ ' + t('clan.leader') : '') + '</span></div>';
      html += '<div class="section-label">' + esc(t('clan.members')) + '</div>';
      for (const m of clan.members) {
        const nm = m.id === S.me.id ? t('clan.you') : m.name;
        html += '<div class="member-row"><span class="member-dot ' + (m.online ? 'on' : '') + '"></span>' +
          '<span class="member-name ' + (m.gender === 'female' ? 'female' : 'male') + '">' + esc(nm) + '</span>' +
          (m.leader ? '<span class="member-role">★ ' + esc(t('clan.leader')) + '</span>' : '') +
          (clan.isLeader && !m.leader ? '<button class="mini-btn danger" data-kick="' + esc(m.id) + '">' + esc(t('clan.kick')) + '</button>' : '') +
          '</div>';
      }
      if (clan.isLeader && clan.requests && clan.requests.length) {
        html += '<div class="section-label">' + esc(t('clan.requests')) + ' (' + clan.requests.length + ')</div>';
        for (const r of clan.requests) {
          html += '<div class="request-row"><span class="member-name ' + (r.gender === 'female' ? 'female' : 'male') + '">' + esc(r.name) + '</span>' +
            '<button class="mini-btn" data-approve="' + esc(r.id) + '">' + esc(t('clan.approve')) + '</button>' +
            '<button class="mini-btn danger" data-deny="' + esc(r.id) + '">' + esc(t('clan.deny')) + '</button></div>';
        }
      }
      html += '<div class="clan-actions">' +
        '<button class="btn btn-small" id="clanLeaveBtn">' + esc(t('clan.leave')) + '</button>' +
        (clan.isLeader ? '<button class="btn btn-small btn-danger" id="clanDisbandBtn">' + esc(t('clan.disband')) + '</button>' : '') +
        '</div>';
      body.innerHTML = html;
      body.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => send({ t: 'clan', op: 'kick', id: b.dataset.kick })));
      body.querySelectorAll('[data-approve]').forEach(b => b.addEventListener('click', () => send({ t: 'clan', op: 'approve', id: b.dataset.approve })));
      body.querySelectorAll('[data-deny]').forEach(b => b.addEventListener('click', () => send({ t: 'clan', op: 'deny', id: b.dataset.deny })));
      const lb = $('#clanLeaveBtn');
      if (lb) lb.addEventListener('click', () => send({ t: 'clan', op: 'leave' }));
      const db = $('#clanDisbandBtn');
      if (db) db.addEventListener('click', () => send({ t: 'clan', op: 'disband' }));
    } else {
      let html = '<p class="clan-empty">' + esc(t('clan.no_clan')) + '</p>';
      html += '<div class="section-label">' + esc(t('clan.create')) + ' · ' + DEFS.CLAN.createCost + ' ' + esc(t('hud.gold')) + '</div>' +
        '<div class="clan-create"><input id="clanNameInput" maxlength="18" placeholder="' + esc(t('clan.name_ph')) + '"><button class="btn btn-small btn-gold" id="clanCreateBtn">' + esc(t('clan.create')) + '</button></div>';
      html += '<div class="section-label">' + esc(t('clan.list')) + '</div>';
      if (!S.clanList || !S.clanList.length) {
        html += '<p class="clan-empty">' + esc(t('clan.none')) + '</p>';
      } else {
        html += '<div class="clan-list">' + S.clanList.map(c =>
          '<div class="clan-list-row"><span class="clan-tag-badge">' + esc(c.tag) + '</span><span class="cl-name">' + esc(c.name) + '</span>' +
          '<span class="cl-count">' + c.members + ' ' + esc(t('clan.member_count')) + '</span>' +
          (c.mine ? '<span class="cl-count">★</span>' :
            '<button class="mini-btn" data-join="' + esc(c.id) + '"' + (c.requested ? ' disabled' : '') + '>' + esc(c.requested ? t('clan.requested') : t('clan.request')) + '</button>') +
          '</div>').join('') + '</div>';
      }
      body.innerHTML = html;
      const createBtn = $('#clanCreateBtn');
      if (createBtn) createBtn.addEventListener('click', () => {
        const name = $('#clanNameInput').value.trim();
        if (name.length < DEFS.CLAN.nameMin) { toast(t('toast.clan_name_short'), 'warn'); return; }
        send({ t: 'clan', op: 'create', name });
      });
      body.querySelectorAll('[data-join]').forEach(b => {
        b.addEventListener('click', () => { if (!b.disabled) send({ t: 'clan', op: 'request', id: b.dataset.join }); });
      });
    }
  }

  /* ========================================================
     chat
     ======================================================== */
  function addChat(m) {
    const log = $('#chatLog');
    const el = document.createElement('div');
    el.className = 'msg' + (m.scope === 'team' ? ' team' : '');
    if (m.scope === 'team') {
      const sc = document.createElement('span');
      sc.className = 'scope';
      sc.textContent = t('chat.team');
      el.appendChild(sc);
    }
    const who = document.createElement('span');
    who.className = 'who ' + (m.gender === 'female' ? 'female' : 'male');
    who.textContent = (m.clanTag ? '[' + m.clanTag + '] ' : '') + m.name + ':';
    el.appendChild(who);
    const txt = document.createElement('span');
    txt.textContent = m.text;
    el.appendChild(txt);
    log.appendChild(el);
    while (log.children.length > 8) log.removeChild(log.firstChild);
    play('chat');
  }
  function addSystem(key, args) {
    if (!key) return;
    const log = $('#chatLog');
    const el = document.createElement('div');
    el.className = 'msg system';
    el.textContent = t(key, args);
    log.appendChild(el);
    while (log.children.length > 8) log.removeChild(log.firstChild);
  }
  function openChat() {
    if (!S) return;
    S.chatOpen = true;
    $('#chatRow').classList.remove('hidden');
    setTimeout(() => $('#chatInput').focus(), 10);
  }
  function closeChat() {
    S.chatOpen = false;
    $('#chatRow').classList.add('hidden');
    $('#chatInput').value = '';
    $('#chatInput').blur();
  }
  function sendChat() {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (text) send({ t: 'chat', text });
    closeChat();
  }

  /* ========================================================
     input
     ======================================================== */
  const keys = new Set();
  function isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }
  function send(obj) {
    if (!S || !S.ws || S.ws.readyState !== 1) return;
    try { S.ws.send(JSON.stringify(obj)); } catch (e) {}
  }

  function bindInput() {
    document.addEventListener('keydown', e => {
      if (!S) {
        if (e.code === 'Escape') closeScreen();
        return;
      }
      if (document.activeElement === $('#chatInput')) {
        if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
        if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
        return;
      }
      if (isTyping()) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        if (!S.chatOpen) openChat();
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        if (S.buildType) { S.buildType = null; toast(t('misc.cancel'), null); return; }
        if (isAnyUI()) { hideAllUI(); return; }
        togglePause();
        return;
      }
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyB': toggleSidePanel('buildPanel'); break;
        case 'KeyC': toggleSidePanel('craftPanel'); break;
        case 'KeyM': toggleSidePanel('clanPanel'); break;
        case 'KeyE': toggleInventory(); break;
        case 'KeyP': toggleMap(); break;
        case 'KeyF':
          if (S.chest) { closeChest(); break; }
          if (!S.me.dead) send({ t: 'use' });
          break;
        case 'KeyQ': if (!S.me.dead) send({ t: 'upg' }); break;
        case 'KeyT': {
          if (S.me.dead) break;
          const item = S.me.hot[S.me.sel];
          if (item) send({ t: 'drop', uid: item.uid });
          break;
        }
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': case 'Digit0': {
          const n = Number(e.code.slice(5));
          const slot = n === 0 ? 9 : n - 1;
          send({ t: 'sel', slot });
          play('click');
          break;
        }
      }
    });
    document.addEventListener('keyup', e => { keys.delete(e.code); });

    const onKey = (on) => {
      if (!S) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(on.code)) {
        if (document.activeElement === $('#chatInput')) return;
        if (on.type === 'keydown') keys.add(on.code); else keys.delete(on.code);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    window.addEventListener('blur', () => keys.clear());

    canvas.addEventListener('mousemove', e => {
      if (!S) return;
      S.mouse.x = e.clientX; S.mouse.y = e.clientY;
    });
    canvas.addEventListener('mousedown', e => {
      if (!S || S.paused) return;
      if (e.button === 0) {
        if (S.buildType) { placeAtMouse(); return; }
        S.attackHeld = true;
        tryAttack();
      } else if (e.button === 2) {
        if (S.buildType) { S.buildType = null; }
      }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0 && S) S.attackHeld = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mouseleave', () => { if (S) S.attackHeld = false; });
    $('#chatInput').addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
      if (e.key === 'Escape') { e.preventDefault(); closeChat(); }
    });
    $('#gameMenuBtn').addEventListener('click', togglePause);
    $('#btnResume').addEventListener('click', togglePause);
    $('#btnLeave').addEventListener('click', leaveWorld);
  }

  function isAnyUI() {
    return panelIds.some(id => !$('#' + id).classList.contains('hidden')) ||
      !$('#inventoryPanel').classList.contains('hidden') ||
      !$('#chestPanel').classList.contains('hidden') ||
      !$('#mapOverlay').classList.contains('hidden') ||
      !$('#pauseOverlay').classList.contains('hidden');
  }
  function togglePause() {
    if (!S) return;
    const el = $('#pauseOverlay');
    const showing = !el.classList.contains('hidden');
    if (showing) { el.classList.add('hidden'); S.paused = false; }
    else {
      hideSidePanels(); hideModalPanels();
      el.classList.remove('hidden');
      S.paused = true;
      S.attackHeld = false;
    }
  }

  function collidesAt(x, y, r) {
    const m = S.me;
    for (const b of S.buildings.values()) {
      const def = DEFS.BUILDINGS[b.type];
      if (!def || !def.solid) continue;
      if (def.gate && (b.owner === m.id || (m.clanId && b.clanId === m.clanId))) continue;
      if (Math.abs(x - b.x) < def.w / 2 + r && Math.abs(y - b.y) < def.h / 2 + r) return true;
    }
    return false;
  }
  function validPlacement(x, y, def) {
    if (!S) return { ok: false, key: 'toast.too_far' };
    if (dist(x, y, S.me.x, S.me.y) > 300) return { ok: false, key: 'toast.too_far' };
    if (x < S.border + def.w / 2 || y < S.border + def.h / 2 || x > S.size - S.border - def.w / 2 || y > S.size - S.border - def.h / 2) return { ok: false, key: 'toast.too_far' };
    for (const b of S.buildings.values()) {
      const bd = DEFS.BUILDINGS[b.type];
      if (!bd) continue;
      if (Math.abs(x - b.x) < bd.w / 2 + def.w / 2 && Math.abs(y - b.y) < bd.h / 2 + def.h / 2) return { ok: false, key: 'toast.blocked' };
    }
    if (!DEFS.canAfford({ wood: S.me.wood, stone: S.me.stone, gold: S.me.gold }, def.cost)) return { ok: false, key: 'toast.no_resources' };
    return { ok: true };
  }
  function placeAtMouse() {
    if (!S || !S.buildType) return;
    updateMouseWorld();
    const def = DEFS.BUILDINGS[S.buildType];
    const v = validPlacement(S.mouse.wx, S.mouse.wy, def);
    if (!v.ok) { toast(t(v.key), 'warn'); play('error'); return; }
    send({ t: 'build', type: S.buildType, x: Math.round(S.mouse.wx), y: Math.round(S.mouse.wy) });
    play('build');
    S.buildType = null;
  }
  function updateMouseWorld() {
    if (!S) return;
    const wx = (S.mouse.x - vw / 2) / S.zoom + S.camera.x;
    const wy = (S.mouse.y - vh / 2) / S.zoom + S.camera.y;
    S.mouse.wx = wx; S.mouse.wy = wy;
  }
  function tryAttack() {
    if (!S || S.me.dead || S.paused || S.buildType) return;
    const ts = performance.now();
    if (ts - S.lastAttack < 470) return;
    S.lastAttack = ts;
    S.me.swingUntil = ts + 200;
    send({ t: 'atk', a: S.me.dir });
    play('swing');
  }

  /* ========================================================
     update loop
     ======================================================== */
  let lastFrame = 0;
  let lastPrune = 0;
  function loop(ts) {
    if (!S) { rafId = 0; return; }
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(0.05, lastFrame ? (ts - lastFrame) / 1000 : 0.016);
    lastFrame = ts;
    updateGame(dt, ts);
    renderGame(ts);
    if (ts - lastPrune > 2500) {
      lastPrune = ts;
      for (const [id, p] of S.players) {
        if (now() - p.lastSeen > 6000 && dist(p.x, p.y, S.me.x, S.me.y) > 2400) S.players.delete(id);
      }
    }
  }

  function updateGame(dt, ts) {
    if (!S) return;
    updateMouseWorld();
    const m = S.me;
    S.zoom = clamp(vw / 1250 + 0.18, 0.8, 1.42);
    if (!S.paused) {
      if (!m.dead) {
        let dx = 0, dy = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
        const typing = document.activeElement === $('#chatInput');
        if (typing) dx = dy = 0;
        if (dx || dy) {
          const len = Math.hypot(dx, dy);
          dx /= len; dy /= len;
          const sp = DEFS.PLAYER.speed;
          const nx = m.x + dx * sp * dt;
          const ny = m.y + dy * sp * dt;
          if (!collidesAt(nx, m.y, DEFS.PLAYER.radius)) m.x = nx;
          if (!collidesAt(m.x, ny, DEFS.PLAYER.radius)) m.y = ny;
          m.x = clamp(m.x, S.border + 16, S.size - S.border - 16);
          m.y = clamp(m.y, S.border + 16, S.size - S.border - 16);
          m.moving = true;
          if (ts - S.lastDust > 130) {
            S.lastDust = ts;
            spawnParticle(m.x + (Math.random() - 0.5) * 12, m.y + 4, 'rgba(226,206,150,0.55)', 2 + Math.random() * 2, 0.5);
          }
        } else m.moving = false;
        if (S.mouse.wx != null) m.dir = Math.atan2(S.mouse.wy - m.y, S.mouse.wx - m.x);
        if (S.attackHeld) tryAttack();
        if (performance.now() - S.lastInputAt > 72) {
          S.lastInputAt = performance.now();
          send({ t: 'in', x: m.x, y: m.y, d: m.dir, m: m.moving ? 1 : 0 });
        }
      } else {
        m.moving = false;
      }
    }
    // interpolate remotes
    const k = Math.min(1, dt * 12);
    for (const p of S.players.values()) {
      p.x = lerp(p.x, p.tx, k);
      p.y = lerp(p.y, p.ty, k);
    }
    // camera
    const tx = m.x, ty = m.y;
    S.camera.x = lerp(S.camera.x, tx, Math.min(1, dt * 8));
    S.camera.y = lerp(S.camera.y, ty, Math.min(1, dt * 8));
    const halfW = vw / (2 * S.zoom), halfH = vh / (2 * S.zoom);
    if (S.size * S.zoom <= vw) S.camera.x = S.size / 2;
    else S.camera.x = clamp(S.camera.x, halfW, S.size - halfW);
    if (S.size * S.zoom <= vh) S.camera.y = S.size / 2;
    else S.camera.y = clamp(S.camera.y, halfH, S.size - halfH);
    // effects
    for (let i = S.particles.length - 1; i >= 0; i--) {
      const p = S.particles[i];
      p.life -= dt;
      if (p.life <= 0) { S.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 8 * dt;
    }
    for (let i = S.floats.length - 1; i >= 0; i--) {
      const f = S.floats[i];
      f.life -= dt;
      if (f.life <= 0) S.floats.splice(i, 1);
      else f.y -= 26 * dt;
    }
    S.arrows = S.arrows.filter(a => performance.now() - a.start < 260);
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 26);
    // HUD throttle
    if (ts - S.lastPrompt > 110) { S.lastPrompt = ts; updatePrompt(); }
    if (ts - S.lastMap > 220) { S.lastMap = ts; drawMinimap(); }
    if (ts - S.lastEventUi > 240) { S.lastEventUi = ts; updateEventUI(false); }
    if (!$('#mapOverlay').classList.contains('hidden') && ts - (S.lastBigMap || 0) > 900) {
      S.lastBigMap = ts; drawBigMap();
    }
    if (S.deathShown) updateDeathTimer();
  }

  /* ========================================================
     effects
     ======================================================== */
  function spawnParticle(x, y, color, size, life) {
    if (!S || S.particles.length > 120) return;
    S.particles.push({
      x, y, vx: (Math.random() - 0.5) * 18, vy: -8 - Math.random() * 12,
      color, size: size || 2, life: life || 0.5, max: life || 0.5
    });
  }
  function spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      if (!S) return;
      S.particles.push({
        x, y: y - 10, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 60,
        color, size: 2 + Math.random() * 2.5, life: 0.35 + Math.random() * 0.25, max: 0.6
      });
    }
  }
  function addFloat(x, y, text, color) {
    if (!S) return;
    S.floats.push({ x, y: y - 20, text, color, life: 0.9, max: 0.9 });
    if (S.floats.length > 30) S.floats.shift();
  }

  /* ========================================================
     render
     ======================================================== */
  function renderGame(ts) {
    if (!S) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#3f7a34';
    ctx.fillRect(0, 0, vw, vh);
    const shakeX = S.shake ? (Math.random() - 0.5) * S.shake : 0;
    const shakeY = S.shake ? (Math.random() - 0.5) * S.shake : 0;
    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(S.zoom, S.zoom);
    ctx.translate(-S.camera.x + shakeX, -S.camera.y + shakeY);
    const halfW = vw / (2 * S.zoom), halfH = vh / (2 * S.zoom);
    const view = { x: S.camera.x - halfW - 80, y: S.camera.y - halfH - 80, w: halfW * 2 + 160, h: halfH * 2 + 160 };

    // grass
    if (grassPattern) {
      ctx.fillStyle = grassPattern;
      ctx.fillRect(view.x - 400, view.y - 400, view.w + 800, view.h + 800);
    }
    // soft sunlight patches
    const cell = 420;
    const gx0 = Math.floor(view.x / cell), gx1 = Math.ceil((view.x + view.w) / cell);
    const gy0 = Math.floor(view.y / cell), gy1 = Math.ceil((view.y + view.h) / cell);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const h = Sprites.hash(gx + ':' + gy);
        if (h % 3) continue;
        const px = gx * cell + (h % 300), py = gy * cell + ((h >> 5) % 300);
        ctx.fillStyle = h % 2 ? 'rgba(255,250,200,0.075)' : 'rgba(130,200,110,0.10)';
        ctx.beginPath();
        ctx.ellipse(px, py, 120 + h % 90, 70 + h % 50, (h % 10) / 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    Sprites.drawBoundary(ctx, view, S.size, S.border);

    // ground items
    for (const g of S.ground.values()) {
      if (g.x < view.x || g.y < view.y || g.x > view.x + view.w || g.y > view.y + view.h) continue;
      Sprites.drawGroundItem(ctx, g, ts);
    }

    // depth-sorted entities
    const list = [];
    for (const b of S.buildings.values()) {
      if (b.x < view.x - 80 || b.y < view.y - 80 || b.x > view.x + view.w + 80 || b.y > view.y + view.h + 80) continue;
      list.push({ y: b.y, k: 'b', b });
    }
    for (const p of S.players.values()) {
      if (p.dead) continue;
      if (p.x < view.x || p.y < view.y || p.x > view.x + view.w || p.y > view.y + view.h) continue;
      list.push({ y: p.y, k: 'p', p });
    }
    if (!S.me.dead) list.push({ y: S.me.y, k: 'me' });
    if (S.event && S.event.active) list.push({ y: S.event.y, k: 'e' });
    list.sort((a, b) => a.y - b.y);

    const meDraw = playerDrawState(S.me, ts);
    for (const it of list) {
      if (it.k === 'b') {
        const b = it.b;
        const def = DEFS.BUILDINGS[b.type];
        if (!def) continue;
        Sprites.drawBuilding(ctx, b.type, b.x, b.y, b.level || 1, ts, b.hp / b.hpMax);
        if (b.hp < b.hpMax) drawHpBar(b.x, b.y - def.h / 2 - 12, 40, b.hp / b.hpMax);
        if (def.cat === 'farm' && (b.owner === S.me.id || (S.me.clanId && b.clanId === S.me.clanId))) {
          const fs = S.farmState.get(b.id);
          const total = fs ? fs.total : Math.floor((b.wood || 0) + (b.stone || 0));
          const goldAmt = fs ? fs.gold : 0;
          if (total > 0 || goldAmt > 0) {
            const cap = 45 * (b.level || 1);
            const frac = def.res === 'gold' ? clamp(goldAmt / 10, 0, 1) : clamp(total / cap, 0, 1);
            drawBufferBar(b.x, b.y + def.h / 2 + 8, 38, frac, def.res === 'gold' ? '#e0b24a' : def.res === 'wood' ? '#a9763f' : '#9aa1a8');
            ctx.save();
            ctx.font = 'bold 10px Georgia';
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(30,45,20,0.75)';
            ctx.fillText(def.res === 'gold' ? Math.floor(goldAmt) : Math.floor(total), b.x + 1, b.y + def.h / 2 + 21);
            ctx.fillStyle = '#fff4d4';
            ctx.fillText(def.res === 'gold' ? Math.floor(goldAmt) : Math.floor(total), b.x, b.y + def.h / 2 + 20);
            ctx.restore();
          }
        }
      } else if (it.k === 'p') {
        const p = it.p;
        Sprites.drawPlayer(ctx, playerDrawState(p, ts));
        Sprites.drawName(ctx, playerDrawState(p, ts));
      } else if (it.k === 'me') {
        Sprites.drawPlayer(ctx, meDraw);
        Sprites.drawName(ctx, meDraw);
      } else if (it.k === 'e') {
        Sprites.drawEventChest(ctx, S.event.x, S.event.y, ts);
      }
    }

    // arrows
    for (const a of S.arrows) {
      const pr = clamp((performance.now() - a.start) / 230, 0, 1);
      const x = lerp(a.x, a.tx, pr), y = lerp(a.y, a.ty, pr);
      const ang = Math.atan2(a.ty - a.y, a.tx - a.x);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.strokeStyle = '#5b3d22'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(8, 0); ctx.stroke();
      ctx.fillStyle = '#d9dde0';
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(5, -3); ctx.lineTo(5, 3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // particles
    for (const p of S.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // placement ghost
    if (S.buildType) {
      const def = DEFS.BUILDINGS[S.buildType];
      if (def) {
        const v = validPlacement(S.mouse.wx, S.mouse.wy, def);
        ctx.globalAlpha = 0.55;
        Sprites.drawBuilding(ctx, S.buildType, S.mouse.wx, S.mouse.wy, 1, ts, 1);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = v.ok ? 'rgba(150,230,120,0.9)' : 'rgba(230,90,70,0.9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(S.mouse.wx, S.mouse.wy, Math.max(def.w, def.h) / 2 + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = v.ok ? 'rgba(150,230,120,0.10)' : 'rgba(230,90,70,0.12)';
        ctx.fill();
      }
    }

    // floating text
    for (const f of S.floats) {
      ctx.globalAlpha = clamp(f.life / f.max, 0, 1);
      ctx.font = 'bold 16px Cinzel, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(30,40,20,0.6)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // vignette
    const grd = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.42, vw / 2, vh / 2, Math.max(vw, vh) * 0.72);
    grd.addColorStop(0, 'rgba(20,40,16,0)');
    grd.addColorStop(1, 'rgba(20,40,16,0.24)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, vw, vh);
  }

  function playerDrawState(p, ts) {
    return {
      id: p.id, name: p.name, gender: p.gender, clanTag: p.clanTag,
      x: p.x, y: p.y, dir: p.dir || 0, moving: !!p.moving,
      hp: p.hp == null ? 100 : p.hp,
      time: ts,
      armorTier: p.armorTier == null ? 1 : p.armorTier,
      armorColor: Sprites.armorColor(['', 'leather_armor', 'iron_armor', 'steel_armor', 'golden_armor'][p.armorTier == null ? 1 : p.armorTier] || ''),
      weaponTier: p.weaponTier || 0,
      weaponType: p.weaponType || 'wooden_sword',
      swing: p.swingUntil && ts < p.swingUntil,
      shielded: p.shieldUntil && Date.now() < p.shieldUntil,
      dead: !!p.dead
    };
  }

  function drawHpBar(x, y, w, frac) {
    ctx.fillStyle = 'rgba(30,42,22,0.6)';
    ctx.fillRect(x - w / 2, y, w, 5);
    ctx.fillStyle = frac > 0.5 ? '#78c95a' : frac > 0.25 ? '#e0b24a' : '#d95b4c';
    ctx.fillRect(x - w / 2 + 1, y + 1, (w - 2) * clamp(frac, 0, 1), 3);
  }
  function drawBufferBar(x, y, w, frac, color) {
    ctx.fillStyle = 'rgba(30,42,22,0.55)';
    ctx.fillRect(x - w / 2, y, w, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2 + 1, y + 1, (w - 2) * clamp(frac, 0, 1), 3);
    ctx.strokeStyle = 'rgba(240,220,170,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - w / 2, y, w, 5);
  }

  /* ========================================================
     HUD helpers
     ======================================================== */
  function updatePrompt() {
    if (!S) return;
    const el = $('#prompt');
    if (S.buildType) {
      const def = DEFS.BUILDINGS[S.buildType];
      el.innerHTML = '<b>B</b> ' + esc(bldLabel(S.buildType)) + ' · ' + esc(t('build.place'));
      el.classList.remove('hidden');
      return;
    }
    if (S.me.dead) { el.classList.add('hidden'); return; }
    const m = S.me;
    let best = null, bestD = 1e9, bestKind = null;
    if (S.event && S.event.active) {
      const d = dist(m.x, m.y, S.event.x, S.event.y);
      if (d < 125) { best = { d }; bestKind = 'event'; bestD = d; }
    }
    for (const g of S.ground.values()) {
      const d = dist(m.x, m.y, g.x, g.y);
      if (d < 100 && d < bestD) { bestD = d; bestKind = 'ground'; best = g; }
    }
    for (const b of S.buildings.values()) {
      const def = DEFS.BUILDINGS[b.type];
      if (!def) continue;
      const d = dist(m.x, m.y, b.x, b.y);
      if (d > 135) continue;
      if (def.cat === 'storage') {
        if (def.goldChest && b.owner !== m.id) continue;
        if (!def.goldChest && b.owner !== m.id && !(m.clanId && b.clanId === m.clanId)) continue;
        if (d < bestD) { bestD = d; bestKind = 'chest'; best = b; }
      } else if (def.cat === 'farm' && (b.owner === m.id || (m.clanId && b.clanId === m.clanId))) {
        if (d < bestD + 6) {
          const fs = S.farmState.get(b.id);
          const total = fs ? fs.total : Math.floor((b.wood || 0) + (b.stone || 0));
          const gold = fs ? fs.gold : 0;
          if (total > 0 || gold > 0) { bestD = Math.min(bestD, d); bestKind = 'farm'; best = b; }
        }
      }
    }
    if (!bestKind) { el.classList.add('hidden'); S.promptText = ''; return; }
    let text = '';
    if (bestKind === 'event') text = '<b>F</b> ' + esc(t('hud.event_here'));
    else if (bestKind === 'ground') {
      const g = best;
      text = '<b>F</b> ' + esc(g.res ? '+' + g.amount + ' ' + resLabel(g.res) : itemLabel(g.item));
    } else if (bestKind === 'chest') {
      const def = DEFS.BUILDINGS[best.type];
      text = '<b>F</b> ' + esc(def.goldChest ? t('chest.gold') : t('chest.player'));
    } else if (bestKind === 'farm') {
      const def = DEFS.BUILDINGS[best.type];
      const fs = S.farmState.get(best.id);
      const total = fs ? fs.total : Math.floor((best.wood || 0) + (best.stone || 0));
      const gold = fs ? fs.gold : 0;
      const lvl = best.level || 1;
      const upgCost = DEFS.UPGRADE_COST[lvl + 1];
      text = '<b>F</b> ' + esc((def.res === 'gold' ? Math.floor(gold) + ' ' + resLabel('gold') : total + ' ' + resLabel(def.res))) +
        (lvl < def.maxLevel && upgCost ? ' · <b>Q</b> ' + esc(t('how.upgrade')) + ' (' + upgCost + ' ' + esc(t('hud.gold')) + ')' : ' · ' + esc(t('hud.level')) + ' ' + lvl + '/5');
    }
    if (el.innerHTML !== text) el.innerHTML = text;
    el.classList.remove('hidden');
  }

  function updateEventUI(force) {
    if (!S) return;
    const active = S.event && S.event.active;
    const pill = $('#eventPill');
    pill.classList.toggle('live', !!active);
    const timeEl = $('#eventTime');
    const banner = $('#eventBanner');
    const minimapEvent = $('#minimapEvent');
    let timeText = '';
    if (active) {
      timeText = 'LIVE';
      const d = Math.round(dist(S.me.x, S.me.y, S.event.x, S.event.y) / 10);
      $('#eventDist').textContent = d + 'm';
      $('#eventBannerSub').textContent = t(d <= 14 ? 'hud.event_here' : 'hud.event_far');
      banner.classList.remove('hidden');
      minimapEvent.classList.remove('hidden');
    } else {
      const left = Math.max(0, (S.event.nextAt || now()) - now());
      const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
      timeText = mm + ':' + String(ss).padStart(2, '0');
      banner.classList.add('hidden');
      minimapEvent.classList.add('hidden');
    }
    if (timeEl.textContent !== timeText) timeEl.textContent = timeText;
    $('#eventBanner').dataset.active = active ? '1' : '0';
  }

  function drawMinimap() {
    if (!S) return;
    const c = $('#minimap');
    const g = c.getContext('2d');
    const w = c.width, sc = w / S.size;
    g.fillStyle = '#74b34f';
    g.fillRect(0, 0, w, w);
    g.fillStyle = 'rgba(255,246,200,0.10)';
    for (let i = 0; i < 8; i++) {
      const h = Sprites.hash('mm' + i);
      g.beginPath();
      g.ellipse((h % w), (h >> 3) % w, 14 + h % 20, 9 + h % 12, h % 3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = 'rgba(60,90,40,0.55)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.moveTo(w * i / 4, 0); g.lineTo(w * i / 4, w); g.stroke();
      g.beginPath(); g.moveTo(0, w * i / 4); g.lineTo(w, w * i / 4); g.stroke();
    }
    g.strokeStyle = '#5c7f3d';
    g.lineWidth = 4;
    g.strokeRect(S.border * sc, S.border * sc, (S.size - S.border * 2) * sc, (S.size - S.border * 2) * sc);
    for (const b of S.buildings.values()) {
      const mine = b.owner === S.me.id || (S.me.clanId && b.clanId === S.me.clanId);
      g.fillStyle = mine ? '#e0b551' : '#8a5a34';
      g.fillRect(b.x * sc - 1.5, b.y * sc - 1.5, 3, 3);
    }
    for (const p of S.players.values()) {
      if (p.dead) continue;
      if (!p.clanTag || !S.clan) continue;
      g.fillStyle = '#5b9bdc';
      g.beginPath(); g.arc(p.x * sc, p.y * sc, 2.3, 0, Math.PI * 2); g.fill();
    }
    if (S.event && S.event.active) {
      const pulse = 6 + Math.sin(now() * 0.006) * 1.6;
      g.fillStyle = 'rgba(255,214,90,0.25)';
      g.beginPath(); g.arc(S.event.x * sc, S.event.y * sc, pulse + 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffdf76';
      g.strokeStyle = '#8a5f12'; g.lineWidth = 1.2;
      g.beginPath(); g.arc(S.event.x * sc, S.event.y * sc, pulse, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // me arrow
    const mx = S.me.x * sc, my = S.me.y * sc;
    g.save();
    g.translate(mx, my);
    g.rotate(S.me.dir || 0);
    g.fillStyle = '#fffbe8';
    g.strokeStyle = '#2f5a32'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -4); g.lineTo(-2, 0); g.lineTo(-4, 4); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  function drawBigMap() {
    if (!S) return;
    const c = $('#bigMap');
    const g = c.getContext('2d');
    const w = c.width, sc = w / S.size;
    g.clearRect(0, 0, w, w);
    g.fillStyle = '#7cbb54';
    g.fillRect(0, 0, w, w);
    g.fillStyle = 'rgba(255,246,200,0.12)';
    for (let i = 0; i < 22; i++) {
      const h = Sprites.hash('bm' + i);
      g.beginPath(); g.ellipse(h % w, (h >> 4) % w, 20 + h % 40, 12 + h % 26, h % 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(70,105,45,0.4)';
    g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      g.beginPath(); g.moveTo(w * i / 8, 0); g.lineTo(w * i / 8, w); g.stroke();
      g.beginPath(); g.moveTo(0, w * i / 8); g.lineTo(w, w * i / 8); g.stroke();
    }
    g.strokeStyle = '#5b7d3c'; g.lineWidth = 8;
    g.strokeRect(S.border * sc, S.border * sc, (S.size - S.border * 2) * sc, (S.size - S.border * 2) * sc);
    for (const b of S.buildings.values()) {
      const def = DEFS.BUILDINGS[b.type];
      if (!def) continue;
      const mine = b.owner === S.me.id;
      const clan = S.me.clanId && b.clanId === S.me.clanId;
      g.fillStyle = mine ? '#e6bb55' : clan ? '#78a8d8' : '#7c5430';
      const r = Math.max(3, def.w * sc * 0.9);
      g.fillRect(b.x * sc - r / 2, b.y * sc - r / 2, r, r);
      g.strokeStyle = 'rgba(45,45,25,0.5)'; g.lineWidth = 1;
      g.strokeRect(b.x * sc - r / 2, b.y * sc - r / 2, r, r);
    }
    for (const p of S.players.values()) {
      if (p.dead) continue;
      const clan = p.clanTag && S.clan;
      if (!clan) continue;
      g.fillStyle = '#4f8fd0';
      g.beginPath(); g.arc(p.x * sc, p.y * sc, 4.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff8e2'; g.lineWidth = 1.5; g.stroke();
    }
    if (S.event && S.event.active) {
      const x = S.event.x * sc, y = S.event.y * sc;
      g.fillStyle = 'rgba(255,216,100,0.25)';
      g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f5c844'; g.strokeStyle = '#7c5610'; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#4a3513';
      g.font = 'bold 14px Cinzel, Georgia, serif';
      g.textAlign = 'center';
      g.fillText('✦', x, y + 5);
    }
    // me
    g.save();
    g.translate(S.me.x * sc, S.me.y * sc);
    g.rotate(S.me.dir || 0);
    g.fillStyle = '#1f5726';
    g.strokeStyle = '#fffbe8'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(11, 0); g.lineTo(-7, -7); g.lineTo(-4, 0); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // coords
    g.fillStyle = 'rgba(60,45,18,0.75)';
    g.font = '12px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText(t('map.you') + ': ' + Math.round(S.me.x) + ', ' + Math.round(S.me.y), w / 2, w - 10);
  }

  function updateDeathTimer() {
    if (!S) return;
    const left = Math.max(0, (S.me.respawnAt || 0) - now());
    $('#deathTimer').textContent = left > 0 ? Math.ceil(left / 1000) + ' ' + t('misc.sec') : '';
    const btn = $('#btnRespawn');
    btn.disabled = left > 0;
  }
  function showDeath(by) {
    if (!S) return;
    S.deathShown = true;
    $('#deathBy').textContent = by ? t('death.by', { name: by }) : '';
    $('#deathOverlay').classList.remove('hidden');
    hideAllUI();
    updateDeathTimer();
  }
  function hideDeath() {
    $('#deathOverlay').classList.add('hidden');
    if (S) S.deathShown = false;
  }
  $('#btnRespawn').addEventListener('click', () => { if (S) send({ t: 'respawn' }); });

  /* ========================================================
     menu bindings
     ======================================================== */
  function bindMenu() {
    $$('#langSwitch button').forEach(b => b.addEventListener('click', () => {
      window.I18N.setLang(b.dataset.lang);
      updateLangButtons();
      play('click');
    }));
    $('#soundBtn').addEventListener('click', () => {
      App.sound = !App.sound;
      lsSet('faber_sound', App.sound ? '1' : '0');
      updateSoundBtn();
      play('click');
    });
    $('#btnPlay').addEventListener('click', () => {
      play('click');
      if (App.profile) openWorlds();
      else { App.pendingPlay = true; openAuth(); }
    });
    $('#btnLeaderboard').addEventListener('click', () => { play('click'); openLeaderboard(); });
    $('#btnHowto').addEventListener('click', () => { play('click'); openHowto(); });
    $('#btnSettings').addEventListener('click', () => { play('click'); openSettings(); });
    $('#btnEditProfile').addEventListener('click', () => { play('click'); if (App.profile) openSettings(); else { App.pendingPlay = true; openAuth(); } });
    $('#btnSignOut').addEventListener('click', signOut);
    $('#btnGuest').addEventListener('click', guestLogin);
    $('#authNick').addEventListener('keydown', e => { if (e.key === 'Enter') guestLogin(); });
    $$('#authGender button').forEach(b => b.addEventListener('click', () => setAuthGender(b.dataset.gender)));
    $$('#setGender button').forEach(b => b.addEventListener('click', () => setSettingsGender(b.dataset.gender)));
    $('#worldRefresh').addEventListener('click', () => { play('click'); fetchConfig(); });
    $('#btnSettingsSave').addEventListener('click', saveSettings);
    $('#btnSetSignOut').addEventListener('click', signOut);
    $('#setLang').addEventListener('change', e => {
      window.I18N.setLang(e.target.value);
      updateLangButtons();
      fillSettings();
    });
    $('#setSound').addEventListener('change', e => {
      App.sound = e.target.checked;
      lsSet('faber_sound', App.sound ? '1' : '0');
      updateSoundBtn();
      if (App.sound) play('click');
    });
    $$('.js-back').forEach(b => b.addEventListener('click', () => { closeScreen(); play('click'); }));
    $$('[data-close]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.close;
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
      if (id === 'chestPanel' && S) S.chest = null;
      play('click');
    }));
    $('#mapOverlay').addEventListener('click', e => {
      if (e.target === $('#mapOverlay')) { $('#mapOverlay').classList.add('hidden'); }
    });
    $('#inventoryPanel').addEventListener('click', e => {
      if (e.target === $('#inventoryPanel')) { $('#inventoryPanel').classList.add('hidden'); }
    });
    $('#chestPanel').addEventListener('click', e => {
      if (e.target === $('#chestPanel')) closeChest();
    });
    $('#pauseOverlay').addEventListener('click', e => {
      if (e.target === $('#pauseOverlay')) togglePause();
    });
    document.addEventListener('langchange', () => {
      updateLangButtons();
      updateProfileUI();
      updateSoundBtn();
      if (App.config) { renderWorlds(); updateMenuOnline(); }
      if (App.leaderboard) renderLeaderboard(App.leaderboard);
      if (isSettingsOpen()) fillSettings();
      if (S) {
        if (S.clan) renderClan();
        if (!$('#buildPanel').classList.contains('hidden')) renderBuildMenu();
        if (!$('#craftPanel').classList.contains('hidden')) renderCraftMenu();
        renderAllSelf();
        updateEventUI(true);
        if (!S.buildType) { $('#prompt').classList.add('hidden'); }
        $('#minimapLabel').textContent = worldName(S.worldId);
        $('#worldPill').textContent = worldName(S.worldId) + ' · ' + clamp(welcomePlayerCount + (S.worldDelta || 0), 0, 50) + ' ' + t('hud.players');
      }
      if (App.googleReady) renderGoogle();
    });
  }

  /* ========================================================
     boot
     ======================================================== */
  function boot() {
    window.I18N.applyStatic();
    $$('[data-icon]').forEach(c => Sprites.drawItemIcon(c, c.dataset.icon));
    updateLangButtons();
    updateSoundBtn();
    bindMenu();
    bindInput();
    buildHotbarDOM();
    buildInventoryDOM();
    updateProfileUI();
    fetchConfig().then(() => { initGoogle(); if (App.token) loadMe(); });
    if (App.token) loadMe();
    updateEventUI(true);
    requestAnimationFrame(loop);
  }

  // welcome player count tracking
  const origEnterGame = enterGame;
  enterGame = function (welcome) {
    welcomePlayerCount = (welcome.players || []).length + 1;
    origEnterGame(welcome);
    $('#worldPill').textContent = worldName(S.worldId) + ' · ' + welcomePlayerCount + ' ' + t('hud.players');
    // start elapsed countdown base
    S.worldDelta = 0;
  };

  boot();
})();
