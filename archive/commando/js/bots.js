'use strict';
// ---------- Боты-напарники (только хост) ----------
// Бот занимает свободное место в отряде. Если рядом есть живой игрок-человек — идёт за ним
// и повторяет его режим движения (крадётся вместе с ним). Если людей нет — сам выполняет цели миссии.

// Ведущий для бота: человек своего отряда (в пещерах) или ближайший человек; null — бот сам по себе
function botLeader(p) {
  if (G.autopilot && p.idx === G.myIdx) return null;
  const hs = G.players.filter((q) => !q.bot && !q.down && q !== p);
  if (G.stage === 1 && !(G.m && G.m.rvAll)) {
    const mate = hs.find((q) => CHARS[q.ch].squad === CHARS[p.ch].squad);
    return mate || null;
  }
  if (hs.length) return hs.sort((a, b) => dist(a, p) - dist(b, p))[0];
  // людей нет: младший живой бот командует, остальные идут за ним
  const cmd = G.players.filter((q) => !q.down).sort((a, b) => a.idx - b.idx)[0];
  return cmd && cmd !== p ? cmd : null;
}

// Враги, которых бот видит
function botFoes(p) {
  const res = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d > 560) continue;
    const lit = !darkAt(e.x, e.y) || e.flashT > 0 || e.mark > 0 || d < AMBIENT_R + 30 ||
      (p.lamp && d < FLASH_RANGE && Math.abs(angDiff(Math.atan2(e.y - p.y, e.x - p.x), p.a)) < FLASH_HALF + 0.1);
    if (!lit) continue;
    if (!los(p.x, p.y, e.x, e.y)) continue;
    res.push({ e, d });
  }
  return res.sort((a, b) => a.d - b.d);
}

function botMove(p, ang, mode, dt) {
  const mul = mode === MV.SPRINT ? SPRINT_MUL : mode === MV.SLOW ? SLOW_MUL : 1;
  const sp = CHARS[p.ch].speed * mul;
  const ox = p.x, oy = p.y;
  moveCircle(p, Math.cos(ang) * sp * dt, Math.sin(ang) * sp * dt, PR);
  p.mv = mode;
  // застрял — немного сдвигаемся вбок
  const B = p.bot2;
  if (Math.hypot(p.x - ox, p.y - oy) < sp * dt * 0.2) {
    B.stuck = (B.stuck || 0) + dt;
    if (B.stuck > 0.6) { moveCircle(p, Math.cos(ang + Math.PI / 2) * 40 * dt * (p.idx % 2 ? 1 : -1), Math.sin(ang + Math.PI / 2) * 40 * dt, PR); }
  } else B.stuck = 0;
}

// Идти к точке по BFS (сквозь завалы планируем, чтобы прийти к ним)
function botGoTo(p, x, y, mode, dt, near = 20) {
  const d = Math.hypot(x - p.x, y - p.y);
  if (d < near) { p.mv = MV.IDLE; return true; }
  let ang;
  if (d < 120 && clearPath(p.x, p.y, x, y)) ang = Math.atan2(y - p.y, x - p.x);
  else {
    ang = fieldStep(p, fieldTo(x, y, true), PR);
    if (ang === null) ang = Math.atan2(y - p.y, x - p.x);
  }
  if (!p.bot2.aiming) p.a = turnTo(p.a, ang, 8 * dt);
  botMove(p, ang, mode, dt);
  return false;
}

