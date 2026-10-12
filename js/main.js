'use strict';
// ---------- Главный цикл ----------

let last = performance.now();
function frame(now) {
  // тесты и скриншоты сами двигают симуляцию и сами рисуют кадр (фоновая отрисовка со светом в headless слишком дорогая)
  if (window.__manualTick) { requestAnimationFrame(frame); return; }
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  G.time += dt;
  if (map && G.state !== 'menu' && G.state !== 'lobby') update(dt);
  render(dt);
  requestAnimationFrame(frame);
}

function update(dt) {
  G.stateT += dt;
  // Enter — заново: у хоста и в одиночке сразу, гость просит хоста (после гибели отряда или победы)
  if (pressed.Enter) {
    if (isAuth()) restartRange();
    else if (G.state !== 'play') send({ t: 'restart' });
  }
  const p = me();
  if (p && G.state === 'play') controlLocal(p, dt);
  else clearPressed();
  if (isAuth()) updateWorld(dt);
  else guestWorld(dt);
  netTick(dt);

  // камера: свой боец (погиб — тот, за кем наблюдаем) + смещение к курсору (с прицелом — дальше)
  const v = viewer();
  if (v) {
    const look = v === p ? 0.25 + (p.ads || 0) * 0.2 : 0;
    const tx = (v.lx ?? v.x) + ((mouse.x - VW / 2) * look) / G.zoom, ty = (v.ly ?? v.y) + ((mouse.y - VH / 2) * look) / G.zoom;
    const ck = Math.min(1, dt * 8);
    G.cam.x += (tx - G.cam.x) * ck; G.cam.y += (ty - G.cam.y) * ck;
  }
}

// Чьими глазами смотрим: свой боец, а если погиб — живой товарищ (сначала люди, потом боты)
function viewer() {
  const p = me();
  if (p && !p.dead) return p;
  return G.players.find((q) => !q.dead && !q.ai) || G.players.find((q) => !q.dead) || p;
}

function restartRange() {
  startRange(G.lastSquad, G.lastBots);
  if (G.role === 'host') broadcast({ t: 'start' });
}

// Мир (хост и одиночка): оружие, ИИ, пули, двери, частицы. Отдельно от ввода — тесты гоняют только его.
function updateWorld(dt) {
  for (const p of G.players) {
    if (!p.dead) {
      updateGun(p, dt);
      if (!p.ai) {
        updateAct(p, dt);
        if (p.net) applyRemoteFire(p);       // курок гостя (ввод пришёл по сети)
      }
      updateLean(p, dt);
    }
    if (!p.net) trackSpeed(p, dt);
    p.supp = Math.max(0, p.supp - dt * 0.6); p.hurtT += dt;
  }
  if (G.state === 'play') { updateAI(dt); stepNoises(dt); updateDowned(dt); }
  for (const e of G.enemies) trackSpeed(e, dt);
  for (const o of allPeople()) if (!o.dead || o.side === 'p') updateAnim(o, dt);
  updateBullets(dt);
  updateDoors(dt);
  updateKeys();
  if (G.state === 'play') {
    // проигрыш: погибли все люди (раненые ещё живы — истекают кровью, их могут поднять)
    const humans = G.players.filter((q) => !q.ai);
    if (humans.length && humans.every((q) => q.dead)) { G.state = 'dead'; G.stateT = 0; }
    else if (G.enemies.length && G.enemies.every((e) => e.dead)) { G.state = 'win'; G.stateT = 0; }
  }
  updateLocalFx(dt);
}

// Гость: мир считает хост; здесь — свой боец, сглаживание чужих, анимация и эффекты
function guestWorld(dt) {
  const p = me();
  if (p && !p.dead) { updateLean(p, dt); trackSpeed(p, dt); }
  const k = Math.min(1, dt * 12);
  for (const o of allPeople()) {
    if (o === p || o.nx === undefined) continue;
    o.x += (o.nx - o.x) * k; o.y += (o.ny - o.y) * k;
    o.lx = o.x + (o.lxOff || 0); o.ly = o.y + (o.lyOff || 0);
  }
  for (const o of allPeople()) updateAnim(o, dt);
  updateDoors(dt);
  updateLocalFx(dt);
}

// Эффекты и интерфейс своего экрана: частицы, вспышки, привыкание глаз, подсказки
function updateLocalFx(dt) {
  const p = me();
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const q = G.parts[i];
    q.life -= dt;
    if (q.life <= 0) {
      // гильза упала и осталась лежать
      if (q.casing) {
        addDecal({ x: q.x, y: q.y, casing: true, rot: q.rot });
        if (p && Math.hypot(q.x - p.x, q.y - p.y) < M(4)) SFX.casing();
      }
      G.parts.splice(i, 1);
      continue;
    }
    q.x += q.vx * dt; q.y += q.vy * dt;
    const dr = Math.exp(-q.drag * dt);
    q.vx *= dr; q.vy *= dr;
    if (q.spin) { q.rot += q.spin * dt; q.spin *= dr; }
  }
  // раненые оставляют кровавый след
  for (const o of G.players) {
    if (!o.down || o.dead) { o.trail = null; continue; }
    if (!o.trail || Math.hypot(o.x - o.trail.x, o.y - o.trail.y) > 10) {
      o.trail = { x: o.x, y: o.y };
      addDecal({ x: o.x + rand(-3, 3), y: o.y + rand(-3, 3), r: rand(2.5, 4.5), c: 'rgba(110,10,10,0.5)' });
    }
  }
  if (G.muzzle) { for (const m of G.muzzle) m.t -= dt; G.muzzle = G.muzzle.filter((m) => m.t > 0); }
  const v = viewer();
  if (v && !v.dead) updateExposure(v, dt);
  if (p && !isAuth()) p.hurtT = (p.hurtT ?? 9) + dt;
  for (const h of G.hurt) h.t -= dt;
  G.hurt = G.hurt.filter((h) => h.t > 0);
  G.shake = Math.max(0, G.shake - dt * 25);
  if (G.hitmark) { G.hitmark.t -= dt; if (G.hitmark.t <= 0) G.hitmark = null; }
  if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }
  if (G.barks) { for (const b of G.barks) b.t -= dt; G.barks = G.barks.filter((b) => b.t > 0); }
}

function resize() {
  if (!mouse.x && !mouse.y) { mouse.x = innerWidth / 2; mouse.y = innerHeight / 2 - 120; }
  VW = canvas.width = innerWidth;
  VH = canvas.height = innerHeight;
  G.zoom = clamp(VH / M(VIEW_M), 0.8, 2.5);
}
addEventListener('resize', resize);
resize();

requestAnimationFrame(frame);

// Автотесты: ?autotest=1 — сразу на полигон, без меню (одиночка; bots=1 — с тремя союзными ботами)
(function autotest() {
  const q = new URLSearchParams(location.search);
  if (!q.get('autotest')) return;
  G.role = 'solo'; G.mySlot = 0; G.myName = 'Тест';
  hideMenu();
  startRange([{ slot: 0, human: true, name: 'Тест' }], q.get('bots') === '1');
})();
