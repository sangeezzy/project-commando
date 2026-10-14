'use strict';
// ---------- Оружие: стрельба, перезарядка, баллистика, пробитие, урон ----------

// Разброс стрелка-игрока (мрад, σ): прицел/от бедра, присед, движение, отдача
function playerSpread(o) {
  const W = WEAPONS[o.gun.t];
  const still = o.crouch ? W.aimCrouch : W.aimStill;
  const base = still + (W.hip - still) * (1 - o.ads);
  const mv = clamp(o.speed / M(SPEED.walk), 0, 1.5);
  const move = mv * (W.moveAds + (W.moveHip - W.moveAds) * (1 - o.ads));
  return W.mech + base + move + o.gun.bloom;
}

const canShoot = (o) => !o.dead && !o.down && !o.reviving && !o.gun.reloadT && o.sprintLock <= 0 && !o.sprint && !o.sw && !o.melee;

// Спуск. held — курок зажат, pressed — нажат в этот кадр. spread — σ разброса в мрад.
function pullTrigger(o, held, pressed, spread) {
  const g = o.gun, W = WEAPONS[g.t];
  // ружьё заряжают по патрону — нажатый курок прерывает дозарядку (если в патроннике есть)
  if (pressed && g.reloadT > 0 && W.cls === 'shotgun' && g.chamber) g.reloadT = 0;
  if (!held || g.cd > 0 || !canShoot(o)) return false;
  if (g.mode !== 'auto' && !pressed) return false;     // одиночный, помпа — каждый выстрел новым нажатием
  if (!g.chamber) {
    if (pressed) { emit(['dry', o.x, o.y, o.side, o.id]); makeNoise(o.x, o.y, M(NOISE.dryfire), 'step', o); }
    return false;
  }
  fireRound(o, spread);
  // остаток интервала переносим: темп не зависит от частоты кадров
  g.cd += 60 / W.rpm;
  return true;
}

function fireRound(o, spread) {
  const g = o.gun, W = WEAPONS[g.t];
  g.chamber = 0;
  if (g.mag > 0) { g.mag--; g.chamber = 1; }      // автоматика дослала следующий; на последнем затвор встаёт на задержку
  const aim = o.a + gauss() * spread * MRAD;
  // пуля стартует из плеча стрелка (при выглядывании — смещённого вбок, но не за стену), рисуется от дула
  const ox = o.leanPx ? o.lx : o.x, oy = o.leanPx ? o.ly : o.y;
  const reach = M(0.25 + W.len / 40);                // дуло: дальше у длинного ствола
  const mx = ox + Math.cos(o.a) * reach, my = oy + Math.sin(o.a) * reach;
  const v = W.v0 * PX_M;
  // ружьё — осыпь дробин вокруг точки прицела
  for (let i = 0; i < (W.pellets || 1); i++) {
    const a = W.pellets ? aim + gauss() * W.pelletSpread * MRAD : aim;
    G.bullets.push({
      x: ox, y: oy, sx: ox, sy: oy, mx, my, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      owner: o.id, side: o.side, crouch: o.crouch, e: 1, dist: 0, max: M(W.maxRange),
      tile: -1, near: [], t: W, pellet: !!W.pellets,
    });
  }
  g.bloom = Math.min(W.maxBloom, g.bloom + (!o.ai ? W.kick + (W.kickHip - W.kick) * (1 - o.ads) : W.kick));
  g.lastShot = G.time;
  o.flashT = 0.06;
  emit(['shot', mx, my, o.a, o.side, o.id, g.t]);
  makeNoise(o.x, o.y, M(NOISE.shot), 'shot', o);
}

function updateGun(o, dt) {
  const g = o.gun, W = WEAPONS[g.t];
  g.cd = Math.max(-0.02, g.cd - dt);
  g.bloom *= Math.exp(-W.recover * dt);
  if (g.reloadT > 0) {
    g.reloadT -= dt;
    if (g.reloadT <= 0) finishReload(o);
  }
  updateArms(o, dt);
  updateMelee(o, dt);
}

// Есть чем перезарядить: магазин полнее текущего / у ружья — патроны россыпью и место в магазине
function canReload(g) {
  const W = WEAPONS[g.t];
  if (W.cls === 'shotgun') return g.pouch[0] > 0 && (g.mag < W.mag || !g.chamber);
  return g.mag < W.mag && g.pouch.some((n) => n > g.mag);
}