function controlBot(p, dt) {
  const B = p.bot2;
  p.useId = 0; p.rad = false; B.aiming = false;
  if (p.down || G.state !== 'play') { p.mv = MV.IDLE; return; }
  p.lamp = true;
  const lead = botLeader(p);
  const foes = botFoes(p);

  if (p.ride >= 0) { botRide(p, dt, lead, foes); return; }
  if (botDebris(p, dt)) return;
  if (botScan(p, dt, lead)) return;

  const fight = botFight(p, dt, foes, lead);

  if (botRevive(p, dt, foes)) return;
  if (botMount(p, dt, lead)) return;

  // движение
  const mode = lead && lead.mv === MV.SLOW ? MV.SLOW : MV.WALK;
  if (lead) {
    // держимся сзади-сбоку от ведущего
    const side = (p.idx % 2 ? 1 : -1) * (p.idx > 1 ? 1.5 : 0.8);
    const back = lead.a + Math.PI + side * 0.5;
    const gx = lead.x + Math.cos(back) * 58, gy = lead.y + Math.sin(back) * 58;
    const d = Math.hypot(lead.x - p.x, lead.y - p.y);
    if (fight && d < 260) return;
    const m2 = d > 320 && !foes.length ? MV.SPRINT : (lead.mv === MV.IDLE && d < 90 ? MV.IDLE : mode);
    if (m2 === MV.IDLE) { p.mv = MV.IDLE; if (!B.aiming) p.a = turnTo(p.a, lead.a, 4 * dt); return; }
    botGoTo(p, gx, gy, m2, dt, 26);
    return;
  }
  if (fight) return;
  const goal = botGoal(p);
  if (goal) botGoTo(p, goal.x, goal.y, MV.WALK, dt, goal.near || 24);
  else p.mv = MV.IDLE;
}

