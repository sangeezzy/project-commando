'use strict';
// ---------- Бой (только хост/соло): стрельба, пули, урон, взрывчатка, шум ----------

// Шум: враги в радиусе r (по пути вокруг стен) слышат его.
// loud — выстрел/взрыв: сразу тревога. Иначе (шаги, приманка) — настораживаются и идут проверить.
function makeNoise(x, y, r, loud) {
  if (r <= 0) return;
  const maxD = Math.ceil(r / TILE);
  let field = null;
  for (const e of G.enemies) {
    if (e.dead || e.stun > 0 || e.leave || ETYPES[e.t].boss) continue;
    if (Math.hypot(e.x - x, e.y - y) > r + TILE) continue;
    field = field || bfsFrom(x, y, maxD);
    if (field.f[tileIndex(e.x, e.y)] > maxD) continue;
    if (loud || e.st === 2) {
      if (e.st !== 2) { e.st = 2; e.alertT = 1; }
    } else if (e.st === 0) { e.st = 1; e.susT = 1.2; }
    if (!e.saw) { e.goal = field; e.searchT = 0; }
  }
}

// враг узнал, откуда угроза — тревога и идём туда
function alarmEnemy(e, x, y) {
  if (e.st !== 2) { e.st = 2; e.alertT = 1; }
  if (!e.saw) { e.goal = bfsFrom(x, y, 60); e.searchT = 0; }
}

// ---------- Оружие героев ----------
function playerFire(p) {
  const W = weaponOf(p);
  const base = p.a;
  for (let i = 0; i < W.n; i++) {
    const a = base + rand(-W.spread, W.spread);
    const x = p.x + Math.cos(base) * 16, y = p.y + Math.sin(base) * 16;
    const sp = W.speed * (W.n > 1 ? rand(0.85, 1.1) : 1);
    G.bullets.push({ x, y, sx: p.x, sy: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, side: 'p', o: p.idx,
      dmg: W.dmg, life: W.life, pierce: W.pierce || 1, hit: [] });
  }
  p.flashT = MUZZLE_FLASH_T;
  G.loudT = 3;
  emit(['shot', p.x + Math.cos(base) * 18, p.y + Math.sin(base) * 18, base, p.idx, W.sfx]);
  makeNoise(p.x, p.y, W.noise, true);
}

function playerSpecial(p, tx, ty) {
  const sp = CHARS[p.ch].special;
  if (sp === 'mark') {
    // ближайший к точке прицела видимый враг
    let best = null, bd = 90;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - tx, e.y - ty);
      if (d < bd && los(p.x, p.y, e.x, e.y)) { bd = d; best = e; }
    }
    if (best) { best.mark = 12; emit(['spark', best.x, best.y, '#9dff3a']); }
    return;
  }
  // бросок: граната/светошумовая/приманка, не дальше 280 px и не сквозь стены
  let dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy), maxD = 280;
  if (d > maxD) { dx *= maxD / d; dy *= maxD / d; }
  G.nades.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, tx: p.x + dx, ty: p.y + dy, t: 0, o: p.idx, kind: sp });
  emit(['throw', p.x, p.y, p.idx]);
}

// Ближний бой: тихое устранение ничего не подозревающего врага или врага со спины
function playerMelee(p) {
  emit(['mel', p.x, p.y, p.a, p.idx]);
  makeNoise(p.x, p.y, NOISE.melee, false);
  let best = null, bd = 44;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const r = ETYPES[e.t].r;
    const d = dist(p, e) - r;
    if (d > bd) continue;
    if (Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.a)) > 1.2) continue;
    bd = d; best = e;
  }
  if (!best) return;
  const T = ETYPES[best.t];
  const fromBehind = Math.abs(angDiff(Math.atan2(p.y - best.y, p.x - best.x), best.a)) > 1.9;
  if (T.boss) { if (fromBehind) damageEnemy(best, 3, p.idx, p.x, p.y); else emit(['armor', best.x, best.y]); return; }
  const unaware = best.st < 2 || best.stun > 0;
  if (unaware && (fromBehind || !T.armor)) {
    best.silent = true;
    damageEnemy(best, 999, p.idx, p.x, p.y);
    emit(['take', best.x, best.y, p.idx]);
  } else {
    damageEnemy(best, 1, p.idx, p.x, p.y);
    best.stun = Math.max(best.stun, 0.4);
  }
}

