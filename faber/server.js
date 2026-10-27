'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const D = require('./shared/defs');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const WORLDS = [
  { id: 'w1', name: 'Dünya 1' },
  { id: 'w2', name: 'Dünya 2' },
  { id: 'w3', name: 'Dünya 3' }
];

if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

/* ---------------- persistence ---------------- */
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch (e) { return fallback; }
}
const accountsFile = loadJson('accounts.json', { accounts: {} });
const accounts = accountsFile.accounts && typeof accountsFile.accounts === 'object' ? accountsFile.accounts : {};
const clansRaw = loadJson('clans.json', { clans: {} });
const clans = clansRaw.clans || {};
const worldsRaw = loadJson('worlds.json', { worlds: {} });
const worldsRawData = worldsRaw.worlds || {};

const nickIndex = new Map();
for (const id in accounts) {
  const a = accounts[id];
  a.gold = Math.max(0, Math.floor(a.gold || 0));
  if (!Array.isArray(a.goldChest)) a.goldChest = new Array(D.PLAYER.goldChestSize).fill(null);
  if (a.nickname) nickIndex.set(a.nickname.toLowerCase(), a.id);
}
for (const id in accounts) {
  const a = accounts[id];
  if (a.clanId && !clans[a.clanId]) { a.clanId = null; }
}

let accountsDirty = false, clansDirty = false, worldsDirty = false;
function markAccounts() { accountsDirty = true; }
function markClans() { clansDirty = true; }
function markWorlds() { worldsDirty = true; }
function saveAll(force) {
  try {
    if (accountsDirty || force) {
      fs.writeFileSync(path.join(DATA, 'accounts.json'), JSON.stringify({ accounts }, null, 0));
      accountsDirty = false;
    }
    if (clansDirty || force) {
      fs.writeFileSync(path.join(DATA, 'clans.json'), JSON.stringify({ clans }, null, 0));
      clansDirty = false;
    }
    if (worldsDirty || force) {
      const out = { worlds: {} };
      for (const w of worldList) out.worlds[w.id] = { buildings: [...w.buildings.values()].map(serializeBuilding) };
      fs.writeFileSync(path.join(DATA, 'worlds.json'), JSON.stringify(out, null, 0));
      worldsDirty = false;
    }
  } catch (e) { console.error('Save error:', e.message); }
}
setInterval(() => saveAll(false), 3000);

/* ---------------- helpers ---------------- */
const uid = (n) => crypto.randomBytes(n || 6).toString('hex');
let idCounter = 1;
const nextId = (p) => p + (idCounter++).toString(36) + uid(3);
const now = () => Date.now();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const NICK_RE = /^[\p{L}\p{N}_\.\- ]{2,16}$/u;
function cleanNick(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim(); }
function validNick(s) { return NICK_RE.test(s) && !/\s{2,}/.test(s); }
function clanTag(name) { return String(name || '').replace(/\s+/g, '').slice(0, 5).toUpperCase(); }

function profile(acc) {
  const clan = acc.clanId && clans[acc.clanId] ? clans[acc.clanId] : null;
  return {
    id: acc.id, nickname: acc.nickname, gender: acc.gender, gold: acc.gold,
    clan: clan ? { id: clan.id, name: clan.name, tag: clanTag(clan.name) } : null,
    createdAt: acc.createdAt || 0
  };
}

function send(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}
function sendTo(player, obj) { send(player.ws, obj); }
function broadcastWorld(world, obj, exceptId) {
  const data = JSON.stringify(obj);
  for (const p of world.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === 1) { try { p.ws.send(data); } catch (e) {} }
  }
}

/* ---------------- accounts ---------------- */
function createAccount({ nickname, gender, googleId, email }) {
  const acc = {
    id: 'u' + uid(7),
    nickname,
    gender: gender === 'female' ? 'female' : 'male',
    gold: D.PLAYER.startGold,
    goldChest: new Array(D.PLAYER.goldChestSize).fill(null),
    googleId: googleId || null,
    email: email || null,
    token: uid(24),
    clanId: null,
    createdAt: now()
  };
  accounts[acc.id] = acc;
  nickIndex.set(nickname.toLowerCase(), acc.id);
  markAccounts();
  return acc;
}
function accountByToken(token) {
  if (!token) return null;
  for (const id in accounts) if (accounts[id].token === token) return accounts[id];
  return null;
}
function accountByGoogle(sub) {
  for (const id in accounts) if (accounts[id].googleId === sub) return accounts[id];
  return null;
}
function uniqueNick(base) {
  let n = cleanNick(base).slice(0, 14) || 'Player';
  if (!validNick(n)) n = 'Player';
  if (!nickIndex.has(n.toLowerCase())) return n;
  for (let i = 2; i < 999; i++) {
    const c = n.slice(0, 12) + i;
    if (!nickIndex.has(c.toLowerCase())) return c;
  }
  return 'Player' + uid(3);
}
function publicProfile(acc) {
  return { id: acc.id, name: acc.nickname, gender: acc.gender, clanId: acc.clanId || null };
}

/* ---------------- clans ---------------- */
function clanMembersOnline(clan, worldFilter) {
  const out = [];
  for (const id of clan.members) {
    const p = playersById.get(id);
    if (p && (!worldFilter || p.world === worldFilter)) out.push(p);
  }
  return out;
}
function clanPayload(clan, viewerId) {
  const members = clan.members.map(id => {
    const acc = accounts[id];
    const p = playersById.get(id);
    return { id, name: acc ? acc.nickname : '?', gender: acc ? acc.gender : 'male', online: !!p, leader: id === clan.leaderId };
  });
  const requests = (clan.requests || []).map(id => {
    const acc = accounts[id];
    return acc ? { id, name: acc.nickname, gender: acc.gender } : null;
  }).filter(Boolean);
  return {
    id: clan.id, name: clan.name, leaderId: clan.leaderId,
    isLeader: clan.leaderId === viewerId,
    members, requests,
    maxMembers: D.CLAN.maxMembers
  };
}
function pushClan(clan) {
  if (!clan) return;
  for (const id of clan.members) {
    const p = playersById.get(id);
    if (p) sendTo(p, { t: 'clan', info: clanPayload(clan, id) });
  }
}
function clanListPayload(viewerId) {
  const viewer = accounts[viewerId];
  const own = viewer && viewer.clanId ? clans[viewer.clanId] : null;
  const list = Object.values(clans).map(c => ({
    id: c.id, name: c.name, tag: clanTag(c.name), members: c.members.length,
    leader: accounts[c.leaderId] ? accounts[c.leaderId].nickname : '?',
    requested: !!(viewer && c.requests && c.requests.includes(viewerId)),
    mine: !!(own && own.id === c.id)
  })).sort((a, b) => b.members - a.members).slice(0, 30);
  return { list, own: own ? clanPayload(own, viewerId) : null };
}
function removeFromClan(acc, clan) {
  clan.members = clan.members.filter(x => x !== acc.id);
  clan.requests = (clan.requests || []).filter(x => x !== acc.id);
  acc.clanId = null;
  markClans(); markAccounts();
}

