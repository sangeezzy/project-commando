'use strict';
// ---------- Главный цикл ----------

const PAD_HOLD = 1.5;          // сколько стоять на площадке, чтобы вылететь на задание

let last = performance.now();
function frame(now) {
  // тесты сами двигают симуляцию (в headless requestAnimationFrame срабатывает нерегулярно)
  if (window.__manualTick) { render(0); requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time += dt;
  if (G.role !== 'none' && map && G.state !== 'lobby') update(dt);
  updateEngines();
  Voice.update();
  render(dt);
  requestAnimationFrame(frame);
}

function update(dt) {
  const p = me();
  for (const q of G.players) tickPlayerTimers(q, dt);
  if (p) controlLocal(p, dt);
  if (G.brief) { G.brief.t += dt; if (G.brief.t > 12) G.brief = null; }

  if (isAuth()) {
    if (!G.brief) for (const q of G.players) if (q.bot && q !== p) controlBot(q, dt);
    updateAuthority(dt);
    if (G.role === 'host') {
      Net.sendT -= dt * 1000;
      if (Net.sendT <= 0) { if (Net.conns.size) sendSnapshot(); else G.fxOut = []; Net.sendT = SNAP_MS; }
    }
  } else {
    // гость: экстраполируем пули между снимками
    for (const b of G.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    G.bullets = G.bullets.filter((b) => !solidAt(b.x, b.y) || tileAt(Math.floor(b.x / TILE), Math.floor(b.y / TILE)) === T.LOW);
    G.loudT = Math.max(0, G.loudT - dt);
    Net.sendT -= dt * 1000;
    if (Net.sendT <= 0) { guestSendInput(); Net.sendT = INPUT_MS; }
  }
  syncRiders();

  // сглаживание сетевых позиций
  const k = Math.min(1, dt * 14);
  for (const q of G.players) {
    if (q.ride >= 0) continue;
    if (q.idx === G.myIdx || isAuth()) { q.rx = q.x; q.ry = q.y; }
    else { q.rx += (q.x - q.rx) * k; q.ry += (q.y - q.ry) * k; }
  }
  for (const list of [G.enemies, G.allies]) {
    for (const e of list) {
      if (isAuth()) { e.rx = e.x; e.ry = e.y; }
      else { e.rx += (e.x - e.rx) * k; e.ry += (e.y - e.ry) * k; }
    }
  }
  for (const s of G.speeders) {
    if (isAuth() || s.local) { s.rx = s.x; s.ry = s.y; }
    else { s.rx += (s.x - s.rx) * k; s.ry += (s.y - s.ry) * k; }
  }

  // кольца шума шагов — подсказка, насколько громко идёт герой
  for (const q of G.players) {
    const r = q.down || q.ride >= 0 || G.state !== 'play' ? 0 : q.mv === MV.SPRINT ? NOISE.sprint : q.mv === MV.WALK ? NOISE.walk : 0;
    if (!r) { q.ringT = 0; continue; }
    q.ringT -= dt;
    if (q.ringT <= 0) {
      addRing(q.x, q.y, r, charColor(q.ch));
      q.ringT = q.mv === MV.SPRINT ? 0.25 : 0.4;
      if (q.idx === G.myIdx) SFX.step(q.mv === MV.SPRINT ? 1 : 0.5);
    }
  }
  for (let i = G.rings.length - 1; i >= 0; i--) {
    G.rings[i].t += dt;
    if (G.rings[i].t >= 0.6) G.rings.splice(i, 1);
  }
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i];
    q.life -= dt;
    if (q.life <= 0) { G.parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt;
    const dr = Math.exp(-q.drag * dt);
    q.vx *= dr; q.vy *= dr;
    if (q.spin) { q.rot += q.spin * dt; q.spin *= dr; }
  }

  // камера: герой + смещение к курсору
  if (p) {
    const look = p.ride >= 0 ? 0.35 : CHARS[p.ch].weapon === 'sniper' ? 0.42 : 0.3;
    const tx = p.rx + (mouse.x - VW / 2) * look, ty = p.ry + (mouse.y - VH / 2) * look;
    const ck = Math.min(1, dt * 8);
    G.cam.x += (tx - G.cam.x) * ck; G.cam.y += (ty - G.cam.y) * ck;
  }
  G.shake = Math.max(0, G.shake - dt * 30);
  G.titleT = Math.max(0, G.titleT - dt);
  G.hurtFlash = Math.max(0, (G.hurtFlash || 0) - dt);
  G.whiteT = Math.max(0, (G.whiteT || 0) - dt);
  G.alarmFlash = Math.max(0, (G.alarmFlash || 0) - dt);
  if (G.hitmark) { G.hitmark.t -= dt; if (G.hitmark.t <= 0) G.hitmark = null; }
  if (G.dgFlash) { G.dgFlash.t -= dt; if (G.dgFlash.t <= 0) G.dgFlash = null; }
  if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }
  for (const s of G.subs) s.t -= dt;
  G.subs = G.subs.filter((s) => s.t > 0);
  if (isAuth() && G.fadeT > 0 && !(G.m && G.m.rideT > 0)) G.fadeT = Math.max(0, G.fadeT - dt * 2);
}