// ---------- Урон ----------
// sx, sy — откуда пришёл удар (для брони B2 и босса). Возвращает: 0 попал, 1 убил, 2 броня.
function damageEnemy(e, dmg, by, sx, sy) {
  if (e.dead) return -1;
  const T = ETYPES[e.t];
  const dirIn = Math.atan2(e.y - sy, e.x - sx);              // направление полёта удара
  const front = Math.abs(angDiff(Math.atan2(sy - e.y, sx - e.x), e.a));   // 0 — удар спереди
  if (T.boss) {
    if (front < 1.75) { emit(['armor', e.x - Math.cos(dirIn) * T.r, e.y - Math.sin(dirIn) * T.r]); hitmark(by, 2); return 2; }
    if (by < 0) dmg *= 0.5;      // союзники помогают, но главное — за отрядом
  } else if (T.armor) {
    dmg *= front < Math.PI / 2 ? 0.5 : 1.5;
  }
  const before = e.hp / e.maxHp;
  e.hp -= dmg;
  e.flash = 0.12;
  const attacker = by >= 0 ? pById(by) : null;
  if (!e.silent) {
    if (attacker) alarmEnemy(e, attacker.x, attacker.y);
    else if (T.fac === 'sep') alarmEnemy(e, sx, sy);
  }
  if (e.hp > 0) {
    const frac = e.hp / e.maxHp;
    emit(['hit', e.x, e.y, e.t, dirIn, r2(frac)]);
    // деталь отлетает, когда здоровье перевалило за половину
    if (before > 0.5 && frac <= 0.5 && !T.boss) emit(['limb', e.x, e.y, e.t, dirIn]);
    hitmark(by, front < Math.PI / 2 && T.armor ? 2 : 0);
    return 0;
  }
  e.dead = true;
  if (!e.silent) makeNoise(e.x, e.y, NOISE.death, false);   // предсмертный крик / треск
  emit(['kill', e.x, e.y, e.t, dirIn]);
  hitmark(by, 1);
  if (attacker) attacker.kills = (attacker.kills || 0) + 1;
  return 1;
}

function hitmark(by, kind) { if (by >= 0) emit(['hm', by, kind]); }

function damagePlayer(p, dmg, sx, sy) {
  if (p.down || p.dash > 0) return;
  p.hp -= dmg;
  p.hurtT = 0; p.regenT = 0;
  emit(['phit', p.x, p.y, p.idx]);
  if (p.hp <= 0) downPlayer(p);
}

function downPlayer(p) {
  p.hp = 0; p.down = true; p.revive = 0;
  if (p.ride >= 0) dismount(p);
  emit(['pdown', p.x, p.y, p.idx]);
}

function damageAlly(a, dmg) {
  if (a.dead) return;
  a.hp -= dmg;
  a.flash = 0.12;
  if (a.hp <= 0) {
    a.dead = true;
    if (a.t === 'clone' && !a.tech) G.m.clonesLeft = Math.max(0, G.m.clonesLeft - 1);
    emit(['akill', a.x, a.y, ATYPES[a.t].color]);
  }
}

function explode(x, y, owner, kind) {
  if (kind === 'flash') {
    emit(['flashbang', x, y]);
    makeNoise(x, y, NOISE.flash, true);
    for (const e of G.enemies) {
      if (e.dead || ETYPES[e.t].boss) continue;
      if (Math.hypot(e.x - x, e.y - y) < 150 && los(x, y, e.x, e.y)) { e.stun = 3; e.burst = 0; e.wind = 0; }
    }
    return;
  }
  emit(['boom', x, y]);
  makeNoise(x, y, NOISE.boom, true);
  for (const e of G.enemies) {
    if (!e.dead && Math.hypot(e.x - x, e.y - y) < 105 + ETYPES[e.t].r && los(x, y, e.x, e.y)) damageEnemy(e, 6, owner, x, y);
  }
  G.bullets = G.bullets.filter((b) => b.side !== 'e' || Math.hypot(b.x - x, b.y - y) > 105);
}

function updateNades(dt) {
  for (let i = G.nades.length - 1; i >= 0; i--) {
    const n = G.nades[i];
    n.t += dt;
    if (n.kind === 'decoy' && n.t > 0.45) {
      // приманка лежит и шумит
      n.pulse = (n.pulse || 0) - dt;
      if (n.pulse <= 0) { n.pulse = 1.4; emit(['decoy', n.x, n.y]); makeNoise(n.x, n.y, NOISE.decoy, false); }
      if (n.t > 6.5) G.nades.splice(i, 1);
      continue;
    }
    const k = Math.min(1, n.t / 0.45);
    const nx = n.sx + (n.tx - n.sx) * k, ny = n.sy + (n.ty - n.sy) * k;
    if (!solidAt(nx, ny)) { n.x = nx; n.y = ny; } else { n.sx = n.tx = n.x; n.sy = n.ty = n.y; }
    const fuse = n.kind === 'flash' ? 0.9 : 1.15;
    if (n.t >= fuse) { explode(n.x, n.y, n.o, n.kind); G.nades.splice(i, 1); }
  }
}