/* ---------------- items ---------------- */
function makeItem(type) { return { uid: 'i' + uid(5), type }; }
function invCount(p) { return p.inv.length + p.hot.filter(Boolean).length; }
function allItems(p) { return p.inv.concat(p.hot.filter(Boolean).map(u => ({ uid: u.uid, type: u.type }))); }
function findItem(p, itemUid) {
  let idx = p.inv.findIndex(i => i.uid === itemUid);
  if (idx >= 0) return { where: 'inv', idx, item: p.inv[idx] };
  idx = p.hot.findIndex(i => i && i.uid === itemUid);
  if (idx >= 0) return { where: 'hot', idx, item: p.hot[idx] };
  return null;
}
function addItem(p, type, silent) {
  const item = makeItem(type);
  if (p.inv.length < D.PLAYER.invSize) p.inv.push(item);
  else {
    dropGround(p.world, p.x, p.y, { item: type, uid: item.uid });
    if (!silent) sendTo(p, { t: 'toast', key: 'inventory_full' });
    return false;
  }
  if (!silent) sendSelf(p);
  return true;
}
function removeItemEverywhere(p, itemUid) {
  p.inv = p.inv.filter(i => i.uid !== itemUid);
  for (let i = 0; i < p.hot.length; i++) if (p.hot[i] && p.hot[i].uid === itemUid) p.hot[i] = null;
  if (!p.hot[p.sel]) {
    const next = p.hot.findIndex(Boolean);
    p.sel = next < 0 ? 0 : next;
  }
}
function selectedItem(p) { return p.hot[p.sel] || null; }
function gear(p) {
  const it = selectedItem(p);
  let weapon = 'fist', armor = 0, armorItem = null;
  if (it && D.ITEMS[it.type]) {
    const def = D.ITEMS[it.type];
    if (def.kind === 'weapon') weapon = it.type;
    if (def.kind === 'armor') { armor = def.armor; armorItem = it.type; }
  }
  if (p.equippedWeapon && D.ITEMS[p.equippedWeapon]) weapon = p.equippedWeapon;
  return { weapon, armor, armorItem, weaponDef: D.ITEMS[weapon] || { dmg: 8, tier: 0 }, armorItem };
}
function weaponDmg(p) {
  const it = selectedItem(p);
  if (it && D.ITEMS[it.type] && D.ITEMS[it.type].kind === 'weapon') return D.ITEMS[it.type].dmg;
  return 8;
}
function armorOf(p) {
  const it = selectedItem(p);
  if (it && D.ITEMS[it.type] && D.ITEMS[it.type].kind === 'armor') return D.ITEMS[it.type].armor;
  return 0;
}
function damageAfterArmor(dmg, armor) { return Math.max(2, Math.round(dmg * 100 / (100 + armor * 2.2))); }

/* ---------------- worlds ---------------- */
const playersById = new Map();

class World {
  constructor(def) {
    this.id = def.id;
    this.name = def.name;
    this.players = new Map();
    this.buildings = new Map();
    this.ground = new Map();
    this.nextEventAt = now() + D.WORLD.eventEveryMs;
    this.event = null;
    this.nextBuildId = 1;
    const saved = worldsRawData[this.id];
    if (saved && Array.isArray(saved.buildings)) {
      for (const b of saved.buildings) {
        if (!b || !D.BUILDINGS[b.type] || !accounts[b.owner]) continue;
        const def = D.BUILDINGS[b.type];
        b.clanId = b.clanId || null;
        b.level = b.level || 1;
        b.hp = b.hp || def.hp;
        b.buffer = def.cat === 'farm'
          ? { wood: b.wood || 0, stone: b.stone || 0, gold: b.gold || 0 }
          : null;
        if (def.cat === 'storage' && !def.goldChest) {
          const slots = Array.isArray(b.contents) ? b.contents.slice(0, D.PLAYER.chestSize) : [];
          b.contents = new Array(D.PLAYER.chestSize).fill(null).map((_, i) => slots[i] || null);
        } else {
          b.contents = null;
        }
        b.createdAt = b.createdAt || now();
        b.lastShot = 0;
        b.lastTrap = 0;
        this.buildings.set(b.id, b);
        const n = parseInt(String(b.id).replace(/\D/g, ''), 10);
        if (n >= this.nextBuildId) this.nextBuildId = n + 1;
      }
    }
  }

  findSpawn() {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 120 + Math.random() * (D.WORLD.spawnRadius - 120);
      const x = D.WORLD.size / 2 + Math.cos(a) * r;
      const y = D.WORLD.size / 2 + Math.sin(a) * r;
      if (!this.buildingAt(x, y, 40)) return { x, y };
    }
    return { x: D.WORLD.size / 2, y: D.WORLD.size / 2 };
  }

  buildingAt(x, y, pad) {
    for (const b of this.buildings.values()) {
      const def = D.BUILDINGS[b.type];
      if (Math.abs(x - b.x) < def.w / 2 + (pad || 0) && Math.abs(y - b.y) < def.h / 2 + (pad || 0)) return b;
    }
    return null;
  }

  collides(x, y, r, player) {
    for (const b of this.buildings.values()) {
      const def = D.BUILDINGS[b.type];
      if (!def.solid) continue;
      if (def.gate && player && (b.owner === player.id || (player.clanId && b.clanId === player.clanId))) continue;
      if (Math.abs(x - b.x) < def.w / 2 + r && Math.abs(y - b.y) < def.h / 2 + r) return b;
    }
    return null;
  }

  addPlayer(acc, ws) {
    const prev = playersById.get(acc.id);
    if (prev) {
      try { prev.ws.close(4000, 'Replaced'); } catch (e) {}
      removePlayer(prev);
    }
    const spawn = this.findSpawn();
    const p = {
      id: acc.id, acc, ws, world: this.id, name: acc.nickname, gender: acc.gender,
      clanId: acc.clanId || null,
      x: spawn.x, y: spawn.y, dir: 0, moving: false, walking: false,
      hp: D.PLAYER.maxHp, dead: false, respawnAt: 0, shieldUntil: now() + 6000,
      inv: [], hot: new Array(D.PLAYER.hotSize).fill(null), sel: 0,
      wood: D.PLAYER.startWood, stone: D.PLAYER.startStone,
      lastMoveAt: now(), lastAttack: 0, lastTrap: 0, lastChat: 0,
      joinedAt: now(), dirty: true, lastMsg: 0
    };
    p.inv.push(makeItem('wooden_sword'));
    p.sel = 0;
    this.players.set(p.id, p);
    playersById.set(p.id, p);
    return p;
  }

  removePlayer(p) {
    this.players.delete(p.id);
    playersById.delete(p.id);
  }

  spawnPacket(p) {
    return {
      id: p.id, name: p.name, gender: p.gender, clanId: p.clanId,
      clanTag: p.clanId && clans[p.clanId] ? clanTag(clans[p.clanId].name) : null
    };
  }
}

function serializeBuilding(b) {
  const def = D.BUILDINGS[b.type];
  return {
    id: b.id, type: b.type, x: b.x, y: b.y, owner: b.owner, clanId: b.clanId || null,
    hp: b.hp, hpMax: def.hp, level: b.level || 1, wood: b.buffer ? b.buffer.wood || 0 : 0,
    stone: b.buffer ? b.buffer.stone || 0 : 0, gold: b.buffer ? b.buffer.gold || 0 : 0,
    contents: b.contents || []
  };
}
function bPacket(b) {
  return {
    id: b.id, type: b.type, x: b.x, y: b.y, owner: b.owner, clanId: b.clanId || null,
    hp: b.hp, hpMax: D.BUILDINGS[b.type].hp, level: b.level || 1,
    wood: b.buffer ? b.buffer.wood || 0 : 0, stone: b.buffer ? b.buffer.stone || 0 : 0
  };
}

const worldList = WORLDS.map(w => new World(w));
const worldMap = new Map(worldList.map(w => [w.id, w]));

