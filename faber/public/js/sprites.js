(function () {
  const S = {};
  const NAME_F = '#ff86b9', NAME_M = '#79b8ff';
  const SWORD_COLORS = {
    wooden_sword: ['#b9854a', '#8a5a2b'],
    stone_sword: ['#bfc7cc', '#7e878d'],
    iron_sword: ['#dfe7ee', '#8d99a3'],
    steel_sword: ['#eaf6ff', '#9fb6c8'],
    golden_sword: ['#ffe08a', '#d79b26'],
    legendary_sword: ['#e6b8ff', '#9b4dff']
  };
  const ARMOR_COLORS = {
    leather_armor: ['#a5703f', '#744a25'],
    iron_armor: ['#c4ccd4', '#7f8992'],
    steel_armor: ['#b6d2e2', '#6f8ea0'],
    golden_armor: ['#f6d77a', '#c3901f']
  };
  const RES_COLORS = { wood: '#a9763f', stone: '#9aa1a8', gold: '#f2c14b' };
  const TUNIC = {
    male: ['#3f7f6a', '#2f6252'], female: ['#b25a7a', '#8d4361']
  };

  S.nameColor = g => g === 'female' ? NAME_F : NAME_M;
  S.swordColor = t => SWORD_COLORS[t] || SWORD_COLORS.wooden_sword;
  S.armorColor = t => ARMOR_COLORS[t] || null;

  function hashStr(s) {
    let h = 0; s = String(s || 'x');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }
  S.hash = hashStr;

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  S.roundRect = roundRect;

  /* ---------- terrain ---------- */
  S.createGrassTexture = function () {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#82c25a';
    g.fillRect(0, 0, 512, 512);
    const shades = ['#7cbb54', '#8acb61', '#77b64f', '#90d166', '#86c45d'];
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const r = 14 + Math.random() * 46;
      g.fillStyle = shades[(Math.random() * shades.length) | 0];
      g.globalAlpha = 0.28 + Math.random() * 0.28;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.7, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // grass tufts
    for (let i = 0; i < 620; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      g.strokeStyle = Math.random() < 0.5 ? '#5e9c3e' : '#9ade72';
      g.globalAlpha = 0.55;
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x, y + 4);
      g.quadraticCurveTo(x + 2, y - 2, x + 4, y - 6);
      g.moveTo(x, y + 4);
      g.quadraticCurveTo(x - 3, y - 1, x - 4, y - 5);
      g.stroke();
    }
    g.globalAlpha = 1;
    const flowers = ['#fff7b0', '#ffe066', '#f7a8c8', '#c9b5ff', '#ffd1dc', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 512, y = Math.random() * 512;
      const col = flowers[(Math.random() * flowers.length) | 0];
      g.fillStyle = col;
      for (let p = 0; p < 5; p++) {
        const a = p / 5 * Math.PI * 2;
        g.beginPath();
        g.arc(x + Math.cos(a) * 2.2, y + Math.sin(a) * 2.2, 1.7, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#e9a72a';
      g.beginPath(); g.arc(x, y, 1.3, 0, Math.PI * 2); g.fill();
    }
    // a few pale wild patches
    for (let i = 0; i < 12; i++) {
      g.fillStyle = 'rgba(255,250,210,0.10)';
      g.beginPath();
      g.ellipse(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 60, 22 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  };

  S.drawBoundary = function (ctx, view, size, border) {
    const x0 = 0, y0 = 0;
    const out = '#4c8a3c';
    // outside field ring
    ctx.fillStyle = '#3f7a34';
    ctx.fillRect(view.x - 50, view.y - 50, view.w + 100, view.h + 100);
    ctx.fillStyle = '#65a94a';
    ctx.fillRect(border - 18, border - 18, size - (border - 18) * 2, size - (border - 18) * 2);
    // hedge strip
    const step = 42;
    const top = border - 26;
    const bottom = size - border + 26;
    for (let x = Math.max(0, Math.floor((view.x - 60) / step) * step); x < Math.min(size, view.x + view.w + 60); x += step) {
      drawBush(ctx, x + 12, top + 4);
      drawBush(ctx, x + 12, bottom - 4);
    }
    for (let y = Math.max(0, Math.floor((view.y - 60) / step) * step); y < Math.min(size, view.y + view.h + 60); y += step) {
      drawBush(ctx, top + 4, y + 12);
      drawBush(ctx, bottom - 4, y + 12);
    }
    // fence posts
    ctx.strokeStyle = '#8a6134';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const b1 = border - 26, b2 = size - border + 26;
    if (view.y < b1 + 60) { ctx.moveTo(0, b1); ctx.lineTo(size, b1); }
    if (view.y + view.h > b2 - 60) { ctx.moveTo(0, b2); ctx.lineTo(size, b2); }
    if (view.x < b1 + 60) { ctx.moveTo(b1, 0); ctx.lineTo(b1, size); }
    if (view.x + view.w > b2 - 60) { ctx.moveTo(b2, 0); ctx.lineTo(b2, size); }
    ctx.stroke();
    ctx.fillStyle = '#6d4a25';
    for (let i = 0; i < size; i += 78) {
      ctx.fillRect(i - 2, b1 - 5, 8, 12);
      ctx.fillRect(i - 2, b2 - 5, 8, 12);
      ctx.fillRect(b1 - 5, i - 2, 12, 8);
      ctx.fillRect(b2 - 5, i - 2, 12, 8);
    }
  };
  function drawBush(ctx, x, y) {
    ctx.fillStyle = '#2f6b2c';
    ctx.beginPath(); ctx.ellipse(x, y + 5, 15, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4f9438';
    ctx.beginPath(); ctx.arc(x - 7, y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y + 1, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#71b84a';
    ctx.beginPath(); ctx.arc(x - 1, y - 5, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath(); ctx.arc(x + 4, y - 3, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- player ---------- */
  S.drawPlayer = function (ctx, p) {
    const t = p.time || 0;
    const face = Math.cos(p.dir || 0) < -0.01 ? -1 : 1;
    const moving = p.moving;
    const bob = moving ? Math.abs(Math.sin(t * 0.009 + hashStr(p.id) % 7)) * 2.2 : Math.sin(t * 0.002) * 0.7;
    const lean = moving ? Math.sin(t * 0.009 + hashStr(p.id) % 7) * 0.05 : 0;
    const baseY = p.y;
    const scale = p.scale || 1;
    ctx.save();
    ctx.translate(p.x, baseY);
    ctx.scale(scale, scale);
    // shadow
    ctx.fillStyle = 'rgba(45,70,30,0.24)';
    ctx.beginPath(); ctx.ellipse(0, 2, 17, 6.5, 0, 0, Math.PI * 2); ctx.fill();

    const armorCol = p.armorColor;
    const tunic = TUNIC[p.gender] || TUNIC.male;
    // legs
    const legSwing = moving ? Math.sin(t * 0.012 + hashStr(p.id)) * 4 : 0;
    ctx.fillStyle = '#5b432b';
    roundRect(ctx, -7, -12 + bob * 0.2, 6, 12 + legSwing * 0.2, 2.5); ctx.fill();
    roundRect(ctx, 2, -12 + bob * 0.2, 6, 12 - legSwing * 0.2, 2.5); ctx.fill();
    ctx.fillStyle = '#3f2f1e';
    roundRect(ctx, -8, -4 + legSwing * 0.15, 8, 4, 2); ctx.fill();
    roundRect(ctx, 1, -4 - legSwing * 0.15, 8, 4, 2); ctx.fill();

    // body / tunic
    ctx.save();
    ctx.rotate(lean);
    ctx.fillStyle = armorCol ? armorCol[0] : tunic[0];
    if (p.gender === 'female') {
      ctx.beginPath();
      ctx.moveTo(-10, -30 + bob);
      ctx.lineTo(10, -30 + bob);
      ctx.lineTo(13, -8 + bob * 0.4);
      ctx.quadraticCurveTo(0, -3 + bob * 0.4, -13, -8 + bob * 0.4);
      ctx.closePath(); ctx.fill();
    } else {
      roundRect(ctx, -10, -31 + bob, 20, 22, 6); ctx.fill();
    }
    // belt
    ctx.fillStyle = '#5b3d22';
    ctx.fillRect(-11, -18 + bob, 22, 3.5);
    ctx.fillStyle = '#e8c15a';
    ctx.fillRect(-2, -18.5 + bob, 4, 4.5);

    // armor plate accents
    if (armorCol) {
      ctx.fillStyle = armorCol[0];
      roundRect(ctx, -10.5, -30 + bob, 21, 12, 5); ctx.fill();
      ctx.strokeStyle = armorCol[1]; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-8, -27 + bob); ctx.lineTo(0, -21 + bob); ctx.lineTo(8, -27 + bob); ctx.stroke();
      ctx.fillStyle = armorCol[1];
      ctx.beginPath(); ctx.arc(-9, -26 + bob, 4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(9, -26 + bob, 4, 0, Math.PI * 2); ctx.fill();
    } else {
      // tunic trim
      ctx.strokeStyle = tunic[1]; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -30 + bob); ctx.lineTo(0, -12 + bob); ctx.stroke();
    }

    // arms
    ctx.fillStyle = armorCol ? armorCol[1] : '#e6b98f';
    const armSwing = moving ? Math.sin(t * 0.012 + hashStr(p.id)) * 2 : 0;
    ctx.beginPath(); ctx.arc(-12, -14 + bob + armSwing, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(12, -14 + bob - armSwing, 4, 0, Math.PI * 2); ctx.fill();

    // head
    const headY = -40 + bob;
    ctx.fillStyle = '#efc39d';
    ctx.beginPath(); ctx.arc(0, headY, 9.6, 0, Math.PI * 2); ctx.fill();
    // hair
    ctx.fillStyle = p.gender === 'female' ? '#6b3f23' : '#4a2f1a';
    ctx.beginPath();
    ctx.arc(0, headY - 2, 10, Math.PI * 0.98, Math.PI * 2.02);
    ctx.fill();
    if (p.gender === 'female') {
      ctx.beginPath(); ctx.ellipse(-9, headY + 3, 4, 8, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9, headY + 3, 4, 8, -0.2, 0, Math.PI * 2); ctx.fill();
    }
    // eyes
    ctx.fillStyle = '#2f2418';
    ctx.beginPath(); ctx.arc(-3.4 * face, headY + 1, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(2.6 * face, headY + 1, 1.3, 0, Math.PI * 2); ctx.fill();
    // cheek
    ctx.fillStyle = 'rgba(230,120,120,0.25)';
    ctx.beginPath(); ctx.arc(-5 * face, headY + 4.5, 2.2, 0, Math.PI * 2); ctx.fill();

    // helmet for armor + weapon in hand
    if (p.armorTier >= 2) {
      ctx.fillStyle = armorCol[1];
      ctx.beginPath();
      ctx.arc(0, headY - 3, 10.3, Math.PI, Math.PI * 2);
      ctx.lineTo(9, headY + 1);
      ctx.lineTo(-9, headY + 1);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = armorCol[0];
      ctx.fillRect(-1.5, headY - 12, 3, 9);
    }
    if (p.armorTier >= 4) {
      ctx.strokeStyle = '#ffef9a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, headY - 4, 10.8, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    }

    ctx.restore();

    // weapon
    const wt = p.weaponTier || 0;
    if (wt > 0) {
      const sc = S.swordColor(p.weaponType || 'wooden_sword');
      const hx = 12 * face, hy = -16 + bob;
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate((p.dir || 0) + (face < 0 ? Math.PI : 0) + (p.swing ? Math.sin(t * 0.02) * 0.9 - 0.4 : 0.5));
      // handle
      ctx.fillStyle = '#5b3d22';
      ctx.fillRect(-1.8, -2, 3.6, 8);
      ctx.fillStyle = '#e8c15a';
      ctx.fillRect(-4, -3, 8, 2.4);
      // blade
      const len = 15 + wt * 3.4;
      ctx.fillStyle = sc[0];
      ctx.beginPath();
      ctx.moveTo(-2.4, -4);
      ctx.lineTo(2.4, -4);
      ctx.lineTo(2, -4 - len);
      ctx.lineTo(0, -8 - len);
      ctx.lineTo(-2, -4 - len);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = sc[1]; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(0, -4 - len * 0.8); ctx.stroke();
      if (wt >= 5) {
        ctx.globalAlpha = 0.5 + Math.sin(t * 0.005) * 0.25;
        ctx.strokeStyle = wt >= 6 ? '#d59bff' : '#ffe889';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -4, 17 + wt, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    // swing arc
    if (p.swing) {
      const pr = Math.min(1, Math.max(0, (t % 300) / 180));
      ctx.save();
      ctx.translate(p.x, p.y - 20);
      ctx.rotate(p.dir || 0);
      ctx.strokeStyle = 'rgba(255,246,190,' + (0.8 * (1 - pr)) + ')';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, 34, -0.9 + pr * 0.8, 0.5 + pr * 0.8); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - pr)) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 38, -0.9 + pr * 0.8, 0.5 + pr * 0.8); ctx.stroke();
      ctx.restore();
    }

    // shield / spawn protection
    if (p.shielded) {
      ctx.strokeStyle = 'rgba(255,236,150,' + (0.55 + Math.sin(t * 0.008) * 0.2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, -24, 24, 28, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,240,170,0.06)';
      ctx.fill();
    }

    if (p.dead) {
      ctx.fillStyle = 'rgba(80,30,30,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 0, 20, 8, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  S.drawName = function (ctx, p) {
    const t = p.time || 0;
    const col = S.nameColor(p.gender);
    const y = p.y - 60;
    ctx.save();
    ctx.font = '600 13px Cinzel, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let label = p.name || '';
    if (p.clanTag) label = '[' + p.clanTag + '] ' + label;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(30,42,22,0.55)';
    ctx.strokeText(label, p.x, y);
    ctx.fillStyle = col;
    ctx.fillText(label, p.x, y);
    if (p.hp !== undefined && p.hp < 100) {
      const w = 34, h = 4.5;
      ctx.fillStyle = 'rgba(28,40,20,0.55)';
      roundRect(ctx, p.x - w / 2, y + 10, w, h, 2); ctx.fill();
      ctx.fillStyle = p.hp > 55 ? '#73d95c' : p.hp > 25 ? '#f0c14a' : '#ef5b52';
      roundRect(ctx, p.x - w / 2 + 0.8, y + 10.8, (w - 1.6) * Math.max(0, p.hp / 100), h - 1.6, 1.4); ctx.fill();
    }
    if (p.shielded) {
      ctx.fillStyle = 'rgba(255,244,190,' + (0.7 + Math.sin(t * 0.006) * 0.2) + ')';
      ctx.font = '10px Georgia';
      ctx.fillText('✦', p.x + 34, y);
    }
    ctx.restore();
  };

  /* ---------- buildings ---------- */
  function shadow(ctx, w, h) {
    ctx.fillStyle = 'rgba(45,70,30,0.22)';
    ctx.beginPath(); ctx.ellipse(0, h * 0.38, w * 0.62, h * 0.26, 0, 0, Math.PI * 2); ctx.fill();
  }

  S.drawBuilding = function (ctx, type, x, y, level, time, hpFrac) {
    ctx.save();
    ctx.translate(x, y);
    const t = time || 0;
    switch (type) {
      case 'wood_wall': {
        shadow(ctx, 46, 46);
        ctx.fillStyle = '#8a5a2f';
        for (let i = -2; i <= 2; i++) {
          roundRect(ctx, -21, -14 + i * 9, 42, 8, 3); ctx.fill();
        }
        ctx.fillStyle = '#b07a42';
        for (let i = -2; i <= 2; i++) {
          roundRect(ctx, -19, -14.5 + i * 9, 38, 2.5, 1.2); ctx.fill();
        }
        ctx.fillStyle = '#69421f';
        ctx.fillRect(-23, -22, 7, 44);
        ctx.fillRect(16, -22, 7, 44);
        ctx.fillStyle = '#c91f1f';
        ctx.fillRect(-1.5, -22, 3, 3);
        break;
      }
      case 'stone_wall': {
        shadow(ctx, 46, 46);
        ctx.fillStyle = '#97a0a6';
        roundRect(ctx, -22, -21, 44, 42, 4); ctx.fill();
        ctx.fillStyle = '#b8c1c6';
        for (let r = 0; r < 4; r++) {
          const off = r % 2 ? 6 : 0;
          for (let c = -2; c <= 2; c++) {
            const bx = c * 9 + off - 2, by = -19 + r * 10;
            if (bx < -22 || bx > 16) continue;
            roundRect(ctx, bx, by, 8, 8.5, 2); ctx.fill();
          }
        }
        ctx.fillStyle = '#6f787d';
        roundRect(ctx, -23, -23, 46, 4, 2); ctx.fill();
        break;
      }
      case 'gate': {
        shadow(ctx, 64, 40);
        ctx.fillStyle = '#6f4a26';
        roundRect(ctx, -34, -26, 10, 52, 3); ctx.fill();
        roundRect(ctx, 24, -26, 10, 52, 3); ctx.fill();
        ctx.fillStyle = '#8d5f31';
        for (let i = 0; i < 5; i++) {
          roundRect(ctx, -23, -22 + i * 9, 46, 7, 2); ctx.fill();
        }
        ctx.strokeStyle = '#4f3418'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-20, -17); ctx.lineTo(20, 19); ctx.moveTo(20, -17); ctx.lineTo(-20, 19); ctx.stroke();
        ctx.fillStyle = '#e2b451';
        ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9a7322';
        ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'tower': {
        shadow(ctx, 54, 54);
        ctx.fillStyle = '#a2abb1';
        ctx.beginPath();
        ctx.moveTo(-18, 18); ctx.lineTo(-15, -18); ctx.lineTo(15, -18); ctx.lineTo(18, 18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#c3ccd1';
        ctx.beginPath(); ctx.arc(0, -18, 17, Math.PI, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#b9c2c8';
        for (let i = 0; i < 4; i++) ctx.fillRect(-17 + i * 10, -24, 6, 8);
        ctx.fillStyle = '#4d6b7a';
        ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(0, -40); ctx.lineTo(20, -24); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#6b8ea0';
        ctx.beginPath(); ctx.moveTo(-20, -24); ctx.lineTo(0, -40); ctx.lineTo(0, -24); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#2f3f47';
        ctx.beginPath(); ctx.ellipse(0, 4, 3.5, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7a5a33'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -40); ctx.lineTo(0, -52); ctx.stroke();
        ctx.fillStyle = '#c94040';
        ctx.beginPath(); ctx.moveTo(1, -51); ctx.lineTo(14, -47 + Math.sin(t * 0.004) * 2); ctx.lineTo(1, -43); ctx.closePath(); ctx.fill();
        break;
      }
      case 'trap': {
        ctx.fillStyle = 'rgba(80,60,30,0.25)';
        ctx.beginPath(); ctx.ellipse(0, 4, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7c5b31'; ctx.lineWidth = 3;
        ctx.strokeRect(-18, -14, 36, 28);
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            const sx = i * 11, sy = j * 9;
            ctx.fillStyle = '#c9d3d8';
            ctx.beginPath(); ctx.moveTo(sx - 3, sy + 5); ctx.lineTo(sx, sy - 10); ctx.lineTo(sx + 3, sy + 5); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#7a848a';
            ctx.beginPath(); ctx.moveTo(sx, sy - 10); ctx.lineTo(sx + 3, sy + 5); ctx.lineTo(sx, sy + 3); ctx.closePath(); ctx.fill();
          }
        }
        break;
      }
      case 'wood_farm':
      case 'stone_farm':
      case 'gold_farm': {
        const isWood = type === 'wood_farm', isGold = type === 'gold_farm';
        ctx.fillStyle = '#8b6239';
        roundRect(ctx, -29, -24, 58, 48, 5); ctx.fill();
        ctx.fillStyle = isGold ? '#b98f45' : '#a97b4a';
        for (let r = 0; r < 4; r++) roundRect(ctx, -26, -20 + r * 11, 52, 7.5, 2.5), ctx.fill();
        const sway = Math.sin(t * 0.0025) * 1.6;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 4; c++) {
            const px = -20 + c * 13, py = -14 + r * 12;
            if (isWood) {
              ctx.fillStyle = '#3f7f30';
              ctx.beginPath(); ctx.arc(px + sway, py - 3, 5, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#6fb54a';
              ctx.beginPath(); ctx.arc(px - 1 + sway, py - 5, 3, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#7a5128'; ctx.fillRect(px - 1, py - 4, 2, 7);
            } else if (isGold) {
              ctx.fillStyle = '#f6d364';
              ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px + 4, py + 2); ctx.lineTo(px, py + 5); ctx.lineTo(px - 4, py + 1); ctx.closePath(); ctx.fill();
              ctx.fillStyle = '#c3921f';
              ctx.beginPath(); ctx.moveTo(px, py - 8); ctx.lineTo(px + 4, py + 2); ctx.lineTo(px, py + 1); ctx.closePath(); ctx.fill();
              if (level > 1) {
                ctx.globalAlpha = 0.4 + Math.sin(t * 0.005 + px) * 0.2;
                ctx.fillStyle = '#fff2b0';
                ctx.beginPath(); ctx.arc(px + 3, py - 6, 1.6, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
              }
            } else {
              ctx.fillStyle = '#9fa7ac';
              ctx.beginPath(); ctx.ellipse(px, py, 5.5, 4, 0, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#c6ced2';
              ctx.beginPath(); ctx.ellipse(px - 1, py - 1.4, 3, 2, 0, 0, Math.PI * 2); ctx.fill();
            }
          }
        }
        for (let i = 1; i < level; i++) {
          ctx.fillStyle = '#f2c14b';
          ctx.beginPath(); ctx.arc(-27 + i * 6, 25, 2.2, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      case 'chest':
      case 'gold_chest': {
        const gold = type === 'gold_chest';
        shadow(ctx, 44, 44);
        ctx.fillStyle = gold ? '#c59527' : '#8d5c2c';
        roundRect(ctx, -19, -10, 38, 24, 4); ctx.fill();
        ctx.fillStyle = gold ? '#e8bb4a' : '#a9763f';
        ctx.beginPath();
        ctx.moveTo(-19, -8); ctx.lineTo(-14, -20); ctx.quadraticCurveTo(0, -28, 14, -20); ctx.lineTo(19, -8);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = gold ? '#7c5a10' : '#5f3d1c'; ctx.lineWidth = 2;
        ctx.strokeRect(-19, -10, 38, 24);
        ctx.fillStyle = gold ? '#fff0a8' : '#e8c15a';
        ctx.fillRect(-3, -9, 6, 9);
        ctx.fillStyle = gold ? '#f7d97a' : '#c9a145';
        ctx.fillRect(-19, -2, 38, 2);
        if (gold) {
          ctx.fillStyle = 'rgba(255,240,150,' + (0.3 + Math.sin(t * 0.004) * 0.15) + ')';
          ctx.beginPath(); ctx.ellipse(0, -8, 26, 20, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffe98d';
          ctx.beginPath(); ctx.arc(0, -16, 3, 0, Math.PI * 2); ctx.fill();
        }
        break;
      }
      default: {
        ctx.fillStyle = '#b68a5a';
        ctx.fillRect(-18, -18, 36, 36);
      }
    }
    ctx.restore();
  };

  /* ---------- event chest ---------- */
  S.drawEventChest = function (ctx, x, y, time, pulse) {
    const t = time || 0;
    ctx.save();
    ctx.translate(x, y);
    const glow = 0.55 + Math.sin(t * 0.004) * 0.2;
    ctx.save();
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 70);
    g.addColorStop(0, 'rgba(255,238,150,' + (0.55 * glow) + ')');
    g.addColorStop(0.5, 'rgba(255,214,80,' + (0.20 * glow) + ')');
    g.addColorStop(1, 'rgba(255,214,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 70, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // beam
    const beam = ctx.createLinearGradient(0, -190, 0, 0);
    beam.addColorStop(0, 'rgba(255,240,170,0)');
    beam.addColorStop(1, 'rgba(255,236,150,' + (0.28 * glow) + ')');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-400, -190); ctx.lineTo(400, -190); ctx.lineTo(20, 0); ctx.lineTo(-20, 0); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9961f';
    roundRect(ctx, -25, -12, 50, 30, 5); ctx.fill();
    ctx.fillStyle = '#f4cf5c';
    ctx.beginPath();
    ctx.moveTo(-25, -10); ctx.lineTo(-18, -27); ctx.quadraticCurveTo(0, -36, 18, -27); ctx.lineTo(25, -10);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8a6613'; ctx.lineWidth = 2.5;
    ctx.strokeRect(-25, -12, 50, 30);
    ctx.fillStyle = '#fff3b3';
    ctx.fillRect(-4, -11, 8, 11);
    ctx.beginPath(); ctx.arc(0, 4, 4.5, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const a = t * 0.001 + i * 1.4;
      const r = 38 + Math.sin(t * 0.003 + i) * 8;
      ctx.fillStyle = 'rgba(255,247,190,' + (0.5 + Math.sin(t * 0.006 + i) * 0.4) + ')';
      ctx.beginPath(); ctx.arc(Math.cos(a) * r, -10 + Math.sin(a) * r * 0.4, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  };

  /* ---------- ground items ---------- */
  S.drawGroundItem = function (ctx, g, time) {
    const t = time || 0;
    const bob = Math.sin(t * 0.003 + hashStr(g.id) % 5) * 2;
    ctx.save();
    ctx.translate(g.x, g.y + bob);
    ctx.fillStyle = 'rgba(45,70,30,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 8, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (g.res) {
      if (g.res === 'wood') {
        ctx.fillStyle = '#8d5f31';
        roundRect(ctx, -13, -6, 26, 12, 3); ctx.fill();
        ctx.fillStyle = '#b9834a';
        ctx.beginPath(); ctx.arc(-6, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7a5128'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(-6, 0, 2.5, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(6, 0, 2.5, 0, Math.PI * 2); ctx.stroke();
      } else if (g.res === 'stone') {
        ctx.fillStyle = '#8f989e';
        ctx.beginPath(); ctx.moveTo(-13, 7); ctx.lineTo(-8, -7); ctx.lineTo(3, -10); ctx.lineTo(13, 0); ctx.lineTo(9, 8); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#b8c0c5';
        ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(3, -10); ctx.lineTo(5, -1); ctx.lineTo(-5, 1); ctx.closePath(); ctx.fill();
      } else {
        ctx.fillStyle = '#d9a52c';
        ctx.beginPath(); ctx.arc(-5, 2, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(6, 0, 7, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(0, -7, 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f7d875';
        ctx.beginPath(); ctx.arc(0, -8, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = 'bold 11px Georgia';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,40,20,0.55)';
      ctx.strokeText(g.amount + ' ' + g.res, 0, 27);
      ctx.fillStyle = '#fffbe8';
      ctx.fillText(g.amount + ' ' + g.res, 0, 27);
    } else if (g.item) {
      const col = S.swordColor(g.item);
      const isSword = g.item.endsWith('sword');
      if (isSword) {
        ctx.save();
        ctx.rotate(-0.6);
        ctx.fillStyle = '#5b3d22'; ctx.fillRect(-2, 6, 4, 7);
        ctx.fillStyle = '#e8c15a'; ctx.fillRect(-5, 4, 10, 2.5);
        ctx.fillStyle = col[0];
        ctx.beginPath(); ctx.moveTo(-3, 4); ctx.lineTo(3, 4); ctx.lineTo(2, -18); ctx.lineTo(0, -23); ctx.lineTo(-2, -18); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = col[1]; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -17); ctx.stroke();
        ctx.restore();
        if (g.item === 'legendary_sword') {
          ctx.strokeStyle = 'rgba(200,130,255,' + (0.5 + Math.sin(t * 0.006) * 0.3) + ')';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(0, -4, 24, 0, Math.PI * 2); ctx.stroke();
        }
      } else {
        const ac = S.armorColor(g.item) || ['#c4ccd4', '#7f8992'];
        ctx.fillStyle = ac[0];
        ctx.beginPath();
        ctx.moveTo(-13, -9); ctx.lineTo(-7, -14); ctx.lineTo(0, -10); ctx.lineTo(7, -14); ctx.lineTo(13, -9);
        ctx.lineTo(9, 11); ctx.lineTo(-9, 11); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = ac[1]; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = ac[1];
        ctx.fillRect(-2, -9, 4, 18);
      }
    }
    ctx.restore();
  };

  /* ---------- item icons for UI ---------- */
  S.drawItemIcon = function (canvas, type) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const s = w / 48;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    if (type === 'wood' || type === 'stone' || type === 'gold') {
      S.drawGroundItem(ctx, { id: 'icon', x: 0, y: 0, res: type, amount: 0 }, 0);
    } else if (type && type.endsWith('sword')) {
      const col = S.swordColor(type);
      ctx.save();
      ctx.rotate(0.75);
      ctx.fillStyle = '#5b3d22'; ctx.fillRect(-2.5, 12, 5, 10);
      ctx.fillStyle = '#e8c15a'; ctx.fillRect(-7, 9, 14, 3.5);
      ctx.fillStyle = col[0];
      ctx.beginPath(); ctx.moveTo(-4, 9); ctx.lineTo(4, 9); ctx.lineTo(3, -16); ctx.lineTo(0, -23); ctx.lineTo(-3, -16); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col[1]; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(0, -15); ctx.stroke();
      if (type === 'legendary_sword') {
        ctx.strokeStyle = '#c982ff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(220,160,255,0.25)';
        ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    } else if (type && type.endsWith('armor')) {
      const ac = S.armorColor(type) || ['#c4ccd4', '#7f8992'];
      ctx.fillStyle = ac[0];
      ctx.beginPath();
      ctx.moveTo(-16, -11); ctx.lineTo(-8, -18); ctx.lineTo(0, -12); ctx.lineTo(8, -18); ctx.lineTo(16, -11);
      ctx.lineTo(11, 15); ctx.lineTo(-11, 15); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ac[1]; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.fillStyle = ac[1]; ctx.fillRect(-2.5, -11, 5, 23);
      ctx.beginPath(); ctx.arc(-8, -4, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(8, -4, 3, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'fist') {
      ctx.fillStyle = '#efc39d';
      ctx.beginPath(); ctx.arc(0, 3, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e0b087';
      ctx.fillRect(-9, -8, 5, 7); ctx.fillRect(-2, -10, 5, 8); ctx.fillRect(5, -8, 5, 7);
    }
    ctx.restore();
  };

  S.drawBuildingIcon = function (canvas, type) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(canvas.width / 80, canvas.height / 80);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 + 8);
    ctx.scale(s, s);
    S.drawBuilding(ctx, type, 0, 0, 1, 0, 1);
    ctx.restore();
  };

  window.Sprites = S;
})();