// Перезарядка: текущий магазин (если в нём что-то есть) — в подсумок, берём самый полный.
// Ружьё — по патрону (shellT), пустое — первый через окно в патронник (shellFirst); нажатый курок прерывает.
function startReload(o, quick = false) {
  const g = o.gun, W = WEAPONS[g.t];
  if (g.reloadT > 0 || o.dead || o.sw) return false;
  g.quick = false;
  if (W.cls === 'shotgun') {
    if (g.mag >= W.mag && g.chamber) return false;
    if (!(g.pouch[0] > 0)) { emit(['nomag', o.id]); return false; }
    g.reloadEmpty = !g.chamber;
    g.reloadDur = g.reloadT = g.chamber ? W.shellT : W.shellFirst;
    emit(['reload', o.x, o.y, o.side, 2, o.id]);
    makeNoise(o.x, o.y, M(NOISE.reload), 'step', o);
    return true;
  }
  if (g.mag >= W.mag) return false;
  if (!g.pouch.some((n) => n > g.mag)) { emit(['nomag', o.id]); return false; }
  g.reloadEmpty = !g.chamber;
  g.quick = quick;
  g.reloadDur = g.reloadT = (g.reloadEmpty ? W.reloadEmpty : W.reloadTac) * (quick ? RELOAD_QUICK.k : 1);
  emit(['reload', o.x, o.y, o.side, g.reloadEmpty ? 1 : 0, o.id]);
  makeNoise(o.x, o.y, M(NOISE.reload), 'step', o);
  return true;
}

function finishReload(o) {
  const g = o.gun, W = WEAPONS[g.t];
  g.reloadT = 0;
  if (W.cls === 'shotgun') {
    g.pouch[0]--;
    if (!g.chamber) g.chamber = 1; else g.mag++;
    g.reloadEmpty = false;
    // следующий патрон — пока есть место и патроны (курок прерывает)
    if ((g.mag < W.mag) && g.pouch[0] > 0) {
      g.reloadDur = g.reloadT = W.shellT;
      emit(['reload', o.x, o.y, o.side, 2, o.id]);
    }
    return;
  }
  let best = 0;
  for (let i = 1; i < g.pouch.length; i++) if (g.pouch[i] > g.pouch[best]) best = i;
  const fresh = g.pouch.splice(best, 1)[0];
  if (g.mag > 0 && !g.quick) g.pouch.push(g.mag);   // недострелянный магазин остаётся, пустой — выброшен; быстрая — выброшен любой
  g.quick = false;
  g.mag = fresh;
  if (!g.chamber && g.mag > 0) { g.mag--; g.chamber = 1; }
}

function cancelReload(o) { o.gun.reloadT = 0; }

// Быстрая перезарядка (второе нажатие R): только что начатую обычную — ускорить (прошедшее время засчитывается), иначе начать быструю.
// Магазин выбрасывается целиком. Помповому ружью — нет (заряжают по патрону).
function quickReload(o) {
  const g = o.gun, W = WEAPONS[g.t];
  if (W.cls === 'shotgun') return false;
  if (g.reloadT > 0) {
    if (g.quick) return false;
    const done = g.reloadDur - g.reloadT, dur = g.reloadDur * RELOAD_QUICK.k;
    g.quick = true; g.reloadDur = dur; g.reloadT = Math.max(0.05, dur - done);
    return true;
  }
  return startReload(o, true);
}