/* ---------------- ground items ---------------- */
function dropGround(worldId, x, y, data) {
  const w = worldMap.get(worldId);
  if (!w) return;
  const g = {
    id: nextId('g'), x: clamp(x + (Math.random() - 0.5) * 24, D.WORLD.border, D.WORLD.size - D.WORLD.border),
    y: clamp(y + (Math.random() - 0.5) * 24, D.WORLD.border, D.WORLD.size - D.WORLD.border),
    item: data.item || null, res: data.res || null, amount: data.amount || 0,
    createdAt: now()
  };
  w.ground.set(g.id, g);
  broadcastWorld(w, { t: 'gadd', g: { id: g.id, x: g.x, y: g.y, item: g.item, res: g.res, amount: g.amount } });
  return g;
}
function removeGround(w, id) {
  if (!w.ground.has(id)) return;
  w.ground.delete(id);
  broadcastWorld(w, { t: 'grem', id });
}
function materialName(res, amount) { return amount + ' ' + res; }

/* ---------------- self state ---------------- */
function sendSelf(p) {
  if (!p || p.ws.readyState !== 1) return;
  sendTo(p, {
    t: 'self', hp: p.hp, dead: p.dead, respawnAt: p.respawnAt,
    wood: p.wood, stone: p.stone, gold: p.acc.gold,
    inv: p.inv.map(i => ({ u: i.uid, t: i.type })),
    hot: p.hot.map(i => i ? { u: i.uid, t: i.type } : null),
    sel: p.sel, shieldUntil: p.shieldUntil
  });
  p.dirty = false;
}

function playerStateArr(p) {
  const it = selectedItem(p);
  const idef = it && D.ITEMS[it.type];
  const weaponTier = idef && idef.kind === 'weapon' ? idef.tier : 0;
  const armorTier = idef && idef.kind === 'armor' ? idef.tier : 0;
  return [p.id, Math.round(p.x), Math.round(p.y), p.dir, p.moving ? 1 : 0,
    p.hp, p.dead ? 1 : 0, p.attackUntil && p.attackUntil > now() ? 1 : 0,
    armorTier, weaponTier];
}

/* ---------------- death ---------------- */
function dropInventory(p) {
  for (const it of p.inv) dropGround(p.world, p.x, p.y, { item: it.type });
  for (const it of p.hot) if (it) dropGround(p.world, p.x, p.y, { item: it.type });
  if (p.wood > 0) dropGround(p.world, p.x, p.y, { res: 'wood', amount: Math.floor(p.wood) });
  if (p.stone > 0) dropGround(p.world, p.x, p.y, { res: 'stone', amount: Math.floor(p.stone) });
  p.inv = [];
  p.hot = new Array(D.PLAYER.hotSize).fill(null);
  p.sel = 0;
  p.wood = 0;
  p.stone = 0;
}
function killPlayer(p, killer) {
  if (p.dead) return;
  p.dead = true;
  p.hp = 0;
  p.respawnAt = now() + D.PLAYER.respawnMs;
  const w = worldMap.get(p.world);
  dropInventory(p);
  broadcastWorld(w, { t: 'death', id: p.id, by: killer ? killer.id : null, x: Math.round(p.x), y: Math.round(p.y) });
  sendTo(p, { t: 'died', by: killer ? killer.name : null, respawnAt: p.respawnAt });
  sendSelf(p);
  if (killer) {
    sendTo(killer, { t: 'toast', key: 'killed_player', args: { name: p.name } });
    broadcastWorld(w, { t: 'sys', key: 'player_killed', args: { a: killer.name, b: p.name }, except: null, ts: now() });
  }
  markAccounts();
}

function respawn(p) {
  const w = worldMap.get(p.world);
  const spawn = w.findSpawn();
  p.dead = false;
  p.hp = D.PLAYER.maxHp;
  p.x = spawn.x; p.y = spawn.y;
  p.respawnAt = 0;
  p.shieldUntil = now() + 5000;
  p.wood = D.PLAYER.startWood;
  p.stone = D.PLAYER.startStone;
  p.inv.push(makeItem('wooden_sword'));
  p.sel = 0;
  sendTo(p, { t: 'respawned', x: Math.round(p.x), y: Math.round(p.y) });
  sendSelf(p);
  broadcastWorld(w, { t: 'sys', key: 'player_respawned', args: { name: p.name }, ts: now() });
}

/* ---------------- combat ---------------- */
function tryHitPlayer(attacker, aim) {
  const w = worldMap.get(attacker.world);
  let best = null, bestD = Infinity;
  for (const p of w.players.values()) {
    if (p.id === attacker.id || p.dead) continue;
    if (attacker.clanId && p.clanId === attacker.clanId) continue;
    const d2 = dist2(attacker.x, attacker.y, p.x, p.y);
    if (d2 > (D.PLAYER.reach + 26) * (D.PLAYER.reach + 26)) continue;
    const ang = Math.atan2(p.y - attacker.y, p.x - attacker.x);
    let diff = Math.abs(ang - aim);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > 1.15) continue;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}
function tryHitBuilding(attacker, aim) {
  const w = worldMap.get(attacker.world);
  let best = null, bestD = Infinity;
  for (const b of w.buildings.values()) {
    if (b.owner === attacker.id) continue;
    if (attacker.clanId && b.clanId === attacker.clanId) continue;
    const def = D.BUILDINGS[b.type];
    const d2 = dist2(attacker.x, attacker.y, b.x, b.y);
    const reach = D.PLAYER.reach + Math.max(def.w, def.h) / 2;
    if (d2 > reach * reach) continue;
    const ang = Math.atan2(b.y - attacker.y, b.x - attacker.x);
    let diff = Math.abs(ang - aim);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (diff > 1.35) continue;
    if (d2 < bestD) { bestD = d2; best = b; }
  }
  return best;
}
function damageBuilding(w, b, dmg, attacker) {
  b.hp -= dmg;
  broadcastWorld(w, { t: 'bhp', id: b.id, hp: Math.max(0, b.hp) });
  if (b.hp <= 0) destroyBuilding(w, b, attacker);
  else markWorlds();
}
function destroyBuilding(w, b, attacker) {
  const def = D.BUILDINGS[b.type];
  w.buildings.delete(b.id);
  broadcastWorld(w, { t: 'brem', id: b.id });
  if (def.goldChest) {
    // contents live on the owner's account, so they are safe
  } else if (b.contents && b.contents.length) {
    for (const type of b.contents) if (type) dropGround(w.id, b.x, b.y, { item: type });
  }
  if (b.buffer) {
    if (b.buffer.wood >= 1) dropGround(w.id, b.x, b.y, { res: 'wood', amount: Math.floor(b.buffer.wood) });
    if (b.buffer.stone >= 1) dropGround(w.id, b.x, b.y, { res: 'stone', amount: Math.floor(b.buffer.stone) });
  }
  if (attacker) sendTo(attacker, { t: 'toast', key: 'building_destroyed', args: { name: b.type } });
  markWorlds();
}