// ---------- Пули ----------
function updateBullets(dt) {
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / 8));
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      b.x += (b.vx * dt) / steps; b.y += (b.vy * dt) / steps;
      const t = tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE));
      // низкое укрытие держит выстрел, если стрелок не стоит вплотную к нему
      const blocked = t === T.WALL || t === T.DEBRIS || t === T.GATE ||
        (t === T.LOW && Math.hypot(b.x - b.sx, b.y - b.sy) > 48);
      if (blocked) {
        emit(['spark', b.x - b.vx * 0.005, b.y - b.vy * 0.005, b.side === 'e' ? ENEMY_BOLT : '#ffffff']);
        dead = true; break;
      }
      if (b.side !== 'e') {
        for (const e of G.enemies) {
          if (e.dead || b.hit.includes(e.id)) continue;
          if (Math.hypot(e.x - b.x, e.y - b.y) < ETYPES[e.t].r + 3) {
            b.hit.push(e.id);
            damageEnemy(e, b.dmg, b.side === 'p' ? b.o : -1, b.x - b.vx * 0.02, b.y - b.vy * 0.02);
            if (--b.pierce <= 0) { dead = true; break; }
          }
        }
      } else {
        for (const p of G.players) {
          if (p.down || p.dash > 0) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) < PR + 3) { damagePlayer(p, b.dmg, b.sx, b.sy); dead = true; break; }
        }
        if (dead) break;
        for (const a of G.allies) {
          if (a.dead) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) < ATYPES[a.t].r + 3) { damageAlly(a, b.dmg); dead = true; break; }
        }
      }
    }
    b.life -= dt;
    if (dead || b.life <= 0) G.bullets.splice(i, 1);
  }
}

// Выстрел врага или союзника. side: 'e' — по героям, 'a' — по врагам.
function shootBolt(o, aim, spread, speed, side, dmg = 1) {
  const a = aim + rand(-spread, spread);
  const r = side === 'e' ? ETYPES[o.t].r : ATYPES[o.t].r;
  const x = o.x + Math.cos(a) * (r + 4), y = o.y + Math.sin(a) * (r + 4);
  G.bullets.push({ x, y, sx: o.x, sy: o.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, side, o: -1, dmg, life: 2.2, pierce: 1, hit: [] });
  o.flashT = MUZZLE_FLASH_T;
  emit(['shot', x, y, a, side === 'e' ? -1 : -2]);
}

// Сглаженная оценка скорости цели (для упреждения)
function trackVelocity(p, dt) {
  if (dt <= 0) return;
  if (p.px === undefined || p.pdt === undefined) { p.px = p.x; p.py = p.y; p.vx = 0; p.vy = 0; p.pdt = 0; }
  let vx = (p.x - p.px) / dt, vy = (p.y - p.py) / dt;
  const sp = Math.hypot(vx, vy), max = 420;
  if (sp > max) { vx *= max / sp; vy *= max / sp; }
  const k = Math.min(1, dt * 10);
  p.vx += (vx - p.vx) * k; p.vy += (vy - p.vy) * k;
  p.px = p.x; p.py = p.y; p.pdt = dt;
}

// Угол стрельбы с упреждением: решаем |D + V·t| = s·t. lead — доля учтённой скорости цели.
function leadAngle(e, p, s, lead) {
  const dx = p.x - e.x, dy = p.y - e.y;
  const vx = (p.vx || 0) * lead, vy = (p.vy || 0) * lead;
  const direct = Math.atan2(dy, dx);
  if (!lead) return direct;
  const a = vx * vx + vy * vy - s * s;
  const b = 2 * (dx * vx + dy * vy);
  const c = dx * dx + dy * dy;
  let t = -1;
  if (Math.abs(a) < 1e-6) t = b < 0 ? -c / b : -1;
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a), t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
  }
  if (!(t > 0) || t > 1.2) return direct;
  const ax = p.x + vx * t, ay = p.y + vy * t;
  if (!los(e.x, e.y, ax, ay)) return direct;
  return Math.atan2(ay - e.y, ax - e.x);
}

// Пуля летит в сторону o и пройдёт близко — повод увернуться
function incomingBolt(o, side, range = 140) {
  for (const b of G.bullets) {
    if (b.side !== side) continue;
    const dx = o.x - b.x, dy = o.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d > range) continue;
    const sp = Math.hypot(b.vx, b.vy);
    const along = (dx * b.vx + dy * b.vy) / sp;
    if (along <= 0) continue;
    const perp = Math.abs(dx * b.vy - dy * b.vx) / sp;
    if (perp < 24) return b;
  }
  return null;
}
