'use strict';
// ---------- Главный цикл ----------

let last = performance.now();
function frame(now) {
  // тесты и скриншоты сами двигают симуляцию и сами рисуют кадр (фоновая отрисовка со светом в headless слишком дорогая)
  if (window.__manualTick || document.hidden || !frameDue(now)) { requestAnimationFrame(frame); return; }
  step(now);
  render(Math.min(0.05, G.lastDt || 0));
  requestAnimationFrame(frame);
}

// Ограничение 60 к/с (OPTS.fps60): экран 90–120 Гц зовёт кадр чаще — лишние пропускаем. Расписание — равномерное
// (каждые 16,7 мс с допуском 2 мс): на 120 Гц — каждый второй, на 90 Гц — два из трёх (60, а не 45), на 60 Гц — все.
const FRAME_MS = 1000 / 60;
let nextFrame = 0;
function frameDue(now) {
  if (!OPTS.fps60) return true;
  if (now < nextFrame - 2) return false;
  nextFrame = Math.max(nextFrame + FRAME_MS, now - FRAME_MS / 2);     // отстали (тормоза) — долг не копим
  return true;
}

// Один шаг игры по реальному времени (без рисования)
function step(now) {
  const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
  last = now;
  G.lastDt = dt;
  if (!touchPaused()) G.time += dt;            // одиночка на телефоне: меню ≡ / настройка кнопок — пауза
  if (map && G.state !== 'menu' && G.state !== 'lobby') update(dt);
  else if (G.state === 'lobby') netStats(dt);           // пинг виден уже в лобби
  Voice.update();
}

// Свёрнутая или фоновая вкладка: requestAnimationFrame браузер останавливает совсем, таймеры страницы — душит.
// В сетевой игре мир не должен вставать у всех из-за того, что хост переключился на другое окно: шаги идут
// по таймеру из Web Worker (его браузер не душит), без рисования. Одиночная игра в фоне стоит на паузе, как раньше.
const BG_MS = 1000 / 60;
let bgWorker = null;
function bgTick() {
  if (window.__manualTick || !document.hidden || (G.role !== 'host' && G.role !== 'guest')) return;
  step(performance.now());
}
try {
  const src = `setInterval(() => postMessage(0), ${BG_MS});`;
  bgWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  bgWorker.onmessage = bgTick;
} catch (e) { bgWorker = null; }        // нет Worker (очень старый браузер) — в фоне игра встаёт, как раньше
// смена видимости: отсчёт шага заново (одиночка после паузы не делает огромный шаг за всё время отсутствия)
document.addEventListener('visibilitychange', () => { last = performance.now(); });

function update(dt) {
  G.stateT += dt;
  // Enter — заново: у хоста и в одиночке сразу, гость просит хоста (после гибели отряда или победы); в забеге («Выживание», «Штурм») — нет
  if (pressed.Enter && G.mapId !== 'hub' && !G.surv) {
    if (isAuth()) restartRange();
    else if (G.state !== 'play') send({ t: 'restart' });
  }
  if (pressed.Backspace && isAuth()) backToHub();          // хост: обратно в хаб (забег — поражение, с итогами)
  if (G.state === 'dead' && G.run && isAuth() && G.stateT >= RUN_DEAD_T) backToHub();   // отряд погиб в забеге — в хаб
  const p = me();
  touchFrame();                                         // сенсорное управление: стики → «мышь» и движение
  if (p && G.state === 'play' && !uiOpen()) controlLocal(p, dt);
  else clearPressed();
  if (touchPaused()) { /* пауза: мир стоит, камера и интерфейс — как обычно */ }
  else if (isAuth()) updateWorld(dt);
  else guestWorld(dt);
  netTick(dt);

  // камера: свой боец (погиб — тот, за кем наблюдаем) + смещение к курсору (с прицелом — дальше)
  if (Math.abs(G.view - G.viewT) > 1e-3) { G.view += (G.viewT - G.view) * Math.min(1, dt * CAM.zoomSpeed); applyZoom(); }
  const v = viewer();
  if (v) {
    const look = v === p ? CAM.look + (p.ads || 0) * (CAM.lookAds - CAM.look) : 0;
    const tx = (v.lx ?? v.x) + ((mouse.x - VW / 2) * look) / G.zoom, ty = (v.ly ?? v.y) + ((mouse.y - VH / 2) * look) / G.zoom;
    const ck = Math.min(1, dt * CAM.follow);
    G.cam.x += (tx - G.cam.x) * ck; G.cam.y += (ty - G.cam.y) * ck;
  }
}

// Чьими глазами смотрим: свой боец, а если погиб — живой товарищ (сначала люди, потом боты)
function viewer() {
  const p = me();
  if (p && !p.dead) return p;
  return G.players.find((q) => !q.dead && !q.ai) || G.players.find((q) => !q.dead) || p;
}

