'use strict';
// ---------- ИИ врагов и союзников (только хост/соло) ----------
// Состояния врага: 0 спокоен (патруль), 1 насторожен «?» (идёт проверить), 2 тревога «!» (бой/поиск)

// Цели врагов: герои (кроме павших) и союзники
function enemyTargets() {
  const t = [];
  for (const p of G.players) if (!p.down) t.push(p);
  for (const a of G.allies) if (!a.dead) t.push(a);
  return t;
}

// Цель выдаёт себя светом: фонарь в темноте или вспышка выстрела
const targetLit = (t) => !!t.lamp || t.flashT > 0;

function sightRange(e, t) {
  if (!darkAt(t.x, t.y) || targetLit(t)) return ENEMY_SIGHT;
  return e.st === 2 ? DARK_SIGHT_ALERT : DARK_SIGHT;
}

function enemySees(e, t, d) {
  if (d > sightRange(e, t)) return false;
  const fov = e.st === 2 ? 2.2 : e.st === 1 ? 1.4 : 1.05;
  const facing = Math.abs(angDiff(Math.atan2(t.y - e.y, t.x - e.x), e.a)) < fov;
  const glow = t.lamp && darkAt(t.x, t.y) && d < LIGHT_NOTICE;
  return (facing || d < 60 || glow) && los(e.x, e.y, t.x, t.y);
}

// Точка освещена чьим-то фонарём
function litByLamp(x, y) {
  for (const p of G.players) {
    if (p.down || !p.lamp) continue;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d > FLASH_RANGE || d < 1) continue;
    if (Math.abs(angDiff(Math.atan2(y - p.y, x - p.x), p.a)) > FLASH_HALF + 0.08) continue;
    if (los(p.x, p.y, x, y)) return p;
  }
  return null;
}

function moveDir(e, ang, speed, dt) {
  return moveCircle(e, Math.cos(ang) * speed * dt, Math.sin(ang) * speed * dt, ETYPES[e.t] ? ETYPES[e.t].r : 11);
}

// Тревога по району: все враги района бегут к источнику, центр узнаёт о штурме
function raiseAlarm(zone, x, y) {
  const m = G.m;
  if (!m) return;
  if (zone === 'out') { if (m.alarm) return; m.alarm = true; m.centerAlert = true; }
  else if (zone === 'cen') { if (m.cenAlarm) return; m.cenAlarm = true; m.centerAlert = true; }
  else return;
  emit(['alarm', zone]);
  say('ПЕРЕХВАТ', zone === 'out' ? 'Тревога! Республиканцы на окраинах! Всем постам — к бою!' : 'Тревога в центре! Защищать объект связи!', 5);
  const f = bfsFrom(x, y);
  for (const e of G.enemies) {
    if (e.dead || e.zone !== zone || ETYPES[e.t].fac !== 'sep' || ETYPES[e.t].boss) continue;
    if (e.st !== 2) { e.st = 2; e.alertT = 1; }
    if (!e.saw) { e.goal = f; e.searchT = 0; }
  }
}

function updateEnemies(dt) {
  const targets = enemyTargets();
  for (let i = G.enemies.length - 1; i >= 0; i--) {
    const e = G.enemies[i];
    if (e.dead) continue;
    const T = ETYPES[e.t];
    e.flash = Math.max(0, e.flash - dt);
    e.flashT = Math.max(0, e.flashT - dt);
    e.alertT = Math.max(0, e.alertT - dt);
    e.susT = Math.max(0, e.susT - dt);
    e.mark = Math.max(0, e.mark - dt);
    e.dodgeCd = Math.max(0, e.dodgeCd - dt);
    if (T.boss) { updateBoss(e, dt, targets); continue; }
    if (T.fac === 'fauna') { updateFauna(e, dt, targets); continue; }
    if (e.leave) { if (leaveStep(e, dt)) G.enemies.splice(i, 1); continue; }
    if (e.stun > 0) {
      e.stun -= dt;
      e.a += dt * 2.5;       // оглушён — шатается
      e.burst = 0;
      continue;
    }
    if (e.kick > 0) { e.kick -= dt; moveCircle(e, e.kvx * dt, e.kvy * dt, T.r); }

    let target = null, td = 1e9;
    for (const t of targets) {
      const d = Math.hypot(t.x - e.x, t.y - e.y);
      if (d >= td || d > 620) continue;
      if (enemySees(e, t, d)) { target = t; td = d; }
    }
    if (target) engage(e, T, target, td, dt);
    else if (T.comm && e.callT > 0) commCall(e, T, dt);
    else idle(e, T, dt);

    // долгая тревога в районе города поднимает весь район
    if (e.st === 2 && (e.zone === 'out' || e.zone === 'cen') && G.m) {
      const raised = e.zone === 'out' ? G.m.alarm : G.m.cenAlarm;
      if (!raised) {
        e.alarmT += dt;
        if (e.alarmT >= ALARM_DELAY) raiseAlarm(e.zone, e.x, e.y);
      }
    } else e.alarmT = Math.max(0, e.alarmT - dt * 0.5);
  }
  separate(G.enemies, (e) => ETYPES[e.t].r);
}