/* ---------------- building / farming ---------------- */
function placeBuilding(p, type, x, y) {
  const w = worldMap.get(p.world);
  const def = D.BUILDINGS[type];
  if (!def || p.dead) return;
  if (!D.canAfford({ wood: p.wood, stone: p.stone, gold: p.acc.gold }, def.cost)) return sendTo(p, { t: 'toast', key: 'no_resources' });
  if (x < D.WORLD.border + def.w / 2 || y < D.WORLD.border + def.h / 2 || x > D.WORLD.size - D.WORLD.border - def.w / 2 || y > D.WORLD.size - D.WORLD.border - def.h / 2) return sendTo(p, { t: 'toast', key: 'too_far' });
  if (dist2(p.x, p.y, x, y) > 300 * 300) return sendTo(p, { t: 'toast', key: 'too_far' });
  if (w.buildingAt(x, y, 10)) return sendTo(p, { t: 'toast', key: 'blocked' });
  if (def.solid && w.collides(x, y, 10, null)) return sendTo(p, { t: 'toast', key: 'blocked' });
  for (const op of w.players.values()) {
    if (op.id !== p.id && dist2(x, y, op.x, op.y) < 40 * 40) return sendTo(p, { t: 'toast', key: 'blocked' });
  }
  p.wood -= def.cost.wood || 0;
  p.stone -= def.cost.stone || 0;
  p.acc.gold -= def.cost.gold || 0;
  const b = {
    id: 'b' + (w.nextBuildId++), type, x, y, owner: p.id, clanId: p.clanId || null,
    hp: def.hp, level: 1, buffer: def.cat === 'farm' ? { wood: 0, stone: 0, gold: 0 } : null,
    contents: def.cat === 'storage' && !def.goldChest ? new Array(D.PLAYER.chestSize).fill(null) : null,
    createdAt: now(), lastShot: 0, lastTrap: 0
  };
  w.buildings.set(b.id, b);
  broadcastWorld(w, { t: 'badd', b: bPacket(b) });
  sendSelf(p);
  markWorlds(); markAccounts();
}

function collectFarm(p, b) {
  const def = D.BUILDINGS[b.type];
  const w = worldMap.get(p.world);
  if (!def.cat || def.cat !== 'farm') return false;
  if (def.res === 'gold') {
    const g = Math.floor(b.buffer.gold || 0);
    if (g < 1) { sendTo(p, { t: 'toast', key: 'nothing_collect' }); return true; }
    b.buffer.gold -= g;
    p.acc.gold += g;
    markAccounts();
    sendTo(p, { t: 'toast', key: 'gold_collected', args: { n: g } });
    sendSelf(p);
    markWorlds();
    return true;
  }
  const amt = Math.floor(b.buffer[def.res] || 0);
  if (amt < 1) { sendTo(p, { t: 'toast', key: 'nothing_collect' }); return true; }
  b.buffer[def.res] -= amt;
  p[def.res] += amt;
  sendTo(p, { t: 'toast', key: 'collected', args: { n: amt, res: def.res } });
  sendSelf(p);
  markWorlds();
  return true;
}

function upgradeBuilding(p, b) {
  if (!b) return;
  const def = D.BUILDINGS[b.type];
  if (!def.cat || def.cat !== 'farm') return sendTo(p, { t: 'toast', key: 'invalid' });
  if (b.owner !== p.id && b.clanId !== p.clanId) return sendTo(p, { t: 'toast', key: 'not_owner' });
  const lvl = b.level || 1;
  if (lvl >= def.maxLevel) return sendTo(p, { t: 'toast', key: 'max_level' });
  const cost = D.UPGRADE_COST[lvl + 1];
  if (p.acc.gold < cost) return sendTo(p, { t: 'toast', key: 'need_gold', args: { n: cost } });
  p.acc.gold -= cost;
  b.level = lvl + 1;
  markAccounts(); markWorlds();
  broadcastWorld(worldMap.get(p.world), { t: 'bupd', b: bPacket(b) });
  sendTo(p, { t: 'toast', key: 'upgraded', args: { n: b.level } });
  sendSelf(p);
}