// Куда идти боту без ведущего (по целям миссии)
function botGoal(p) {
  const m = G.m;
  if (map.hub) {
    const pad = G.objs.find((o) => o.k === 'pad');
    return pad && { x: pad.x, y: pad.y, near: 8 };
  }
  if (!m) return null;
  if (G.stage === 1) {
    if (m.rvAll) return null;
    const o = objectives(p);
    return o.target;
  }
  if (!m.met) return markerPos('cloneCamp');
  if (!m.ordered && radioAt(p.x, p.y)) act(p, { k: 'cmd' });
  const zone = !m.outCleared ? 'out' : !m.cenCleared ? 'cen' : null;
  if (zone) {
    let best = null, bd = 1e9;
    for (const e of G.enemies) {
      if (e.dead || e.zone !== zone || ETYPES[e.t].fac !== 'sep') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best && { x: best.x, y: best.y, near: 120 };
  }
  const boss = G.enemies.find((e) => ETYPES[e.t].boss && !e.dead);
  if (boss && m.boss === 1) return bossFlankPos(p, boss);
  return markerPos('square');
}

// Позиция у спины босса (у каждого бота своя)
function bossFlankPos(p, b) {
  const off = [-0.55, 0.55, -1.0, 1.0][p.idx % 4];
  const a = b.a + Math.PI + off;
  const s = freeSpotNear(b.x + Math.cos(a) * 180, b.y + Math.sin(a) * 180);
  return { x: s.x, y: s.y, near: 30 };
}

// Бой: стреляем по видимым врагам (скрытно — только если враг уже поднял тревогу или отряд шумит)
function botFight(p, dt, foes, lead) {
  const B = p.bot2;
  const auto = !lead || lead.bot || (G.autopilot && lead.idx === G.myIdx);
  let pick = null;
  for (const f of foes) {
    const T = ETYPES[f.e.t];
    const engage = f.e.st === 2 || T.fac === 'fauna' || G.loudT > 0 || auto || f.d < 70;
    if (!engage) continue;
    if (T.boss) {
      // по боссу стреляем только сзади
      const behind = Math.abs(angDiff(Math.atan2(p.y - f.e.y, p.x - f.e.x), f.e.a)) > 1.85;
      if (!behind) continue;
    }
    pick = f; break;
  }
  const boss = G.enemies.find((e) => !e.dead && ETYPES[e.t].boss);
  if (boss && G.m && G.m.boss === 1 && !pick) {
    // заходим за спину
    const fp = bossFlankPos(p, boss);
    botGoTo(p, fp.x, fp.y, MV.SPRINT, dt, 30);
    return true;
  }
  if (!pick) return false;
  const e = pick.e, W = weaponOf(p);
  B.aiming = true;
  if (!B.err || Math.random() < dt * 2) B.err = rand(-0.05, 0.05);
  const aim = leadAngle(p, e, W.speed, 0.8) + B.err;
  p.a = turnTo(p.a, aim, 10 * dt);
  if (p.atkCd <= 0 && Math.abs(angDiff(aim, p.a)) < 0.09) {
    p.atkCd = W.cd;
    playerFire(p);
  }
  // способности
  if (p.spCd <= 0 && Math.random() < dt * 0.6) {
    const sp = CHARS[p.ch].special;
    const cluster = G.enemies.filter((q) => !q.dead && Math.hypot(q.x - e.x, q.y - e.y) < 140).length;
    if ((sp === 'nade' || sp === 'flash') && pick.d > 130 && pick.d < 280 && cluster >= 2 && !ETYPES[e.t].boss) {
      p.spCd = SPECIALS[sp].cd; playerSpecial(p, e.x, e.y);
    } else if (sp === 'mark' && e.mark <= 0) { p.spCd = SPECIALS[sp].cd; playerSpecial(p, e.x, e.y); }
  }
  // держим дистанцию и смещаемся боком
  const pref = W.n > 1 ? [60, 150] : W.pierce ? [220, 480] : [150, 380];
  const ta = Math.atan2(e.y - p.y, e.x - p.x);
  let mx = 0, my = 0;
  if (pick.d > pref[1]) { mx += Math.cos(ta); my += Math.sin(ta); } else if (pick.d < pref[0]) { mx -= Math.cos(ta); my -= Math.sin(ta); }
  B.strT = (B.strT || 0) - dt;
  if (B.strT <= 0) { B.str = Math.random() < 0.5 ? 1 : -1; B.strT = rand(0.6, 1.4); }
  mx += Math.cos(ta + Math.PI / 2) * B.str * 0.6; my += Math.sin(ta + Math.PI / 2) * B.str * 0.6;
  if (Math.hypot(mx, my) > 0.1) botMove(p, Math.atan2(my, mx), MV.WALK, dt);
  else p.mv = MV.IDLE;
  // увернуться от летящего заряда
  if (p.dashCd <= 0 && Math.random() < 0.5) {
    const b = incomingBolt(p, 'e', 110);
    if (b) {
      const s = Math.hypot(b.vx, b.vy), side = Math.random() < 0.5 ? 1 : -1;
      p.dvx = (-b.vy / s) * side * 620; p.dvy = (b.vx / s) * side * 620;
      p.dash = 0.16; p.dashCd = 1.6;
    }
  }
  if (p.dash > 0) moveCircle(p, p.dvx * dt, p.dvy * dt, PR);
  return true;
}

// Мини-игра завала: бот берётся, когда за завал взялся напарник (или он сам ведущий), и жмёт в зелёной зоне
function botDebris(p, dt) {
  const B = p.bot2;
  // за завал уже взялся напарник — подходим и издалека
  const o = G.objs.find((q) => q.k === 'debris' && !q.done &&
    Math.hypot(q.x - p.x, q.y - p.y) < (q.eng.some((i) => i !== p.idx) ? 360 : 150));
  if (!o) return false;
  const lead = botLeader(p);
  const someone = o.eng.some((i) => i !== p.idx);
  if (!o.eng.includes(p.idx)) {
    if (!someone && lead) return false;
    if (Math.hypot(o.x - p.x, o.y - p.y) > 118) { botGoTo(p, o.x, o.y, MV.WALK, dt, 100); return true; }
    debrisPress(o, p, 0);
    return true;
  }
  p.mv = MV.IDLE;
  p.a = turnTo(p.a, Math.atan2(o.y - p.y, o.x - p.x), 6 * dt);
  if (o.eng.length < 2) return true;
  const ph = debrisPhase(o);
  if (ph < (B.lastPh || 0) || o.prog !== B.lastProg) { B.dgDone = false; B.dgAt = rand(0.62, 0.8); B.dgMiss = Math.random() < 0.12; }
  B.lastPh = ph; B.lastProg = o.prog;
  if (!B.dgDone && !o.hits.includes(p.idx) && ph >= (B.dgAt || 0.7)) {
    B.dgDone = true;
    debrisPress(o, p, B.dgMiss ? 0.2 : ph);
  }
  return true;
}

// Сканер тоннелей (бот-командир сам настраивает, если идёт в обход — сейчас только по просьбе теста)
function botScan(p, dt, lead) {
  return false;
}

// Поднять павшего напарника, если рядом нет врагов
function botRevive(p, dt, foes) {
  if (foes.some((f) => f.d < 300 && (f.e.st === 2 || ETYPES[f.e.t].fac === 'fauna'))) return false;
  let best = null, bd = 700;
  for (const q of G.players) {
    if (!q.down || q === p) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bd) { bd = d; best = q; }
  }
  if (!best) return false;
  if (bd > 26) botGoTo(p, best.x, best.y, MV.SPRINT, dt, 24);
  else p.mv = MV.IDLE;
  return true;
}