function engage(e, T, t, d, dt) {
  if (e.st !== 2) { e.st = 2; e.alertT = 1; e.react = -0.25; }
  e.saw = true; e.lastX = t.x; e.lastY = t.y;
  e.goal = null; e.searchT = 0;
  e.react += dt;
  const ta = Math.atan2(t.y - e.y, t.x - e.x);

  if (T.comm) {
    // связист не воюет: убегает и вызывает подкрепление
    e.callT += dt;
    const away = ta + Math.PI + Math.sin(G.time * 2 + e.id) * 0.6;
    e.a = turnTo(e.a, away, 6 * dt);
    moveDir(e, away, T.chase, dt);
    if (e.callT >= COMM_CALL_TIME) { raiseAlarm(e.zone, e.x, e.y); e.callT = 0; }
    return;
  }

  if (!e.leadK || Math.random() < dt * 2) e.leadK = rand(0.75, 1.0);
  const aim = leadAngle(e, t, T.bolt, T.lead * e.leadK);
  e.a = turnTo(e.a, aim, (T.kind === 'bug' ? 8 : 6) * dt);

  // движение: держим дистанцию, жуки и B2 ходят боком
  const pref = T.kind === 'bug' ? [170, 300] : T.armor ? [130, 250] : [220, 380];
  let mx = 0, my = 0;
  if (d > pref[1]) { mx += Math.cos(ta); my += Math.sin(ta); } else if (d < pref[0]) { mx -= Math.cos(ta); my -= Math.sin(ta); }
  if (T.kind === 'bug' || T.strafe) {
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = rand(0.7, 1.7); }
    mx += Math.cos(ta + Math.PI / 2) * e.strafe * 0.8; my += Math.sin(ta + Math.PI / 2) * e.strafe * 0.8;
  }
  const ml = Math.hypot(mx, my);
  if (ml > 0.01) {
    const spd = d > pref[1] ? T.chase : T.speed;
    if (moveCircle(e, (mx / ml) * spd * dt, (my / ml) * spd * dt, T.r)) e.strafe = -e.strafe;
  }

  // жуки уворачиваются от летящих в них выстрелов
  if (T.dodge && e.dodgeCd <= 0) {
    const b = incomingBolt(e, 'p') || incomingBolt(e, 'a');
    if (b) {
      e.dodgeCd = 0.9;
      if (Math.random() < T.dodge) {
        const sp = Math.hypot(b.vx, b.vy), side = Math.random() < 0.5 ? 1 : -1;
        e.kick = 0.18; e.kvx = (-b.vy / sp) * side * 400; e.kvy = (b.vx / sp) * side * 400;
      }
    }
  }

  if (e.burst > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      shootBolt(e, aim, T.spread, T.bolt, 'e');
      makeNoise(e.x, e.y, NOISE.enemyShot, true);
      e.burst--; e.burstT = T.burstGap;
    }
  } else {
    e.cd -= dt;
    if (e.react > 0.35 && e.cd <= 0 && Math.abs(angDiff(aim, e.a)) < 0.15) {
      e.burst = T.burst; e.burstT = 0;
      e.cd = rand(T.fire[0], T.fire[1]);
    }
  }
}

// Связист, заметив отряд, вызывает подкрепление и на бегу, даже потеряв героя из виду
function commCall(e, T, dt) {
  e.callT += dt;
  const away = Math.atan2(e.y - e.lastY, e.x - e.lastX) + Math.sin(G.time * 2 + e.id) * 0.6;
  e.a = turnTo(e.a, away, 6 * dt);
  moveDir(e, away, T.chase, dt);
  if (e.callT >= COMM_CALL_TIME) { raiseAlarm(e.zone, e.x, e.y); e.callT = 0; }
}