// ---------- Смена оружия (1, 2 — полноразмерные, 3 — пистолет) ----------
// Сколько займёт смена на слот to (с): пистолет выхватывается быстро (полноразмерное — в левую руку);
// обратно — быстро, если полноразмерное ещё в левой руке, долго — если уже за спиной
function switchTime(o, to) {
  if (to === 2) return SWITCH.toPistol;
  if (o.cur === 2) return o.off === to ? SWITCH.fromHand : SWITCH.fromBack;
  return SWITCH.primToPrim;
}
function switchTo(o, to) {
  if (o.dead || o.down || o.sw || to === o.cur || !o.kit || !o.kit[to]) return false;
  o.gun.reloadT = 0;                         // смена прерывает перезарядку
  o.sw = { to, t: 0, dur: switchTime(o, to) };
  o.ads = Math.min(o.ads, 0.3);
  emit(['wsw', o.x, o.y, o.side, o.id]);
  return true;
}
// Каждый кадр: идёт смена; полноразмерное из левой руки — за спину, если противников не видно и не стрелял stowDelay с
function updateArms(o, dt) {
  if (o.sw) {
    o.sw.t += dt;
    if (o.sw.t >= o.sw.dur) {
      const to = o.sw.to;
      if (to === 2) o.off = o.cur;            // полноразмерное — в левую руку
      else o.off = -1;
      o.cur = to; o.gun = o.kit[to]; o.sw = null; o.stowT = 0;
      o.gun.cd = Math.max(o.gun.cd, 0);
    }
    return;
  }
  if (o.cur !== 2 || o.off < 0) return;
  const busy = G.time - o.gun.lastShot < SWITCH.stowDelay || foesOf(o.side).some((t) => !t.dead && Math.hypot(t.x - o.x, t.y - o.y) < M(60) && los(o.x, o.y, t.x, t.y));
  o.stowT = busy ? 0 : o.stowT + dt;
  if (o.stowT >= SWITCH.stow) { o.off = -1; o.stowT = 0; }
}

// ---------- Нож (X): быстрый удар перед собой ----------
function startMelee(o) {
  if (o.dead || o.down || o.melee || o.reviving || o.act) return false;
  o.gun.reloadT = 0;
  o.melee = { t: 0, dur: KNIFE.dur, hit: false };
  emit(['knife', o.x, o.y, o.a, 0, o.id]);
  return true;
}
function updateMelee(o, dt) {
  const k = o.melee;
  if (!k) return;
  k.t += dt;
  if (!k.hit && k.t >= KNIFE.hitAt) {
    k.hit = true;
    // ближайший в секторе перед собой (свои тоже — нож не разбирает)
    let best = null, bd = KNIFE.range + PR;
    for (const t of allPeople()) {
      if (t === o || t.dead) continue;
      const d = Math.hypot(t.x - o.x, t.y - o.y);
      if (d > bd || Math.abs(angDiff(Math.atan2(t.y - o.y, t.x - o.x), o.a)) > KNIFE.arc || !los(o.x, o.y, t.x, t.y)) continue;
      bd = d; best = t;
    }
    if (best) {
      const vital = Math.random() < KNIFE.vital;
      damagePerson(best, vital ? 999 : rand(KNIFE.dmg[0], KNIFE.dmg[1]), o.x, o.y, o.a, o);
      if (!o.ai) emit(['hm', o.id, best.dead ? 1 : 0]);
      emit(['knife', best.x, best.y, o.a, 1, o.id]);
    }
    makeNoise(o.x, o.y, M(3), 'step', o);
  }
  if (k.t >= k.dur) o.melee = null;
}

const ammoTotal = (g) => g.mag + g.chamber + g.pouch.reduce((s, n) => s + n, 0);

