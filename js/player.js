'use strict';
// ---------- Ввод и управление своим бойцом ----------

const keys = {};
const pressed = {};
const mouse = { x: 0, y: 0, l: false, r: false, lPressed: false };
let VW = 0, VH = 0;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

addEventListener('keydown', (e) => {
  if (e.code === 'Tab') e.preventDefault();
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  initAudio();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (e.button === 0) { mouse.l = true; mouse.lPressed = true; }
  if (e.button === 2) mouse.r = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const screenToWorld = (sx, sy) => ({ x: (sx - VW / 2) / G.zoom + G.cam.x, y: (sy - VH / 2) / G.zoom + G.cam.y });

function controlLocal(p, dt) {
  // отладка (действует только на нажавшего): [ — бессмертие своего бойца (в сети — у хоста), ] — без тумана войны на своём экране
  if (pressed.BracketLeft) doAct(p, 'god');
  if (pressed.BracketRight) { G.noFog = !G.noFog; toast(G.noFog ? 'ОТЛАДКА: ТУМАН ВОЙНЫ ВЫКЛЮЧЕН (])' : 'ТУМАН ВОЙНЫ ВКЛЮЧЁН (])', 2); }
  if (p.dead) { clearPressed(); return; }
  if (p.down) { crawl(p, dt); clearPressed(); return; }
  const g = p.gun;
  // взаимодействие: F — дверь (открыть/закрыть/отпереть), G — выбить. Действия выполняет хост (у гостя — уходят ему).
  // рядом раненый товарищ — F (держать) поднимает его, а не открывает дверь
  const near = doorNear(p);
  const downNear = G.players.some((q) => q !== p && q.down && !q.dead && Math.hypot(q.x - p.x, q.y - p.y) < DOWN.reviveR);
  if (pressed.KeyF && near && !downNear) doAct(p, 'door');
  if (pressed.KeyG && near) doAct(p, 'kick');
  const busy = !!p.act || !!p.reviving;     // отпирает, бьёт ногой или поднимает раненого — стоит на месте
  // стойка: C — присесть/встать (Ctrl не используем: Ctrl+W закрывает вкладку)
  if (pressed.KeyC) p.crouchToggle = !p.crouchToggle;
  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), my = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  if (busy) mx = my = 0;              // отпирает или бьёт ногой — стоит на месте
  const ml = Math.hypot(mx, my);
  if (ml) { mx /= ml; my /= ml; }
  const wantSprint = keys.ShiftLeft || keys.ShiftRight;
  p.sprint = !!(wantSprint && ml && !mouse.r);
  if (p.sprint) { p.crouchToggle = false; p.sprintLock = SPRINT_TO_FIRE; }
  else p.sprintLock = Math.max(0, p.sprintLock - dt);
  p.crouch = !p.sprint && !!p.crouchToggle;
  // прицеливание: ПКМ (не на бегу и не во время перезарядки)
  const adsWant = mouse.r && !p.sprint && !g.reloadT;
  p.ads = clamp(p.ads + (adsWant ? dt : -dt) / ADS_TIME, 0, 1);

  // выглядывание: Q — влево, E — вправо (держать); на бегу нельзя
  p.leanWant = p.sprint ? 0 : (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  let sp = p.sprint ? SPEED.sprint : p.crouch ? (p.ads > 0.5 ? SPEED.crouchAds : SPEED.crouch) : p.ads > 0.5 ? SPEED.ads : SPEED.walk;
  if (Math.abs(p.lean) > 0.3) sp = Math.min(sp, LEAN.speed);
  const k = ml ? dirSpeedK(Math.atan2(my, mx), p.a) : 1;
  moveCircle(p, mx * M(sp * k) * dt, my * M(sp * k) * dt, PR);

  const w = screenToWorld(mouse.x, mouse.y);
  const aim = Math.atan2(w.y - p.y, w.x - p.x);
  p.a = aim;   // взгляд всегда за мышкой — и на бегу (оружие при этом опущено)

  if (pressed.KeyL) doAct(p, 'lamp');
  if (pressed.KeyR) doAct(p, 'reload');
  if (pressed.KeyV) doAct(p, 'mode');          // B — рация (голосовой чат)
  if (isAuth()) { if (!busy) pullTrigger(p, mouse.l, mouse.lPressed, playerSpread(p)); }
  else { Net.inp.fire = mouse.l && !busy; if (mouse.lPressed) Net.inp.press++; predictFire(p, mouse.l && !busy, mouse.lPressed); }

  // свои шаги слышно себе (шум для противников считает хост — stepNoises)
  if (ml) {
    p.sfxT = (p.sfxT || 0) - dt;
    if (p.sfxT <= 0) { p.sfxT = p.sprint ? 0.3 : 0.45; SFX.step(p.sprint ? 0.2 : p.crouch ? 0.05 : 0.11); }
  }
  clearPressed();
}

// Действие бойца: в одиночке и у хоста — сразу, у гостя — уходит хосту со следующим пакетом ввода
function doAct(p, k) {
  if (isAuth()) applyAct(p, k); else Net.inp.acts.push(k);
}

function applyAct(p, k) {
  if (p.dead) return;
  const g = p.gun;
  if (k === 'door') { const d = doorNear(p); if (d) useDoor(p, d); }
  else if (k === 'kick') { const d = doorNear(p); if (d) startKick(p, d); }
  else if (k === 'lamp') { p.lamp = !p.lamp; emit(['mode', p.id]); }
  else if (k === 'reload') startReload(p);
  else if (k === 'god') {
    p.god = !p.god;
    if (p.god) { if (p.down) reviveUp(p); p.hp = HP; }        // включил раненым — сразу на ногах и с полным здоровьем
    emit(['toast', p.id, p.god ? 'ОТЛАДКА: БЕССМЕРТИЕ ([)' : 'БЕССМЕРТИЕ ВЫКЛЮЧЕНО ([)']);
  }
  else if (k === 'mode') {
    const modes = WEAPONS[g.t].modes;
    g.mode = modes[(modes.indexOf(g.mode) + 1) % modes.length];
    emit(['mode', p.id]);
    emit(['toast', p.id, g.mode === 'auto' ? 'АВТОМАТИЧЕСКИЙ ОГОНЬ' : 'ОДИНОЧНЫЙ ОГОНЬ']);
  }
}

// Шаги шумят у всех (и у людей, и у ботов, и у противников): бег слышно далеко, присед — почти неслышно
function stepNoises(dt) {
  for (const o of allPeople()) {
    if (o.dead || o.speed < M(0.4)) { o.stepT = 0; continue; }
    o.stepT -= dt;
    if (o.stepT > 0) continue;
    const r = o.sprint ? NOISE.sprint : o.crouch || o.down ? NOISE.crouch : o.ads > 0.5 ? NOISE.crouch * 2 : NOISE.step;
    makeNoise(o.x, o.y, M(r), 'step', o);
    o.stepT = o.sprint ? 0.3 : 0.45;
  }
}

// Вбок чуть медленнее, спиной вперёд — заметно медленнее (и на бегу)
function dirSpeedK(moveA, faceA) {
  const t = Math.abs(angDiff(moveA, faceA)) / (Math.PI / 2);   // 0 — вперёд, 1 — вбок, 2 — назад
  return t <= 1 ? 1 + (MOVE_DIR.side - 1) * t : MOVE_DIR.side + (MOVE_DIR.back - MOVE_DIR.side) * (t - 1);
}

// Наклон: плавно к цели; смещение вбок ограничено стеной (сквозь стену не высунуться). Пересчитывает lx, ly.
function updateLean(o, dt) {
  o.lean = approach(o.lean || 0, o.leanWant || 0, dt, LEAN.time);
  if (Math.abs(o.lean) < 0.01) { o.leanPx = 0; o.lx = o.x; o.ly = o.y; return; }
  const side = o.a + Math.PI / 2 * Math.sign(o.lean);
  const dx = Math.cos(side), dy = Math.sin(side);
  const room = castRay(o.x, o.y, dx, dy, LEAN.dist + 8, (tx, ty) => solidTile(tx, ty) && tileAt(tx, ty) !== T.LOW) - 6;
  const d = clamp(Math.abs(o.lean) * LEAN.dist, 0, Math.max(0, room));
  o.leanPx = d * Math.sign(o.lean);
  o.lx = o.x + dx * d; o.ly = o.y + dy * d;
}

// Глаза бойца (с учётом наклона)
const eyeOf = (o) => (o.leanPx ? { x: o.lx, y: o.ly, crouch: o.crouch } : o);

// Ранен: ползком, медленно; смотрит за мышкой; стрелять, бегать, выглядывать нельзя
function crawl(p, dt) {
  let mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), my = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  const ml = Math.hypot(mx, my);
  if (ml) { mx /= ml; my /= ml; moveCircle(p, mx * M(DOWN.crawl) * dt, my * M(DOWN.crawl) * dt, PR); }
  const w = screenToWorld(mouse.x, mouse.y);
  p.a = Math.atan2(w.y - p.y, w.x - p.x);
  p.crouch = true; p.sprint = false; p.ads = 0; p.leanWant = 0; p.sprintLock = SPRINT_TO_FIRE;
  if (!isAuth()) Net.inp.fire = false;
}

function clearPressed() {
  for (const k in pressed) delete pressed[k];
  mouse.lPressed = false;
}

// Скорость по факту перемещения (для точности, заметности и шума)
function trackSpeed(o, dt) {
  if (dt <= 0) return;
  const v = Math.hypot(o.x - o.px, o.y - o.py) / dt;
  o.speed += (v - o.speed) * Math.min(1, dt * 12);
  o.px = o.x; o.py = o.y;
}