function idle(e, T, dt) {
  e.react = Math.min(e.react, 0);
  e.burst = 0;
  if (e.saw) { e.saw = false; e.goal = bfsFrom(e.lastX, e.lastY, 60); }
  if (e.goal) {
    const step = fieldStep(e, e.goal, T.r);
    if (step === null) {
      e.goal = null;
      e.searchT = e.st === 2 ? 5 : 3;
      e.lookT = 0;
    } else {
      e.a = turnTo(e.a, step, 6 * dt);
      moveDir(e, step, e.st === 2 ? T.chase : T.speed * 1.2, dt);
    }
  } else if (e.searchT > 0) {
    e.searchT -= dt;
    e.lookT -= dt;
    if (e.lookT <= 0) { e.look = e.a + rand(-2.4, 2.4); e.lookT = rand(0.6, 1.2); }
    e.a = turnTo(e.a, e.look, 4 * dt);
    if (e.searchT <= 0) {
      // после тревоги в районе враги остаются настороже
      const raised = G.m && ((e.zone === 'out' && G.m.alarm) || (e.zone === 'cen' && G.m.cenAlarm));
      e.st = raised ? 1 : 0;
      e.callT = 0;
    }
  } else if (e.patrol) {
    const pt = e.patrol[e.pi];
    if (Math.hypot(pt.x - e.x, pt.y - e.y) < 18) { e.pi = (e.pi + 1) % e.patrol.length; return; }
    const step = fieldStep(e, fieldTo(pt.x, pt.y), T.r);
    if (step === null) { e.pi = (e.pi + 1) % e.patrol.length; return; }
    e.a = turnTo(e.a, step, 4 * dt);
    moveDir(e, step, T.speed * 0.8, dt);
  } else {
    e.lookT -= dt;
    if (e.lookT <= 0) { e.look = e.a + rand(-1.6, 1.6); e.lookT = rand(2, 4); }
    e.a = turnTo(e.a, e.look, 1.2 * dt);
  }
}

// Отвлечение наёмниками: враг окраин уходит к воротам центра и появляется внутри
function leaveStep(e, dt) {
  const T = ETYPES[e.t];
  const out = markerPos('innerGateOut');
  if (!out) return true;
  if (Math.hypot(out.x - e.x, out.y - e.y) < 40) {
    const inn = markerPos('innerGateIn');
    const s = freeSpotNear(inn.x + rand(0, 120), inn.y + rand(-80, 80), T.r);
    const n = makeEnemy(e.t, s.x, s.y);
    n.zone = 'cen'; n.st = 2; n.alertT = 1;
    G.enemies.push(n);
    return true;
  }
  const step = fieldStep(e, fieldTo(out.x, out.y), T.r);
  if (step === null) return true;
  e.a = turnTo(e.a, step, 6 * dt);
  moveDir(e, step, T.chase, dt);
  return false;
}