// Хост/соло: вся логика мира
function updateAuthority(dt) {
  G.loudT = Math.max(0, G.loudT - dt);
  if (G.state !== 'play') { G.overT += dt; return; }
  if (G.brief) return;      // мир стоит, пока идёт брифинг

  // шаги шумят: обычный шаг — умеренно, бег и перекат — громко, крадучись — тихо
  for (const p of G.players) {
    const r = p.down || p.ride >= 0 ? 0 : p.mv === MV.SPRINT ? NOISE.sprint : p.mv === MV.WALK ? NOISE.walk : 0;
    if (!r) { p.stepT = 0; continue; }
    p.stepT -= dt;
    if (p.stepT <= 0) { makeNoise(p.x, p.y, r, false); p.stepT = p.mv === MV.SPRINT ? 0.25 : 0.4; }
  }
  updateSpeedersAuth(dt);
  for (const p of G.players) if (!p.net) trackVelocity(p, dt);

  updateEnemies(dt);
  updateAllies(dt);
  updateBullets(dt);
  updateNades(dt);
  updateObjects(dt);
  updatePlayersHealth(dt);
  if (G.state !== 'play') return;
  if (map.hub) updatePads(dt);
  else updateMission(dt);
}

// Спидеры: двигатель шумит, на скорости можно сбить врага
function updateSpeedersAuth(dt) {
  for (const s of G.speeders) {
    const sp = Math.hypot(s.vx, s.vy);
    const occupied = s.seats.some((q) => q >= 0);
    if (!occupied) {
      // брошенный спидер плавно останавливается
      s.vx *= Math.exp(-3 * dt); s.vy *= Math.exp(-3 * dt);
      if (sp > 5) moveCircle(s, s.vx * dt, s.vy * dt, 15);
      continue;
    }
    // гость за рулём сам двигает спидер; если водителя нет — тормозим
    const driver = s.seats[0] >= 0 ? pById(s.seats[0]) : null;
    if (!driver) { s.vx *= Math.exp(-3 * dt); s.vy *= Math.exp(-3 * dt); }
    s.noiseT = (s.noiseT || 0) - dt;
    if (sp > 60 && s.noiseT <= 0) { s.noiseT = 0.5; makeNoise(s.x, s.y, NOISE.speeder, false); }
    if (sp > 220) {
      for (const e of G.enemies) {
        if (e.dead || ETYPES[e.t].boss || ETYPES[e.t].armor) continue;
        if (Math.hypot(e.x - s.x, e.y - s.y) < ETYPES[e.t].r + 16) damageEnemy(e, 3, driver ? driver.idx : -1, s.x - s.vx * 0.1, s.y - s.vy * 0.1);
      }
    }
  }
}

function updatePlayersHealth(dt) {
  for (const p of G.players) {
    if (p.down) {
      const helper = G.players.find((q) => !q.down && q !== p && q.ride < 0 && dist(q, p) < 42);
      if (helper) {
        p.revive += dt;
        if (p.revive >= REVIVE_TIME) { p.down = false; p.revive = 0; p.hp = REVIVE_HP; p.hurtT = 0; emit(['rev', p.x, p.y, p.idx]); }
      } else p.revive = Math.max(0, p.revive - dt * 0.5);
      continue;
    }
    p.hurtT += dt;
    if (p.hurtT > REGEN_DELAY && p.hp < PLAYER_HP) {
      p.regenT += dt;
      if (p.regenT >= REGEN_STEP) { p.hp++; p.regenT = 0; }
    } else p.regenT = 0;
  }
  if (G.players.length && G.players.every((p) => p.down)) { G.state = 'over'; G.overT = 0; }
}

// База: стоим на площадке задания PAD_HOLD секунд — вылет
function updatePads(dt) {
  const pad = G.objs.find((o) => o.k === 'pad');
  if (!pad) return;
  const on = G.players.some((p) => !p.down && Math.abs(p.x - pad.x) < 30 && Math.abs(p.y - pad.y) < 30);
  if (!on) { G.pad = null; return; }
  G.pad = G.pad || { t: 0 };
  G.pad.t += dt;
  if (G.pad.t >= PAD_HOLD) { G.pad = null; startMission(pad.lv); }
}

function resize() {
  if (!mouse.x && !mouse.y) { mouse.x = innerWidth / 2; mouse.y = innerHeight / 2; }
  VW = canvas.width = innerWidth;
  VH = canvas.height = innerHeight;
}
addEventListener('resize', resize);
resize();
G.progress = loadProgress();
requestAnimationFrame(frame);

// Для автотестов: ?autotest=1 — одиночная игра без меню.
// ch — персонаж игрока, lv/st/cp — сразу на этап, auto=1 — героем управляет ИИ бота, nobrief=1 — без брифинга
(function autotest() {
  const q = new URLSearchParams(location.search);
  if (!q.get('autotest')) return;
  startSolo();
  pickChar(0, +(q.get('ch') || 0));
  startGameFromLobby();
  G.autopilot = q.get('auto') === '1';
  const lv = +(q.get('lv') || 0);
  if (lv) {
    G.m = freshFlags();
    const st = +(q.get('st') || 1);
    startStage(lv, st, q.get('cp') || 'start');
    if (q.get('nobrief') !== '1') G.brief = { lv, t: 0 };
  }
})();