// Заново — та же карта с тем же seed (та же расстановка)
function restartRange() {
  if (G.mapId === 'hub' || G.surv) return;
  launchMap(G.mapId || 'range', G.mapSeed || 0);
}

// Мир (хост и одиночка): оружие, ИИ, пули, двери, частицы. Отдельно от ввода — тесты гоняют только его.
function updateWorld(dt) {
  for (const p of G.players) {
    if (!p.dead) {
      if (!p.ai) updateGun(p, dt);           // ботам — в updateAI (раньше вызывалось дважды: стреляли и перезаряжались вдвое быстрее)
      updateAct(p, dt);                    // действия (двери; у грузовика — и у ботов)
      if (!p.ai) {
        if (p.net) applyRemoteFire(p);       // курок гостя (ввод пришёл по сети)
      }
      updateLean(p, dt);
    }
    if (!p.net) trackSpeed(p, dt);
    p.supp = Math.max(0, p.supp - dt * 0.6); p.hurtT += dt;
  }
  if (G.state === 'play') { updateAI(dt); stepNoises(dt); updateDowned(dt); updateHub(dt); updateSurvival(dt); }
  updateWeather(dt);
  for (const e of G.enemies) trackSpeed(e, dt);
  for (const o of allPeople()) if (!o.dead || o.side === 'p') updateAnim(o, dt);
  updateBullets(dt);
  updateDoors(dt);
  updateKeys();
  if (G.state === 'play') {
    // проигрыш: погибли все люди (раненые ещё живы — истекают кровью, их могут поднять)
    const humans = G.players.filter((q) => !q.ai);
    if (humans.length && humans.every((q) => q.dead)) { G.state = 'dead'; G.stateT = 0; }
    else if (!G.surv && G.enemies.length && G.enemies.every((e) => e.dead)) { G.state = 'win'; G.stateT = 0; }   // «Выживание», «Штурм» — победы нет (волны, локации)
  }
  updateLocalFx(dt);
}

// Гость: мир считает хост; здесь — свой боец, чужие — по истории снимков (интерполяция), анимация и эффекты
function guestWorld(dt) {
  const p = me();
  if (p && !p.dead) { updateLean(p, dt); trackSpeed(p, dt); predTick(p, dt); }
  const t = interpTime();
  for (const o of allPeople()) {
    if (o === p || !o.hist) continue;
    interpApply(o, t);
    const side = o.a + Math.PI / 2 * (o.leanSide || 0), d = Math.abs(o.leanPx || 0);
    o.lx = o.x + Math.cos(side) * d; o.ly = o.y + Math.sin(side) * d;
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
  weatherFx(dt);
  if (p && !isAuth()) p.hurtT = (p.hurtT ?? 9) + dt;
  for (const h of G.hurt) h.t -= dt;
  G.hurt = G.hurt.filter((h) => h.t > 0);
  G.shake = Math.max(0, G.shake - dt * 25);
  if (G.hitmark) { G.hitmark.t -= dt; if (G.hitmark.t <= 0) G.hitmark = null; }
  if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }
  if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
  if (G.runResult) { G.runResult.t -= dt; if (G.runResult.t <= 0) G.runResult = null; }
  if (G.radioMsg) { G.radioMsg.t -= dt; if (G.radioMsg.t <= 0) G.radioMsg = null; }
  if (G.barks) { for (const b of G.barks) b.t -= dt; G.barks = G.barks.filter((b) => b.t > 0); }
}

function resize() {
  if (!mouse.x && !mouse.y) { mouse.x = innerWidth / 2; mouse.y = innerHeight / 2 - 120; }
  // телефон: холст чётче CSS-пикселей (TouchUI.scale), на ПК — 1
  const k = TouchUI.scale();
  VW = canvas.width = Math.round(innerWidth * k);
  VH = canvas.height = Math.round(innerHeight * k);
  applyZoom();
}

// Масштаб: G.view — сколько метров видно по вертикали (плавно догоняет G.viewT — цель колёсика), запоминается в браузере
function applyZoom() { G.zoom = clamp(VH / M(G.view), 0.25, 3); }
// на телефоне свой масштаб (экран маленький — по умолчанию ближе)
const VIEW_KEY = TouchUI.on ? 'pcr-view-touch' : 'pcr-view';
{
  let v = TouchUI.on ? TOUCH.view : VIEW_M;
  try { v = +localStorage.getItem(VIEW_KEY) || v; } catch (e) { /* ignore */ }
  G.view = G.viewT = clamp(v, CAM.viewMin, CAM.viewMax);
}
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!map || G.state === 'menu' || G.state === 'lobby' || !e.deltaY) return;
  G.viewT = clamp(G.viewT * Math.pow(CAM.wheelStep, Math.sign(e.deltaY)), CAM.viewMin, CAM.viewMax);   // вниз — дальше
  try { localStorage.setItem(VIEW_KEY, G.viewT.toFixed(1)); } catch (err) { /* ignore */ }
}, { passive: false });
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