// ---------- Фауна тоннелей: боится света, нападает только стаей при численном превосходстве ----------
function updateFauna(e, dt, targets) {
  const T = ETYPES[e.t];
  if (e.stun > 0) { e.stun -= dt; return; }
  if (!e.home) e.home = { x: e.x, y: e.y };
  e.fear = Math.max(0, e.fear - dt);
  e.cd = Math.max(0, e.cd - dt);
  const lamp = litByLamp(e.x, e.y);
  if (lamp) e.fear = 1.0;

  let target = null, td = 1e9;
  for (const t of targets) {
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d < td && d < 340 && (d < 90 || los(e.x, e.y, t.x, t.y))) { target = t; td = d; }
  }
  if (e.fear > 0) {
    // убегаем от света
    const src = lamp || target;
    const away = src ? Math.atan2(e.y - src.y, e.x - src.x) : e.a;
    e.a = turnTo(e.a, away, 8 * dt);
    if (moveDir(e, away + Math.sin(G.time * 5 + e.id) * 0.5, T.chase * 1.1, dt)) e.a += 1.5;
    e.wind = 0; e.st = 1;
    return;
  }
  if (!target) {
    e.st = 0;
    if (e.goal) {
      const step = fieldStep(e, e.goal, T.r);
      if (step === null) e.goal = null; else { e.a = turnTo(e.a, step, 5 * dt); moveDir(e, step, T.speed, dt); }
    } else {
      // ползаем вокруг гнезда
      e.lookT -= dt;
      if (e.lookT <= 0) { e.look = Math.atan2(e.home.y - e.y, e.home.x - e.x) + rand(-1.5, 1.5); e.lookT = rand(1, 2); }
      e.a = turnTo(e.a, e.look, 3 * dt);
      moveDir(e, e.a, T.speed * 0.4, dt);
    }
    return;
  }
  let pack = 0, prey = 0;
  for (const o of G.enemies) if (!o.dead && ETYPES[o.t].fac === 'fauna' && Math.hypot(o.x - e.x, o.y - e.y) < 260) pack++;
  for (const t of targets) if (Math.hypot(t.x - e.x, t.y - e.y) < 260) prey++;
  const ta = Math.atan2(target.y - e.y, target.x - e.x);
  e.a = turnTo(e.a, ta, 9 * dt);
  if (pack > prey) {
    e.st = 2;
    if (e.wind > 0) {
      e.wind -= dt;
      if (e.wind <= 0) {
        e.cd = 0.8;
        if (Math.hypot(target.x - e.x, target.y - e.y) < T.r + PR + 14) {
          emit(['bite', target.x, target.y]);
          if (target.idx !== undefined && G.players.includes(target)) damagePlayer(target, 1, e.x, e.y);
          else damageAlly(target, 1);
        }
      }
    } else if (td < T.r + PR + 8 && e.cd <= 0) e.wind = 0.25;
    else moveDir(e, ta + Math.sin(G.time * 6 + e.id) * 0.4, T.chase, dt);
  } else {
    // меньше нас — кружат в темноте на расстоянии
    e.st = 1; e.wind = 0;
    const want = 200;
    const ang = td < want - 30 ? ta + Math.PI : td > want + 40 ? ta : ta + Math.PI / 2 * (e.id % 2 ? 1 : -1);
    moveDir(e, ang, T.speed, dt);
  }
}