function upgradeNearest(p) {
  const w = worldMap.get(p.world);
  let best = null, bd = 130 * 130;
  for (const b of w.buildings.values()) {
    const def = D.BUILDINGS[b.type];
    if (def.cat !== 'farm') continue;
    if (b.owner !== p.id && b.clanId !== p.clanId) continue;
    const d = dist2(p.x, p.y, b.x, b.y);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return sendTo(p, { t: 'toast', key: 'not_near' });
  upgradeBuilding(p, best);
}

/* ---------------- chests ---------------- */
function openChest(p, b) {
  const def = D.BUILDINGS[b.type];
  if (def.cat !== 'storage') return false;
  if (def.goldChest) {
    if (b.owner !== p.id) return sendTo(p, { t: 'toast', key: 'gold_chest_locked' });
    sendTo(p, { t: 'chest', id: b.id, goldChest: true, slots: p.acc.goldChest.slice() });
  } else {
    if (b.owner !== p.id && b.clanId !== p.clanId) return sendTo(p, { t: 'toast', key: 'not_owner' });
    sendTo(p, { t: 'chest', id: b.id, goldChest: false, slots: b.contents.slice() });
  }
  return true;
}
function transferItem(p, b, dir, uidValue) {
  const w = worldMap.get(p.world);
  const def = D.BUILDINGS[b.type];
  if (!def || def.cat !== 'storage') return;
  if (b.owner !== p.id && b.clanId !== p.clanId) return sendTo(p, { t: 'toast', key: 'not_owner' });
  if (def.goldChest && b.owner !== p.id) return sendTo(p, { t: 'toast', key: 'gold_chest_locked' });
  const slots = def.goldChest ? p.acc.goldChest : b.contents;
  if (dir === 'in') {
    const f = findItem(p, uidValue);
    if (!f) return;
    const idx = slots.indexOf(null);
    if (idx < 0) return sendTo(p, { t: 'toast', key: 'chest_full' });
    slots[idx] = f.item.type;
    removeItemEverywhere(p, uidValue);
  } else {
    const idx = slots.findIndex((s, i) => s && ('c' + i) === uidValue);
    if (idx < 0) return;
    const type = slots[idx];
    if (invCount(p) >= D.PLAYER.invSize + D.PLAYER.hotSize) return sendTo(p, { t: 'toast', key: 'inventory_full' });
    slots[idx] = null;
    addItem(p, type, true);
  }
  markAccounts(); markWorlds();
  sendSelf(p);
  if (def.goldChest) sendTo(p, { t: 'chest', id: b.id, goldChest: true, slots: slots.slice() });
  else sendTo(p, { t: 'chest', id: b.id, goldChest: false, slots: slots.slice() });
}

/* ---------------- ground pickup & use ---------------- */
function pickupNearest(p) {
  const w = worldMap.get(p.world);
  let best = null, bd = 110 * 110;
  for (const g of w.ground.values()) {
    const d = dist2(p.x, p.y, g.x, g.y);
    if (d < bd) { bd = d; best = g; }
  }
  if (!best) return false;
  if (best.res) {
    p[best.res] += best.amount;
    sendTo(p, { t: 'toast', key: 'picked_up_res', args: { n: best.amount, res: best.res } });
    removeGround(w, best.id);
    sendSelf(p);
    return true;
  }
  if (invCount(p) >= D.PLAYER.invSize + D.PLAYER.hotSize) {
    sendTo(p, { t: 'toast', key: 'inventory_full' });
    return true;
  }
  addItem(p, best.item, true);
  sendTo(p, { t: 'toast', key: 'picked_up', args: { name: best.item } });
  removeGround(w, best.id);
  sendSelf(p);
  return true;
}

function useNearest(p) {
  if (p.dead) return;
  const w = worldMap.get(p.world);
  if (w.event && w.event.active && dist2(p.x, p.y, w.event.x, w.event.y) < 115 * 115) {
    claimEvent(p, w);
    return;
  }
  let best = null, bd = 115 * 115, kind = null;
  for (const b of w.buildings.values()) {
    const def = D.BUILDINGS[b.type];
    if (def.cat === 'farm') {
      if (b.owner !== p.id && b.clanId !== p.clanId) continue;
      if ((b.buffer.wood || 0) + (b.buffer.stone || 0) + (b.buffer.gold || 0) < 1) continue;
      const d = dist2(p.x, p.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; kind = 'farm'; }
    } else if (def.cat === 'storage') {
      const d = dist2(p.x, p.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; kind = 'chest'; }
    }
  }
  let gBest = null, gd = 100 * 100;
  for (const g of w.ground.values()) {
    const d = dist2(p.x, p.y, g.x, g.y);
    if (d < gd) { gd = d; gBest = g; }
  }
  if (gBest && (!best || gd < bd)) { pickupNearest(p); return; }
  if (!best) { sendTo(p, { t: 'toast', key: 'not_near' }); return; }
  if (kind === 'farm') collectFarm(p, best);
  else openChest(p, best);
}

/* ---------------- event ---------------- */
function startEvent(w) {
  const margin = 200;
  const x = margin + Math.random() * (D.WORLD.size - margin * 2);
  const y = margin + Math.random() * (D.WORLD.size - margin * 2);
  w.event = { active: true, x, y, startedAt: now() };
  w.nextEventAt = now() + D.WORLD.eventEveryMs;
  broadcastWorld(w, { t: 'ev', active: true, x: Math.round(x), y: Math.round(y), nextAt: w.nextEventAt });
  broadcastWorld(w, { t: 'sys', key: 'event_started', ts: now() });
  broadcastWorld(w, { t: 'toast', key: 'event_started' });
}
function claimEvent(p, w) {
  const ev = w.event;
  if (!ev || !ev.active) return;
  ev.active = false;
  const roll = Math.random();
  const loots = [];
  if (roll < D.EVENT_LOOT.legendaryChance) {
    addItem(p, 'legendary_sword', true);
    loots.push('legendary_sword');
  } else {
    const r = Math.random();
    if (r < 0.38) {
      const gold = D.EVENT_LOOT.goldMin + Math.floor(Math.random() * (D.EVENT_LOOT.goldMax - D.EVENT_LOOT.goldMin));
      p.acc.gold += gold;
      loots.push(gold + ' gold');
    } else if (r < 0.72) {
      const armor = ['iron_armor', 'steel_armor', 'golden_armor'][Math.floor(Math.random() * 3)];
      addItem(p, armor, true);
      loots.push(armor);
    } else {
      const sword = ['stone_sword', 'iron_sword', 'steel_sword'][Math.floor(Math.random() * 3)];
      addItem(p, sword, true);
      loots.push(sword);
    }
  }
  markAccounts();
  sendSelf(p);
  broadcastWorld(w, { t: 'ev', active: false, nextAt: w.nextEventAt, winner: p.name });
  broadcastWorld(w, { t: 'sys', key: 'event_claimed', args: { name: p.name }, ts: now() });
  broadcastWorld(w, { t: 'toast', key: 'event_claimed', args: { name: p.name } });
  sendTo(p, { t: 'toast', key: 'event_won' });
  markWorlds();
}

/* ---------------- clan operations ---------------- */
function clanOp(p, msg) {
  const acc = p.acc;
  const op = msg.op;
  if (op === 'list') {
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
    return;
  }
  if (op === 'create') {
    if (acc.clanId) return sendTo(p, { t: 'toast', key: 'already_in_clan' });
    const name = cleanNick(msg.name).slice(0, D.CLAN.nameMax);
    if (name.length < D.CLAN.nameMin) return sendTo(p, { t: 'toast', key: 'clan_name_short' });
    for (const c of Object.values(clans)) if (c.name.toLowerCase() === name.toLowerCase()) return sendTo(p, { t: 'toast', key: 'clan_name_taken' });
    if (acc.gold < D.CLAN.createCost) return sendTo(p, { t: 'toast', key: 'need_gold', args: { n: D.CLAN.createCost } });
    acc.gold -= D.CLAN.createCost;
    const clan = { id: 'c' + uid(5), name, leaderId: p.id, members: [p.id], requests: [], createdAt: now() };
    clans[clan.id] = clan;
    acc.clanId = clan.id;
    p.clanId = clan.id;
    markClans(); markAccounts();
    updateBuildingsClanTag(p);
    pushClan(clan);
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
    sendTo(p, { t: 'toast', key: 'clan_created' });
    sendSelf(p);
    broadcastWorld(worldMap.get(p.world), { t: 'pupd', id: p.id, clanTag: clanTag(clan.name) });
    return;
  }
  if (op === 'request') {
    if (acc.clanId) return sendTo(p, { t: 'toast', key: 'already_in_clan' });
    const target = clans[msg.id];
    if (!target) return sendTo(p, { t: 'toast', key: 'no_clan' });
    if (target.members.length >= D.CLAN.maxMembers) return sendTo(p, { t: 'toast', key: 'clan_full' });
    target.requests = target.requests || [];
    if (!target.requests.includes(p.id)) target.requests.push(p.id);
    markClans();
    sendTo(p, { t: 'toast', key: 'request_sent' });
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
    pushClan(target);
    return;
  }
  const clan = acc.clanId ? clans[acc.clanId] : null;
  if (!clan) return sendTo(p, { t: 'toast', key: 'no_clan' });
  if (op === 'approve') {
    if (clan.leaderId !== p.id) return sendTo(p, { t: 'toast', key: 'not_leader' });
    const targetAcc = accounts[msg.id];
    if (!targetAcc || !clan.requests.includes(msg.id)) return;
    if (clan.members.length >= D.CLAN.maxMembers) return sendTo(p, { t: 'toast', key: 'clan_full' });
    clan.requests = clan.requests.filter(x => x !== msg.id);
    clan.members.push(msg.id);
    targetAcc.clanId = clan.id;
    markClans(); markAccounts();
    const tp = playersById.get(msg.id);
    if (tp) {
      tp.clanId = clan.id;
      sendTo(tp, { t: 'toast', key: 'clan_joined' });
      pushClan(clan);
      broadcastWorld(worldMap.get(tp.world), { t: 'pupd', id: tp.id, clanTag: clanTag(clan.name) });
      sendSelf(tp);
    }
    pushClan(clan);
    sendTo(p, { t: 'toast', key: 'clan_approved' });
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
  } else if (op === 'deny') {
    if (clan.leaderId !== p.id) return sendTo(p, { t: 'toast', key: 'not_leader' });
    clan.requests = clan.requests.filter(x => x !== msg.id);
    markClans();
    pushClan(clan);
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
    const tp = playersById.get(msg.id);
    if (tp) sendTo(tp, { t: 'toast', key: 'request_denied' });
  } else if (op === 'kick') {
    if (clan.leaderId !== p.id) return sendTo(p, { t: 'toast', key: 'not_leader' });
    if (msg.id === p.id) return;
    const target = accounts[msg.id];
    if (!target || target.clanId !== clan.id) return;
    removeFromClan(target, clan);
    const tp = playersById.get(msg.id);
    if (tp) {
      tp.clanId = null;
      updateBuildingsClanTag(tp);
      pushClan(clan);
      sendTo(tp, { t: 'clan', info: null });
      sendTo(tp, { t: 'toast', key: 'clan_kicked' });
      broadcastWorld(worldMap.get(tp.world), { t: 'pupd', id: tp.id, clanTag: null });
      sendSelf(tp);
    }
    pushClan(clan);
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
  } else if (op === 'leave') {
    if (clan.leaderId === p.id && clan.members.length > 1) {
      const nextId = clan.members.find(x => x !== p.id);
      clan.leaderId = nextId;
      const na = accounts[nextId];
      if (na) { na.clanId = clan.id; }
      if (playersById.get(nextId)) pushClan(clan);
    }
    removeFromClan(acc, clan);
    p.clanId = null;
    updateBuildingsClanTag(p);
    sendTo(p, { t: 'clan', info: null });
    sendTo(p, { t: 'toast', key: 'clan_left' });
    broadcastWorld(worldMap.get(p.world), { t: 'pupd', id: p.id, clanTag: null });
    if (clan.members.length === 0) {
      delete clans[clan.id];
      markClans();
    } else pushClan(clan);
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
  } else if (op === 'disband') {
    if (clan.leaderId !== p.id) return sendTo(p, { t: 'toast', key: 'not_leader' });
    for (const id of clan.members) {
      const a = accounts[id];
      if (a) a.clanId = null;
      const pl = playersById.get(id);
      if (pl) {
        pl.clanId = null;
        updateBuildingsClanTag(pl);
        sendTo(pl, { t: 'clan', info: null });
        sendTo(pl, { t: 'toast', key: 'clan_disbanded' });
        broadcastWorld(worldMap.get(pl.world), { t: 'pupd', id: pl.id, clanTag: null });
      }
    }
    delete clans[clan.id];
    markClans(); markAccounts();
    sendTo(p, { t: 'clans', data: clanListPayload(p.id) });
  }
}

function updateBuildingsClanTag(p) {
  const w = worldMap.get(p.world);
  if (!w) return;
  for (const b of w.buildings.values()) if (b.owner === p.id) b.clanId = p.clanId || null;
  markWorlds();
}

/* ---------------- chat ---------------- */
function chat(p, text) {
  if (now() - p.lastChat < 1200) return;
  text = String(text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
  if (!text) return;
  p.lastChat = now();
  let scope = 'local', body = text;
  if (text.startsWith('/team ')) {
    scope = 'team';
    body = text.slice(6).trim();
    if (!p.clanId) return sendTo(p, { t: 'toast', key: 'no_clan' });
  } else if (text.startsWith('/')) {
    return sendTo(p, { t: 'toast', key: 'chat_help' });
  }
  if (!body) return;
  const payload = {
    t: 'chat', name: p.name, gender: p.gender, clanTag: p.clanId && clans[p.clanId] ? clanTag(clans[p.clanId].name) : null,
    text: body, scope, ts: now()
  };
  const w = worldMap.get(p.world);
  if (scope === 'team') {
    for (const q of w.players.values()) {
      if (q.clanId === p.clanId) sendTo(q, payload);
    }
    sendTo(p, payload);
  } else {
    for (const q of w.players.values()) {
      if (dist2(p.x, p.y, q.x, q.y) < 1500 * 1500) sendTo(q, payload);
    }
  }
}

/* ---------------- world simulation ---------------- */
setInterval(() => {
  const t = now();
  for (const w of worldList) {
    // event scheduling
    if (t >= w.nextEventAt) startEvent(w);

    // farms
    let farmChanged = false;
    for (const b of w.buildings.values()) {
      const def = D.BUILDINGS[b.type];
      if (!def.cat || def.cat !== 'farm') continue;
      const lvl = b.level || 1;
      const rate = def.baseRate * (1 + (lvl - 1) * 0.55);
      if (def.auto) {
        const owner = playersById.get(b.owner);
        if (!owner || owner.dead) continue;
        b.buffer.gold = (b.buffer.gold || 0) + rate * 0.1;
        const whole = Math.floor(b.buffer.gold);
        if (whole >= 1) {
          b.buffer.gold -= whole;
          const acc = accounts[b.owner];
          if (acc) { acc.gold += whole; markAccounts(); if (owner) { sendSelf(owner); } }
        }
      } else {
        const cap = 45 * lvl;
        if ((b.buffer[def.res] || 0) < cap) {
          b.buffer[def.res] = Math.min(cap, (b.buffer[def.res] || 0) + rate * 0.1);
          farmChanged = true;
        }
      }
    }
    if (farmChanged) markWorlds();

    // towers and traps
    for (const b of w.buildings.values()) {
      const def = D.BUILDINGS[b.type];
      if (def.range) {
        if (t - (b.lastShot || 0) < def.shotMs) continue;
        let target = null, bd = def.range * def.range;
        for (const q of w.players.values()) {
          if (q.dead) continue;
          if (q.id === b.owner) continue;
          if (b.clanId && q.clanId === b.clanId) continue;
          const d = dist2(b.x, b.y, q.x, q.y);
          if (d < bd) { bd = d; target = q; }
        }
        if (target) {
          b.lastShot = t;
          if (t > target.shieldUntil) {
            target.hp -= damageAfterArmor(def.shotDmg, armorOf(target));
            broadcastWorld(w, { t: 'shot', x: b.x, y: b.y, tx: target.x, ty: target.y });
            sendTo(target, { t: 'hurt', dmg: def.shotDmg, from: 'tower', x: Math.round(target.x), y: Math.round(target.y) });
            sendSelf(target);
            if (target.hp <= 0) killPlayer(target, null);
          }
        }
      }
      if (def.trapDmg) {
        for (const q of w.players.values()) {
          if (q.dead || q.id === b.owner) continue;
          if (b.clanId && q.clanId === b.clanId) continue;
          if (Math.abs(q.x - b.x) < def.w / 2 + 8 && Math.abs(q.y - b.y) < def.h / 2 + 8) {
            if (t > (q.lastTrap || 0) + def.trapMs) {
              q.lastTrap = t;
              if (t > q.shieldUntil) {
                q.hp -= damageAfterArmor(def.trapDmg, armorOf(q));
                sendTo(q, { t: 'hurt', dmg: def.trapDmg, from: 'trap', x: Math.round(q.x), y: Math.round(q.y) });
                sendSelf(q);
                if (q.hp <= 0) killPlayer(q, null);
              }
            }
          }
        }
      }
    }

    // dead respawn
    for (const p of w.players.values()) {
      if (p.dead && t >= p.respawnAt) respawn(p);
    }

    // ground expiry
    for (const g of w.ground.values()) {
      if (t - g.createdAt > D.WORLD.groundTtlMs) removeGround(w, g.id);
    }
  }
}, 100);

/* state broadcast 10 Hz */
setInterval(() => {
  for (const w of worldList) {
    if (!w.players.size) continue;
    const all = [...w.players.values()];
    for (const p of all) {
      if (p.ws.readyState !== 1) continue;
      const list = [];
      for (const q of all) {
        if (q.id === p.id) continue;
        if (Math.abs(q.x - p.x) > 2200 || Math.abs(q.y - p.y) > 2200) continue;
        list.push(playerStateArr(q));
      }
      sendTo(p, { t: 's', ps: list, me: [Math.round(p.x), Math.round(p.y)] });
      if (now() % 200 < 100) sendTo(p, { t: 'farm', bs: [...w.buildings.values()].filter(b => {
        const def = D.BUILDINGS[b.type];
        if (def.cat !== 'farm') return false;
        if (b.owner !== p.id && b.clanId !== p.clanId) return false;
        return Math.abs(b.x - p.x) < 1200 && Math.abs(b.y - p.y) < 1200;
      }).map(b => [b.id, Math.round((b.buffer.wood || 0) + (b.buffer.stone || 0)), Math.round(b.buffer.gold || 0)]) });
    }
  }
}, 100);

/* periodic self sync (gold farm, hp etc.) */
setInterval(() => {
  for (const p of playersById.values()) sendSelf(p);
}, 500);

/* ---------------- HTTP / API ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
function serveFile(res, file, cache) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache ? 'public, max-age=86400' : 'no-store' });
    res.end(data);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 65536) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function authAccount(req) {
  const h = req.headers.authorization || '';
  return accountByToken(h.replace(/^Bearer\s+/i, ''));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(u.pathname);
  try {
    if (pathname.startsWith('/api/')) {
      if (pathname === '/api/config' && req.method === 'GET') {
        return json(res, 200, {
          googleClientId: GOOGLE_CLIENT_ID,
          worlds: worldList.map(w => ({ id: w.id, name: w.name, players: w.players.size, max: D.WORLD.maxPlayers })),
          eventMs: D.WORLD.eventEveryMs,
          serverTime: now()
        });
      }
      if (pathname === '/api/leaderboard' && req.method === 'GET') {
        const top = Object.values(accounts).filter(a => a.gold > 0).sort((a, b) => b.gold - a.gold).slice(0, 20)
          .map((a, i) => ({ rank: i + 1, id: a.id, name: a.nickname, gender: a.gender, gold: a.gold, clan: a.clanId && clans[a.clanId] ? clans[a.clanId].name : null }));
        return json(res, 200, { top, online: playersById.size });
      }
      if (pathname === '/api/me' && req.method === 'GET') {
        const acc = authAccount(req);
        if (!acc) return json(res, 401, { error: 'auth' });
        const rank = Object.values(accounts).filter(a => a.gold > acc.gold).length + 1;
        return json(res, 200, { profile: profile(acc), token: acc.token, rank, goldChest: acc.goldChest });
      }
      if (pathname === '/api/auth/guest' && req.method === 'POST') {
        const body = await readBody(req);
        const nick = cleanNick(body.nickname);
        if (!validNick(nick)) return json(res, 400, { error: 'nickname' });
        if (nickIndex.has(nick.toLowerCase())) return json(res, 409, { error: 'nickname_taken' });
        const acc = createAccount({ nickname: nick, gender: body.gender });
        saveAll(false);
        return json(res, 200, { profile: profile(acc), token: acc.token });
      }
      if (pathname === '/api/auth/google' && req.method === 'POST') {
        if (!GOOGLE_CLIENT_ID) return json(res, 400, { error: 'google_disabled' });
        const body = await readBody(req);
        if (!body.credential) return json(res, 400, { error: 'credential' });
        const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(body.credential));
        if (!r.ok) return json(res, 401, { error: 'invalid_token' });
        const info = await r.json();
        if (info.aud !== GOOGLE_CLIENT_ID) return json(res, 401, { error: 'invalid_audience' });
        let acc = accountByGoogle(info.sub);
        if (!acc) {
          let nick = cleanNick(body.nickname);
          if (!validNick(nick) || nickIndex.has(nick.toLowerCase())) nick = uniqueNick(body.nickname || info.name || (info.email || 'Player').split('@')[0]);
          acc = createAccount({ nickname: nick, gender: body.gender, googleId: info.sub, email: info.email });
        }
        saveAll(false);
        return json(res, 200, { profile: profile(acc), token: acc.token, newAccount: !acc.createdAt ? false : undefined });
      }
      if (pathname === '/api/profile' && req.method === 'POST') {
        const acc = authAccount(req);
        if (!acc) return json(res, 401, { error: 'auth' });
        const body = await readBody(req);
        if (body.nickname !== undefined) {
          const nick = cleanNick(body.nickname);
          if (!validNick(nick)) return json(res, 400, { error: 'nickname' });
          const existing = nickIndex.get(nick.toLowerCase());
          if (existing && existing !== acc.id) return json(res, 409, { error: 'nickname_taken' });
          if (acc.nickname) nickIndex.delete(acc.nickname.toLowerCase());
          acc.nickname = nick;
          nickIndex.set(nick.toLowerCase(), acc.id);
          const p = playersById.get(acc.id);
          if (p) {
            p.name = nick;
            broadcastWorld(worldMap.get(p.world), { t: 'pupd', id: p.id, name: nick, gender: p.gender, clanTag: p.clanId && clans[p.clanId] ? clanTag(clans[p.clanId].name) : null });
          }
        }
        if (body.gender === 'male' || body.gender === 'female') {
          acc.gender = body.gender;
          const p = playersById.get(acc.id);
          if (p) {
            p.gender = body.gender;
            broadcastWorld(worldMap.get(p.world), { t: 'pupd', id: p.id, name: p.name, gender: p.gender, clanTag: p.clanId && clans[p.clanId] ? clanTag(clans[p.clanId].name) : null });
          }
        }
        markAccounts(); saveAll(false);
        return json(res, 200, { profile: profile(acc) });
      }
      return json(res, 404, { error: 'not_found' });
    }

    let file = pathname === '/' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, pathname);
    if (pathname.startsWith('/shared/')) file = path.join(ROOT, pathname);
    const resolved = path.resolve(file);
    if (!resolved.startsWith(PUBLIC) && !resolved.startsWith(path.join(ROOT, 'shared'))) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    serveFile(res, resolved, /\.(png|jpg|woff2|ico)$/.test(pathname));
  } catch (e) {
    console.error('HTTP error', e.message);
    if (!res.headersSent) json(res, 500, { error: 'server' });
  }
});

/* ---------------- WebSocket ---------------- */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== '/ws') { socket.destroy(); return; }
    const token = u.searchParams.get('token');
    const acc = accountByToken(token);
    if (!acc) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.account = acc;
      ws.alive = true;
      ws.msgCount = 0;
      ws.msgWindow = now();
      wss.emit('connection', ws, req);
    });
  } catch (e) { socket.destroy(); }
});