// ---------- Пули ----------
// Скорость ~29 000 px/с: за кадр пуля пролетает экран, поэтому идём мелкими шагами.
function updateBullets(dt) {
  const people = [...G.players, ...G.enemies].filter((o) => !o.dead);
  for (let i = G.bullets.length - 1; i >= 0; i--) {
    const b = G.bullets[i];
    const sp = Math.hypot(b.vx, b.vy);
    const len = sp * dt, steps = Math.max(1, Math.ceil(len / 6));
    const ux = b.vx / sp, uy = b.vy / sp, st = len / steps;
    b.fx = b.x; b.fy = b.y;
    let dead = false;
    for (let s = 0; s < steps && !dead; s++) {
      b.x += ux * st; b.y += uy * st; b.dist += st;
      if (b.dist > b.max) { dead = true; break; }
      const tx = Math.floor(b.x / TILE), ty = Math.floor(b.y / TILE), ti = ty * map.w + tx;
      const t = tileAt(tx, ty);
      if (t !== T.FLOOR && ti !== b.tile) {
        b.tile = ti;
        if (bulletHitsTile(b, tx, ty, t, people)) {
          const m = MAT[wmAt(tx, ty)];
          emit(['imp', b.x - ux * 3, b.y - uy * 3, Math.atan2(-uy, -ux), m.fx]);
          b.e *= m.pen > 0 ? Math.pow(m.pen, b.t.penExp ?? 1) : 0;     // слабый патрон (пистолет, картечь) теряет больше
          if (b.e < 0.2) { dead = true; break; }
          // пробил — теряет энергию и чуть отклоняется
          const a = Math.atan2(uy, ux) + gauss() * 0.05 * (1 - m.pen);
          b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp;
        }
      } else if (t === T.FLOOR) b.tile = -1;
      for (const o of people) {
        if (o.id === b.owner) continue;
        const d = Math.hypot(o.x - b.x, o.y - b.y);
        if (d < PR + 1) { hitPerson(o, b); dead = true; break; }
        // высунувшиеся голова и плечо
        if (Math.abs(o.lean || 0) > 0.25 && Math.hypot(o.lx - b.x, o.ly - b.y) < LEAN.headR) { hitPerson(o, b); dead = true; break; }
        // свист и щелчок пролетевшей рядом пули (сверхзвук) — подавление
        if (d < M(2) && !b.near.includes(o.id)) {
          b.near.push(o.id);
          o.supp = Math.min(1, o.supp + (d < M(1) ? 0.35 : 0.2));
          if (o.ai && o.st < 2) alertEnemy(o, b.sx, b.sy, false);
          if (!o.ai) emit(['crack', b.x, b.y, o.id]);
        }
      }
    }
    if (dead) {
      emit(['trail', b.mx, b.my, b.x, b.y]);
      G.bullets.splice(i, 1);
    }
  }
}

// Низкое укрытие ловит пулю: вплотную у стрелка — если он присел (стоя стреляют поверх);
// у цели — если за ним присел человек (всегда) или стоит (STAND_COVER_HIT). Иначе пуля идёт поверх.
function bulletHitsTile(b, tx, ty, t, people) {
  if (opaqueT(t)) return true;   // стена или закрытая дверь
  const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
  if (Math.hypot(cx - b.sx, cy - b.sy) < COVER_NEAR + TILE / 2) return b.crouch;
  for (const o of people) {
    if (o.id === b.owner) continue;
    const d = Math.hypot(o.x - cx, o.y - cy);
    if (d > COVER_NEAR + TILE / 2) continue;
    // человек за укрытием (дальше по ходу пули), а не перед ним
    if ((o.x - cx) * b.vx + (o.y - cy) * b.vy <= 0) continue;
    if (o.crouch) return true;
    return Math.random() < STAND_COVER_HIT;
  }
  return false;
}

function hitPerson(o, b) {
  const W = b.t;
  const m = b.dist / PX_M;
  const k = b.e * Math.max(0.3, 1 - W.dropPerM * m);
  let vital = Math.random() < W.vital * b.e;
  let dmg = rand(W.dmg[0], W.dmg[1]) * k;
  // броня: попадание в плиту — держит или нет по уровню (ARMOR, WEAPONS.threat)
  const ar = armorHit(o, W, k);
  if (ar === 'stop') { dmg *= ARMOR_HIT.blunt; vital = false; }
  else if (ar === 'through') { dmg *= ARMOR_HIT.through; vital = vital && Math.random() < 0.5; }
  const shooter = [...G.players, ...G.enemies].find((q) => q.id === b.owner);
  damagePerson(o, vital ? 999 : dmg, b.sx, b.sy, Math.atan2(b.vy, b.vx), shooter);
  if (shooter && !shooter.ai) emit(['hm', shooter.id, o.dead ? 1 : 0, ar === 'stop' ? 1 : 0]);
}

// ---------- Броня ----------
function giveArmor(o, cls) { o.armor = cls ? { cls, hp: 100 } : null; }
// Пуля попала в бойца: в плиту ли (ARMOR_HIT.cover), удержала ли. Плита изнашивается (урон по калибру × энергия), сильнее — если пробита.
// Возвращает 'stop' (удержала), 'through' (пробита), null (мимо плиты или брони нет / разбита)
function armorHit(o, W, k = 1) {
  const a = o.armor;
  if (!a || a.hp <= 0 || Math.random() >= ARMOR_HIT.cover) return null;
  const lvl = ARMOR[a.cls].lvl;
  // изношенная плита держит хуже: ниже worn — с вероятностью hp / worn
  const stop = W.threat <= lvl && (a.hp >= ARMOR_HIT.worn || Math.random() < a.hp / ARMOR_HIT.worn);
  a.hp = Math.max(0, a.hp - W.armorDmg * k * (stop ? 1 : ARMOR_HIT.overK));
  emit(['arm', o.x, o.y, o.id, stop ? 1 : 0]);
  return stop ? 'stop' : 'through';
}