// ---------- Босс: экспериментальный супер-B2 ----------
function updateBoss(e, dt, targets) {
  const T = ETYPES[e.t];
  const m = G.m;
  if (m && m.boss !== 1) return;          // выключен или уничтожен
  e.punchCd = Math.max(0, (e.punchCd || 0) - dt);

  // цели в поле зрения
  let target = null, td = 1e9, flank = null, fd = 1e9;
  for (const t of targets) {
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d > 650 || !los(e.x, e.y, t.x, t.y)) continue;
    const behind = Math.abs(angDiff(Math.atan2(t.y - e.y, t.x - e.x), e.a)) > 1.75;
    if (behind && d < 380 && d < fd) { flank = t; fd = d; }
    if (d < td) { target = t; td = d; }
  }
  // старается не подставлять спину: разворачивается к тому, кто заходит сзади
  const face = flank || target;
  const rot = flank ? 3 : 2;
  const melee = e.bst !== 'gun';
  if (face) {
    const fa = melee ? Math.atan2(face.y - e.y, face.x - e.x) : leadAngle(e, face, T.bolt, 1);
    e.a = turnTo(e.a, fa, rot * dt);
  }

  if (e.bst === 'jam') {
    e.jamT -= dt;
    if (e.jamT <= 0) { e.bst = 'gun'; e.heat = 0; emit(['spark', e.x, e.y, '#ffb000']); say('СУПЕР-B2', 'ОРУЖИЕ… ОХЛАЖДЕНО. ВОЗОБНОВЛЯЮ ОГОНЬ.', 3); }
  }

  if (!melee) {
    // стрельба очередью без перерыва, пока цель видна (суммарно до 5 с — потом клинит)
    if (target) {
      e.spin = Math.min(1, e.spin + dt / 0.6);
      if (e.spin >= 1) {
        e.heat += dt;
        e.fireT -= dt;
        while (e.fireT <= 0) {
          e.fireT += 0.085;
          const aim = leadAngle(e, target, T.bolt, 1);
          if (Math.abs(angDiff(aim, e.a)) < 0.5) shootBolt(e, e.a, T.spread, T.bolt, 'e');
        }
        if (e.heat >= BOSS_HEAT_MAX) bossJam(e);
      }
    } else {
      e.spin = Math.max(0, e.spin - dt * 2);
      e.heat = Math.max(0, e.heat - dt * 0.5);     // не стреляет — оружие остывает
    }
    // держит дистанцию и смещается боком; от заходящего сзади — отходит
    if (target) {
      const ta = Math.atan2(target.y - e.y, target.x - e.x);
      let mx = 0, my = 0;
      if (td > 330) { mx += Math.cos(ta); my += Math.sin(ta); } else if (td < 200) { mx -= Math.cos(ta); my -= Math.sin(ta); }
      e.strafeT -= dt;
      if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = rand(1.2, 2.4); }
      mx += Math.cos(ta + Math.PI / 2) * e.strafe * 0.7; my += Math.sin(ta + Math.PI / 2) * e.strafe * 0.7;
      if (flank) { const fa = Math.atan2(flank.y - e.y, flank.x - e.x); mx -= Math.cos(fa) * 0.9; my -= Math.sin(fa) * 0.9; }
      const ml = Math.hypot(mx, my);
      if (ml > 0.01 && moveCircle(e, (mx / ml) * T.speed * dt, (my / ml) * T.speed * dt, T.r)) e.strafe = -e.strafe;
    }
  } else {
    // ближний бой: активно сближается и бьёт
    const tgt = flank || target;
    if (tgt) {
      const d = Math.hypot(tgt.x - e.x, tgt.y - e.y);
      const ta = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      if (e.wind > 0) {
        e.wind -= dt;
        if (e.wind <= 0) {
          e.punchCd = e.armless ? 0.9 : 1.1;
          emit(['punch', e.x + Math.cos(e.a) * 34, e.y + Math.sin(e.a) * 34]);
          for (const t of targets) {
            const dd = Math.hypot(t.x - e.x, t.y - e.y);
            if (dd > T.r + PR + 34) continue;
            if (Math.abs(angDiff(Math.atan2(t.y - e.y, t.x - e.x), e.a)) > 1.2) continue;
            if (G.players.includes(t)) damagePlayer(t, 2, e.x, e.y); else damageAlly(t, 3);
          }
        }
      } else if (d < T.r + PR + 20 && e.punchCd <= 0) e.wind = 0.4;
      else {
        const sp = T.chase * (e.armless ? 1.35 : 1.5);
        moveDir(e, ta + Math.sin(G.time * 3) * 0.25, sp, dt);
      }
    }
  }
}

function bossJam(e) {
  e.over++; e.heat = 0; e.spin = 0;
  if (e.over >= 3) {
    // третий перегрев: оружие взрывается вместе с правой рукой
    e.armless = true; e.bst = 'arm';
    emit(['arm', e.x + Math.cos(e.a + Math.PI / 2) * 22, e.y + Math.sin(e.a + Math.PI / 2) * 22, e.a + Math.PI / 2]);
    e.hp = Math.max(1, e.hp - 8);
    say('СУПЕР-B2', 'КРИТИЧЕСКОЕ ПОВРЕЖДЕНИЕ. ПЕРЕХОД В РЕЖИМ БЛИЖНЕГО БОЯ.', 4);
    return;
  }
  e.bst = 'jam'; e.jamT = BOSS_JAM_TIME;
  emit(['jam', e.x, e.y]);
  say('СУПЕР-B2', `ПЕРЕГРЕВ ОРУЖИЯ (${e.over}/3). РЕЖИМ БЛИЖНЕГО БОЯ.`, 3);
}

// ---------- Союзники: клоны и наёмники ----------
function allySees(a, e, d, range) {
  if (d > range) return false;
  const lit = !darkAt(e.x, e.y) || e.flashT > 0 || e.mark > 0 || litByLamp(e.x, e.y);
  if (!lit && d > 130) return false;
  return los(a.x, a.y, e.x, e.y);
}

