(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DEFS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WORLD = {
    size: 2400,
    border: 60,
    spawnRadius: 420,
    maxPlayers: 50,
    eventEveryMs: 10 * 60 * 1000,
    groundTtlMs: 5 * 60 * 1000
  };

  const PLAYER = {
    speed: 205,
    radius: 15,
    maxHp: 100,
    reach: 74,
    invSize: 20,
    hotSize: 10,
    chestSize: 12,
    goldChestSize: 12,
    startWood: 500,
    startStone: 500,
    startGold: 10,
    respawnMs: 4000,
    attackMs: { fist: 550, weapon: 480 }
  };

  const MATERIALS = {
    wood: { icon: 'wood', color: '#a9763f' },
    stone: { icon: 'stone', color: '#9aa1a8' },
    gold: { icon: 'gold', color: '#f2c14b' }
  };

  const WEAPONS = {
    wooden_sword: { tier: 1, dmg: 14, cost: { wood: 60 } },
    stone_sword: { tier: 2, dmg: 22, cost: { wood: 60, stone: 80 } },
    iron_sword: { tier: 3, dmg: 34, cost: { wood: 40, stone: 60, gold: 8 } },
    steel_sword: { tier: 4, dmg: 48, cost: { stone: 120, gold: 20 } },
    golden_sword: { tier: 5, dmg: 64, cost: { stone: 150, gold: 60 } },
    legendary_sword: { tier: 6, dmg: 98, cost: null }
  };

  const ARMORS = {
    leather_armor: { tier: 1, armor: 9, cost: { wood: 80 } },
    iron_armor: { tier: 2, armor: 17, cost: { stone: 100, gold: 5 } },
    steel_armor: { tier: 3, armor: 27, cost: { stone: 160, gold: 18 } },
    golden_armor: { tier: 4, armor: 40, cost: { stone: 200, gold: 50 } }
  };

  const ITEMS = {};
  for (const k in WEAPONS) ITEMS[k] = Object.assign({ key: k, kind: 'weapon' }, WEAPONS[k]);
  for (const k in ARMORS) ITEMS[k] = Object.assign({ key: k, kind: 'armor' }, ARMORS[k]);

  const BUILDINGS = {
    wood_wall: { cost: { wood: 25 }, hp: 240, w: 46, h: 46, solid: true, cat: 'defense' },
    stone_wall: { cost: { wood: 20, stone: 35 }, hp: 650, w: 46, h: 46, solid: true, cat: 'defense' },
    gate: { cost: { wood: 60, stone: 40 }, hp: 520, w: 70, h: 40, solid: true, gate: true, cat: 'defense' },
    tower: { cost: { wood: 80, stone: 120, gold: 5 }, hp: 760, w: 52, h: 52, solid: true, cat: 'defense', range: 270, shotMs: 1100, shotDmg: 14 },
    trap: { cost: { wood: 40, stone: 20 }, hp: 220, w: 46, h: 46, solid: false, cat: 'defense', trapDmg: 13, trapMs: 850 },
    wood_farm: { cost: { wood: 50, stone: 25 }, hp: 320, w: 58, h: 58, solid: true, cat: 'farm', res: 'wood', baseRate: 0.9, maxLevel: 5 },
    stone_farm: { cost: { wood: 50, stone: 50 }, hp: 320, w: 58, h: 58, solid: true, cat: 'farm', res: 'stone', baseRate: 0.75, maxLevel: 5 },
    gold_farm: { cost: { wood: 100, stone: 100, gold: 10 }, hp: 420, w: 58, h: 58, solid: true, cat: 'farm', res: 'gold', baseRate: 0.045, maxLevel: 5, auto: true },
    chest: { cost: { wood: 30, stone: 20 }, hp: 260, w: 46, h: 46, solid: true, cat: 'storage' },
    gold_chest: { cost: { wood: 60, stone: 60, gold: 15 }, hp: 420, w: 50, h: 50, solid: true, cat: 'storage', goldChest: true }
  };

  const UPGRADE_COST = { 2: 5, 3: 10, 4: 18, 5: 30 };
  const BUILD_ORDER = ['wood_wall', 'stone_wall', 'gate', 'tower', 'trap', 'wood_farm', 'stone_farm', 'gold_farm', 'chest', 'gold_chest'];
  const CRAFT_ORDER = ['wooden_sword', 'stone_sword', 'iron_sword', 'steel_sword', 'golden_sword', 'leather_armor', 'iron_armor', 'steel_armor', 'golden_armor'];

  const CLAN = { createCost: 10, nameMin: 3, nameMax: 18, maxMembers: 20 };

  const EVENT_LOOT = { legendaryChance: 0.25, goldMin: 25, goldMax: 90 };

  const COLORS = {
    femaleName: '#ff86b9',
    maleName: '#79b8ff'
  };

  function canAfford(res, cost) {
    if (!cost) return false;
    for (const k in cost) if ((res[k] || 0) < cost[k]) return false;
    return true;
  }
  function pay(res, cost) { for (const k in cost) res[k] -= cost[k]; }
  function addCost(res, cost) { for (const k in cost) res[k] = (res[k] || 0) + cost[k]; }
  function itemName(item) { return item; }

  return {
    WORLD, PLAYER, MATERIALS, WEAPONS, ARMORS, ITEMS, BUILDINGS, BUILD_ORDER, CRAFT_ORDER,
    UPGRADE_COST, CLAN, EVENT_LOOT, COLORS, canAfford, pay, addCost, itemName
  };
});