function damagePerson(o, dmg, sx, sy, ang, by) {
  if (o.dead || o.god) return;          // отладка: бессмертие ([) — урона нет совсем
  if (o.down) { emit(['blood', o.x, o.y, ang, 1]); killPerson(o, ang); return; }   // по раненому — добит
  o.hp -= dmg;
  o.hurtT = 0;
  o.supp = 1;
  emit(['blood', o.x, o.y, ang, dmg > 60 ? 1 : 0]);
  if (!o.ai) {
    emit(['hurt', o.id, Math.atan2(sy - o.y, sx - o.x)]);
  } else if (!o.dead) {
    // раненый знает, откуда стреляли
    alertEnemy(o, sx, sy, true);
    if (by) { o.target = by; o.lastX = by.x; o.lastY = by.y; o.lastSeen = G.time; }
  }
  if (o.hp <= 0) {
    if (o.side === 'p') goDown(o, ang);     // боец отряда падает раненым
    else killPerson(o, ang);
  }
}

function killPerson(o, ang) {
  o.hp = 0; o.dead = true; o.down = false; o.deadT = G.time; o.deadA = ang ?? o.deadA ?? o.a;
  o.gun.reloadT = 0; o.act = null; o.reviving = 0;
  emit(['die', o.x, o.y, o.deadA, o.side]);
  runCount(o);
  makeNoise(o.x, o.y, M(NOISE.body), 'step', o);
}

// Ранен: лежит, ползёт, истекает кровью DOWN.bleed с; товарищ может поднять
function goDown(o, ang) {
  Object.assign(o, { hp: 0, down: true, bleed: DOWN.bleed, rev: 0, deadA: ang, crouch: true, ads: 0, sprint: false,
    leanWant: 0, act: null, reviving: 0, lamp: false });
  o.gun.reloadT = 0;
  if (o.ai) { o.peek = null; o.flank = null; o.fm = null; o.role = null; o.doorFire = null; o.burst = 0; bark(o, 'Я ранен!'); }
  emit(['down', o.x, o.y, o.id]);
  makeNoise(o.x, o.y, M(NOISE.body), 'step', o);
}

// Поднять: встаёт с DOWN.reviveHp
function reviveUp(o) {
  Object.assign(o, { down: false, hp: DOWN.reviveHp, bleed: 0, rev: 0, crouch: false, hurtT: 0 });
  emit(['up', o.x, o.y, o.id]);
}

// Раненые: кто поднимает (держит F рядом / бот), кровотечение, подъём
function updateDowned(dt) {
  const mine = me();
  for (const h of G.players) {
    h.reviving = 0;
    if (h.dead || h.down) continue;
    const want = h.ai ? h.reviveWant : h.net ? h.inHoldF : h === mine && !!keys.KeyF;
    if (!want) continue;
    let best = null, bd = DOWN.reviveR;
    for (const t of G.players) {
      if (t === h || !t.down || t.dead) continue;
      const d = Math.hypot(t.x - h.x, t.y - h.y);
      if (d < bd && los(h.x, h.y, t.x, t.y)) { bd = d; best = t; }     // не через стену
    }
    if (best) { best.revivedBy = h; h.reviving = best.id; }
  }
  for (const o of G.players) {
    if (!o.down || o.dead) { o.revivedBy = null; continue; }
    if (o.revivedBy) {
      // поднимают — кровотечение остановлено
      o.rev += dt / DOWN.revive;
      if (o.rev >= 1) reviveUp(o);
    } else {
      o.rev = Math.max(0, o.rev - dt * DOWN.decay);
      if (!o.god) o.bleed -= dt;
      if (o.bleed <= 0) killPerson(o, o.deadA);
    }
    o.lastReviver = o.revivedBy ? o.revivedBy.id : 0;
    o.revivedBy = null;
  }
}