// Этап 1: все у костра — садимся на спидеры
function botMount(p, dt, lead) {
  if (G.stage !== 1 || !G.m || !G.m.rvAll || p.ride >= 0) return false;
  const mate = G.players.find((q) => !q.bot && q !== p && CHARS[q.ch].squad === CHARS[p.ch].squad && !q.down);
  let s = mate && mate.ride >= 0 ? G.speeders.find((q) => q.id === mate.ride) : null;
  if (s && !s.seats.includes(-1)) s = null;
  if (!s) {
    // ждём, пока напарник-человек сам сядет за руль
    if (mate && mate.ride < 0) return false;
    const pref = G.speeders[CHARS[p.ch].squad];
    s = pref && pref.seats.includes(-1) ? pref : G.speeders.find((q) => q.seats.includes(-1));
  }
  if (!s) return false;
  if (Math.hypot(s.x - p.x, s.y - p.y) < 44) toggleRide(p);
  else botGoTo(p, s.x, s.y, MV.WALK, dt, 30);
  return true;
}

// Бот на спидере: за рулём ведёт к цели, пассажир отстреливается
function botRide(p, dt, lead, foes) {
  const s = G.speeders.find((q) => q.id === p.ride);
  if (!s) { p.ride = -1; return; }
  if (G.stage === 1) { botFightFromSeat(p, dt, foes); if (s.seats[0] === p.idx) driveSpeeder(s, 0, 0, dt); return; }
  const m = G.m;
  // куда едем: за ведущим-человеком или к лагерю клонов
  let tgt = null;
  if (lead && !lead.bot) tgt = lead;
  else if (m && !m.met) tgt = markerPos('cloneCamp');
  // сходим: ведущий спешился рядом или приехали в лагерь
  const off = lead && !lead.bot ? lead.ride < 0 && dist(lead, p) < 260 : m && m.met && tgt === null;
  const camp = markerPos('cloneCamp');
  if (off || (!lead || lead.bot) && camp && Math.hypot(camp.x - p.x, camp.y - p.y) < 190) {
    dismount(p);
    return;
  }
  if (s.seats[0] === p.idx) {
    if (tgt && Math.hypot(tgt.x - s.x, tgt.y - s.y) > 110) {
      const ang = fieldStep(s, fieldTo(tgt.x, tgt.y), 15);
      const a = ang === null ? Math.atan2(tgt.y - s.y, tgt.x - s.x) : ang;
      const d = Math.hypot(tgt.x - s.x, tgt.y - s.y);
      driveSpeeder(s, Math.cos(a), Math.sin(a), dt, d < 300 ? 160 : 300);
    } else driveSpeeder(s, 0, 0, dt);
  }
  botFightFromSeat(p, dt, foes);
}

function botFightFromSeat(p, dt, foes) {
  const f = foes.find((q) => q.e.st === 2 || G.loudT > 0);
  if (!f) return;
  const W = weaponOf(p);
  const aim = leadAngle(p, f.e, W.speed, 0.7);
  p.a = turnTo(p.a, aim, 10 * dt);
  if (p.atkCd <= 0 && Math.abs(angDiff(aim, p.a)) < 0.1) { p.atkCd = W.cd; playerFire(p); }
}