function updateAllies(dt) {
  for (const a of G.allies) {
    if (a.dead) continue;
    const A = ATYPES[a.t];
    a.flash = Math.max(0, a.flash - dt);
    a.flashT = Math.max(0, a.flashT - dt);
    a.dodgeCd = Math.max(0, a.dodgeCd - dt);
    a.cd -= dt;
    if (a.kick > 0) { a.kick -= dt; moveCircle(a, a.kvx * dt, a.kvy * dt, A.r); }
    trackVelocity(a, dt);

    const range = a.mode === 'post' ? 320 : a.mode === 'hold' ? 430 : 520;
    let tgt = null, td = 1e9;
    for (const e of G.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d < td && allySees(a, e, d, range)) { tgt = e; td = d; }
    }
    if (tgt) {
      const aim = leadAngle(a, tgt, A.bolt, A.lead);
      a.a = turnTo(a.a, aim, 9 * dt);
      if (a.cd <= 0 && Math.abs(angDiff(aim, a.a)) < 0.1) {
        shootBolt(a, aim, A.spread, A.bolt, 'a');
        makeNoise(a.x, a.y, A.noise, true);
        a.cd = rand(A.cd[0], A.cd[1]);
      } else if (a.cd < 0) a.cd = 0;
    }
    // уклонение от выстрелов
    if (A.dodge && a.dodgeCd <= 0 && a.mode !== 'post') {
      const b = incomingBolt(a, 'e', 160);
      if (b) {
        a.dodgeCd = 0.7;
        const sp = Math.hypot(b.vx, b.vy), side = Math.random() < 0.5 ? 1 : -1;
        a.kick = 0.16; a.kvx = (-b.vy / sp) * side * 420; a.kvy = (b.vx / sp) * side * 420;
      }
    }
    if (a.mode === 'post') continue;

    let goal = null, speed = A.speed;
    if (tgt && a.mode !== 'hold') {
      // бой: держим дистанцию и активно ходим боком
      const ta = Math.atan2(tgt.y - a.y, tgt.x - a.x);
      let mx = 0, my = 0;
      if (td > 400) { mx += Math.cos(ta); my += Math.sin(ta); } else if (td < 240) { mx -= Math.cos(ta); my -= Math.sin(ta); }
      a.strafeT -= dt;
      if (a.strafeT <= 0) { a.strafe = -a.strafe; a.strafeT = rand(0.6, 1.4); }
      mx += Math.cos(ta + Math.PI / 2) * a.strafe; my += Math.sin(ta + Math.PI / 2) * a.strafe;
      const ml = Math.hypot(mx, my);
      if (ml > 0.01 && moveCircle(a, (mx / ml) * A.speed * 0.8 * dt, (my / ml) * A.speed * 0.8 * dt, A.r)) a.strafe = -a.strafe;
      continue;
    }
    if (a.mode === 'hold') {
      if (Math.hypot(a.home.x - a.x, a.home.y - a.y) > 30) goal = a.home;
    } else if (a.mode === 'assault' || a.mode === 'fight') {
      const zone = a.mode === 'assault' ? 'out' : 'cen';
      a.goalT = (a.goalT || 0) - dt;
      if (a.goalT <= 0 || !a.goalE || a.goalE.dead) {
        a.goalT = 1;
        let best = null, bd = 1e9;
        for (const e of G.enemies) {
          if (e.dead || e.zone !== zone || ETYPES[e.t].fac !== 'sep') continue;
          const d = Math.hypot(e.x - a.x, e.y - a.y);
          if (d < bd) { bd = d; best = e; }
        }
        a.goalE = best;
      }
      goal = a.goalE;
      if (!goal) {
        // своих врагов не осталось — идём за отрядом
        a.mode = 'follow';
      }
    } else if (a.mode === 'follow') {
      let lead = null, ld = 1e9;
      for (const p of G.players) {
        if (p.down) continue;
        const d = Math.hypot(p.x - a.x, p.y - a.y);
        if (d < ld) { ld = d; lead = p; }
      }
      if (lead && ld > 110) { goal = lead; speed = ld > 400 ? A.speed * 1.3 : A.speed; }
    }
    if (goal) {
      const step = fieldStep(a, fieldTo(goal.x, goal.y), A.r);
      if (step !== null) {
        if (!tgt) a.a = turnTo(a.a, step, 6 * dt);
        moveCircle(a, Math.cos(step) * speed * dt, Math.sin(step) * speed * dt, A.r);
      }
    }
  }
  separate(G.allies, (a) => ATYPES[a.t].r);
}

// Расталкиваем, чтобы не слипались
function separate(list, radius) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead) continue;
    const ra = radius(a);
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), rr = ra + radius(b);
      if (d > 0.01 && d < rr) {
        const push = (rr - d) / 2;
        moveCircle(a, (-dx / d) * push, (-dy / d) * push, ra);
        moveCircle(b, (dx / d) * push, (dy / d) * push, radius(b));
      }
    }
  }
}