wss.on('connection', (ws) => {
  const acc = ws.account;
  let player = null;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', raw => {
    try {
      if (raw.length > 5120) return;
      ws.msgCount++;
      if (now() - ws.msgWindow > 1000) { ws.msgWindow = now(); ws.msgCount = 0; }
      if (ws.msgCount > 45) return;
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg.t !== 'string') return;

      if (msg.t === 'join') {
        if (player) return;
        const w = worldMap.get(msg.world);
        if (!w) return send(ws, { t: 'error', key: 'bad_world' });
        if (w.players.size >= D.WORLD.maxPlayers) return send(ws, { t: 'error', key: 'world_full' });
        player = w.addPlayer(acc, ws);
        ws.player = player;
        const savedBuildings = [...w.buildings.values()].map(serializeBuilding);
        const players = [...w.players.values()].filter(p => p !== player).map(p => ({
          ...w.spawnPacket(p), x: Math.round(p.x), y: Math.round(p.y), hp: p.hp
        }));
        send(ws, {
          t: 'welcome', you: { id: player.id, x: Math.round(player.x), y: Math.round(player.y), name: player.name, gender: player.gender },
          world: { id: w.id, name: w.name, size: D.WORLD.size, border: D.WORLD.border },
          buildings: savedBuildings, players,
          ground: [...w.ground.values()].map(g => ({ id: g.id, x: g.x, y: g.y, item: g.item, res: g.res, amount: g.amount })),
          event: w.event ? { active: w.event.active, x: w.event.x, y: w.event.y, nextAt: w.nextEventAt } : { active: false, nextAt: w.nextEventAt },
          profile: profile(acc),
          clan: acc.clanId && clans[acc.clanId] ? clanPayload(clans[acc.clanId], acc.id) : null
        });
        sendSelf(player);
        broadcastWorld(w, { t: 'pjoin', p: { ...w.spawnPacket(player), x: Math.round(player.x), y: Math.round(player.y), hp: player.hp } }, player.id);
        broadcastWorld(w, { t: 'sys', key: 'player_joined', args: { name: player.name }, ts: now() });
        if (acc.clanId) broadcastWorld(w, { t: 'pupd', id: player.id, name: player.name, gender: player.gender, clanTag: clanTag(clans[acc.clanId].name) }, player.id);
        return;
      }

      if (!player) return;
      const w = worldMap.get(player.world);
      switch (msg.t) {
        case 'in': {
          if (player.dead) return;
          const x = Number(msg.x), y = Number(msg.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          const t = now();
          const dt = Math.min(0.6, Math.max(0.02, (t - player.lastMoveAt) / 1000));
          player.lastMoveAt = t;
          const maxStep = D.PLAYER.speed * dt * 1.7 + 12;
          let nx = clamp(x, D.WORLD.border + 16, D.WORLD.size - D.WORLD.border - 16);
          let ny = clamp(y, D.WORLD.border + 16, D.WORLD.size - D.WORLD.border - 16);
          const dx = nx - player.x, dy = ny - player.y;
          const len = Math.hypot(dx, dy);
          if (len > maxStep) {
            nx = player.x + dx / len * maxStep;
            ny = player.y + dy / len * maxStep;
          }
          if (!w.collides(nx, ny, D.PLAYER.radius, player)) {
            player.x = nx; player.y = ny;
          } else if (!w.collides(nx, player.y, D.PLAYER.radius, player)) {
            player.x = nx;
          } else if (!w.collides(player.x, ny, D.PLAYER.radius, player)) {
            player.y = ny;
          }
          player.moving = !!msg.m;
          if (Number.isFinite(msg.d)) player.dir = msg.d;
          return;
        }
        case 'atk': {
          if (player.dead) return;
          const t = now();
          const aim = Number(msg.a) || 0;
          player.dir = aim;
          if (t - player.lastAttack < D.PLAYER.attackMs.weapon) return;
          player.lastAttack = t;
          player.attackUntil = t + 180;
          const victim = tryHitPlayer(player, aim);
          if (victim) {
            let dmg = weaponDmg(player);
            dmg = damageAfterArmor(dmg, armorOf(victim));
            if (t < victim.shieldUntil) {
              sendTo(player, { t: 'toast', key: 'shielded' });
              broadcastWorld(w, { t: 'swing', id: player.id, x: player.x, y: player.y, a: aim });
              return;
            }
            victim.hp -= dmg;
            sendTo(player, { t: 'hit', dmg, x: Math.round(victim.x), y: Math.round(victim.y) });
            sendTo(victim, { t: 'hurt', dmg, from: player.name, x: Math.round(victim.x), y: Math.round(victim.y) });
            sendSelf(victim);
            broadcastWorld(w, { t: 'swing', id: player.id, x: player.x, y: player.y, a: aim });
            if (victim.hp <= 0) killPlayer(victim, player);
            else sendTo(victim, { t: 'toast', key: 'under_attack', args: { name: player.name } });
          } else {
            const b = tryHitBuilding(player, aim);
            if (b) {
              let dmg = weaponDmg(player);
              damageBuilding(w, b, dmg, player);
              sendTo(player, { t: 'hitb', dmg, x: Math.round(b.x), y: Math.round(b.y) });
            }
            broadcastWorld(w, { t: 'swing', id: player.id, x: player.x, y: player.y, a: aim });
          }
          return;
        }
        case 'build': {
          if (player.dead) return;
          const def = D.BUILDINGS[msg.type];
          if (!def) return;
          const x = Number(msg.x), y = Number(msg.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          placeBuilding(player, msg.type, x, y);
          return;
        }
        case 'use':
          useNearest(player);
          return;
        case 'upg':
          upgradeNearest(player);
          return;
        case 'chest': {
          const b = w.buildings.get(msg.id);
          if (!b || dist2(player.x, player.y, b.x, b.y) > 130 * 130) return sendTo(player, { t: 'toast', key: 'not_near' });
          transferItem(player, b, msg.dir, msg.uid);
          return;
        }
        case 'openChest': {
          const b = w.buildings.get(msg.id);
          if (!b || dist2(player.x, player.y, b.x, b.y) > 150 * 150) return sendTo(player, { t: 'toast', key: 'not_near' });
          openChest(player, b);
          return;
        }
        case 'hot': {
          const f = findItem(player, msg.uid);
          if (!f) return;
          const target = Number(msg.slot);
          if (target === -1) {
            if (f.where !== 'hot') return;
            if (player.inv.length >= D.PLAYER.invSize) return sendTo(player, { t: 'toast', key: 'inventory_full' });
            player.hot[f.idx] = null;
            player.inv.push(f.item);
            if (!player.hot[player.sel]) {
              const next = player.hot.findIndex(Boolean);
              player.sel = next < 0 ? 0 : next;
            }
            sendSelf(player);
            return;
          }
          if (f.where === 'hot') {
            if (!Number.isInteger(target) || target < 0 || target >= D.PLAYER.hotSize) return;
            const old = player.hot[target];
            player.hot[target] = f.item;
            player.hot[f.idx] = old || null;
          } else {
            let slot = Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < D.PLAYER.hotSize ? msg.slot : player.hot.indexOf(null);
            if (slot < 0) slot = player.sel;
            const prev = player.hot[slot];
            player.hot[slot] = f.item;
            if (prev) player.inv.push(prev);
            player.inv = player.inv.filter((_, i) => i !== f.idx);
          }
          if (!player.hot[player.sel]) {
            const next = player.hot.findIndex(Boolean);
            player.sel = next < 0 ? 0 : next;
          }
          sendSelf(player);
          return;
        }
        case 'sel': {
          const s = Number(msg.slot);
          if (Number.isInteger(s) && s >= 0 && s < D.PLAYER.hotSize) { player.sel = s; sendSelf(player); }
          return;
        }
        case 'drop': {
          const f = findItem(player, msg.uid);
          if (!f) return;
          removeItemEverywhere(player, msg.uid);
          dropGround(player.world, player.x, player.y, { item: f.item.type });
          sendSelf(player);
          return;
        }
        case 'craft': {
          const def = D.ITEMS[msg.item];
          if (!def || !def.cost) return;
          if (!D.canAfford({ wood: player.wood, stone: player.stone, gold: player.acc.gold }, def.cost)) return sendTo(player, { t: 'toast', key: 'no_resources' });
          if (invCount(player) >= D.PLAYER.invSize + D.PLAYER.hotSize) return sendTo(player, { t: 'toast', key: 'inventory_full' });
          player.wood -= def.cost.wood || 0;
          player.stone -= def.cost.stone || 0;
          player.acc.gold -= def.cost.gold || 0;
          addItem(player, msg.item);
          sendTo(player, { t: 'toast', key: 'crafted', args: { name: msg.item } });
          sendSelf(player); markAccounts();
          return;
        }
        case 'chat':
          chat(player, msg.text);
          return;
        case 'clan':
          clanOp(player, msg);
          return;
        case 'clans':
          sendTo(player, { t: 'clans', data: clanListPayload(player.id) });
          return;
        case 'respawn':
          if (player.dead && now() >= player.respawnAt) respawn(player);
          return;
        case 'ping':
          return send(ws, { t: 'pong', c: msg.c });
        default:
          return;
      }
    } catch (e) {
      console.error('WS message error', e.message);
    }
  });

  ws.on('close', () => {
    if (ws.player) {
      const p = ws.player;
      const w = worldMap.get(p.world);
      if (w) {
        w.removePlayer(p);
        broadcastWorld(w, { t: 'pleave', id: p.id });
        broadcastWorld(w, { t: 'sys', key: 'player_left', args: { name: p.name }, ts: now() });
      }
      if (accounts[p.id]) saveAll(false);
    }
  });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { try { ws.terminate(); } catch (e) {} continue; }
    ws.alive = false;
    try { ws.ping(); } catch (e) {}
  }
}, 30000);

server.listen(PORT, () => {
  console.log('Faber.io server running on http://localhost:' + PORT);
  console.log('Worlds: ' + worldList.map(w => w.name + ' (' + w.players.size + '/' + D.WORLD.maxPlayers + ')').join(', '));
  if (!GOOGLE_CLIENT_ID) console.log('Google sign-in disabled (set GOOGLE_CLIENT_ID to enable). Guest login works.');
});

process.on('SIGINT', () => { saveAll(true); process.exit(0); });
process.on('SIGTERM', () => { saveAll(true); process.exit(0); });
