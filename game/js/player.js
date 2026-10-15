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
canvas.addEventListener('mousemove', (e) => {
  mouse.dx = (mouse.dx || 0) + e.movementX; mouse.dy = (mouse.dy || 0) + e.movementY;
  if (!lookCam(me())) { mouse.x = e.clientX; mouse.y = e.clientY; }    // камера по взгляду: курсор — свой (lookAim)
});
canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (lookCam(me()) && !TouchUI.on && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  if (e.button === 0) { mouse.l = true; mouse.lPressed = true; }
  if (e.button === 2) mouse.r = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Камера: мир → экран — поворот G.camRot (камера за машиной), масштаб G.zoom, центр экрана — G.cam. CAMM — матрица текущего кадра (render)
function camMatrix(shX = 0, shY = 0) {
  const z = G.zoom, r = G.camRot || 0, c = Math.cos(r) * z, s = Math.sin(r) * z;
  return [c, s, -s, c, VW / 2 + shX - (c * G.cam.x - s * G.cam.y), VH / 2 + shY - (s * G.cam.x + c * G.cam.y)];
}
let CAMM = [1, 0, 0, 1, 0, 0];
// Камера по взгляду (OPTS.cam 'look'; не на сенсоре, не в машине): поворот — взгляд вверх, боец — внизу посередине
const lookCam = (v) => OPTS.cam === 'look' && !!v && !v.veh;
function setCamMode(m) {
  OPTS.cam = m;
  saveOpts();
  if (m === 'look') { mouse.x = VW / 2; mouse.y = VH * 0.4; if (!TouchUI.on) canvas.requestPointerLock?.(); }
  else if (document.pointerLockElement) document.exitPointerLock();
  toast(m === 'look' ? 'КАМЕРА: ПО ВЗГЛЯДУ (N)' : 'КАМЕРА: ОБЫЧНАЯ (N)', 1.4);
}
// Направление на экране (WASD) → в мире: с повёрнутой камерой W — вверх экрана
function camMove(mx, my) {
  const r = G.camRot || 0, c = Math.cos(r), s = Math.sin(r);
  return r ? [c * mx + s * my, -s * mx + c * my] : [mx, my];
}
// Взгляд бойца: обычно — на курсор; камера по взгляду — мышь по горизонтали поворачивает, курсор стоит на линии взгляда
function lookAim(p) {
  const dx = mouse.dx || 0, dy = mouse.dy || 0;
  mouse.dx = mouse.dy = 0;
  if (!lookCam(p)) { const w = screenToWorld(mouse.x, mouse.y); p.a = Math.atan2(w.y - p.y, w.x - p.x); return; }
  p.a = angDiff(p.a + dx * CAM.turn, 0);
  mouse.x = VW / 2;
  mouse.y = clamp((mouse.y || 0) + dy, 30, VH * (1 - CAM.bottom) - 40);
}
const worldToScreen = (x, y, m = camMatrix()) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
function screenToWorld(sx, sy) {
  const r = G.camRot || 0, dx = (sx - VW / 2) / G.zoom, dy = (sy - VH / 2) / G.zoom;
  return { x: G.cam.x + Math.cos(r) * dx + Math.sin(r) * dy, y: G.cam.y - Math.sin(r) * dx + Math.cos(r) * dy };
}
// Экран (с запасом pad, px экрана) в координатах мира — четыре угла (при повороте — не прямоугольник по осям)
function screenPolyWorld(pad = 8) {
  const pts = [[-pad, -pad], [VW + pad, -pad], [VW + pad, VH + pad], [-pad, VH + pad]].map(([x, y]) => screenToWorld(x, y));
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < 4; i++) path.lineTo(pts[i].x, pts[i].y); path.closePath();
  return { path, pts };
}

function controlLocal(p, dt) {
  // отладка (действует только на нажавшего): [ — бессмертие своего бойца (в сети — у хоста), ] — без тумана войны на своём экране
  if (pressed.BracketLeft) doAct(p, 'god');
  if (pressed.BracketRight) { G.noFog = !G.noFog; toast(G.noFog ? 'ОТЛАДКА: ТУМАН ВОЙНЫ ВЫКЛЮЧЕН (])' : 'ТУМАН ВОЙНЫ ВКЛЮЧЁН (])', 2); }
  if (pressed.KeyN) setCamMode(OPTS.cam === 'look' ? 'std' : 'look');      // N — камера: обычная / по взгляду (тест)
  if (pressed.KeyK) stepSight(keys.ShiftLeft || keys.ShiftRight ? 1 : -1);   // K / Shift+K — видимость (хост)
  if (p.dead) { clearPressed(); return; }
  if (p.down) { crawl(p, dt); clearPressed(); return; }
  const g = p.gun;
  // взаимодействие: F — дверь (открыть/закрыть/отпереть), G — выбить. Действия выполняет хост (у гостя — уходят ему).
  // рядом раненый товарищ — F (держать) поднимает его, а не открывает дверь
  const near = doorNear(p);
  const downNear = G.players.some((q) => q !== p && q.down && !q.dead && Math.hypot(q.x - p.x, q.y - p.y) < DOWN.reviveR);
  if (pressed.KeyF && p.veh) doAct(p, 'veh');                            // в машине — выйти (не быстрее VEH.exitSpeed)
  else if (pressed.KeyF && G.surv && nearRear(p)) openTruckMenu();     // «Выживание»: задний борт грузовика — меню
  else if (pressed.KeyF && G.surv && nearMedic(p)) doAct(p, 'heal');    // …медик — лечиться
  else if (pressed.KeyF && tableNear(p)) openLoadout();                  // хаб: оружейный стол — выбор снаряжения (у себя на экране)
  else if (pressed.KeyF && (p.mg || mgNear(p)) && !downNear) doAct(p, 'mg');     // стационарный пулемёт: занять / оставить
  else if (pressed.KeyF && vehNear(p) && !downNear) doAct(p, 'veh');             // машина рядом — сесть
  else if (pressed.KeyF && near && !downNear) doAct(p, 'door');
  if (pressed.KeyG && near && !p.mg && !p.veh) doAct(p, 'kick');
  const busy = !!p.act || !!p.reviving;     // отпирает, бьёт ногой или поднимает раненого — стоит на месте
  // стойка: C — присесть/встать (Ctrl не используем: Ctrl+W закрывает вкладку)
  if (pressed.KeyC && p.veh) {
    // в машине C — камера: обычная / за машиной (поворачивается вместе с ней)
    OPTS.carCam = OPTS.carCam === 'car' ? 'std' : 'car';
    saveOpts();
    toast(OPTS.carCam === 'car' ? 'КАМЕРА: ЗА МАШИНОЙ (C)' : 'КАМЕРА: ОБЫЧНАЯ (C)', 1.4);
  } else if (pressed.KeyC) p.crouchToggle = !p.crouchToggle;
  let [mx, my, mk] = moveInput();
  if (p.veh) { vehControl(p, mx, my); mx = my = 0; }      // в машине: водитель — газ и руль (как нажато, без поворота камеры), пассажир — сидит
  else [mx, my] = camMove(mx, my);
  if (busy || p.mg) mx = my = 0;      // отпирает, бьёт ногой или за пулемётом — стоит на месте
  const ml = Math.hypot(mx, my);
  if (ml) { mx /= ml; my /= ml; }
  const wantSprint = keys.ShiftLeft || keys.ShiftRight || (TouchUI.on && TouchUI.sprint);
  if (wantSprint) mk = 1;
  p.sprint = !!(wantSprint && ml && !mouse.r);
  if (p.sprint) { p.crouchToggle = false; p.sprintLock = SPRINT_TO_FIRE; }
  else p.sprintLock = Math.max(0, p.sprintLock - dt);
  if (p.mg || p.veh) p.crouchToggle = false;   // за пулемётом — стоя (станок высокий); в машине — сидя
  p.crouch = !p.sprint && !!p.crouchToggle;
  // прицеливание: ПКМ (не на бегу и не во время перезарядки)
  const adsWant = (mouse.r || !!p.mg) && !p.sprint && !g.reloadT;     // за пулемётом — всегда «в прицел» (станок)
  p.ads = clamp(p.ads + (adsWant ? dt : -dt) / ADS_TIME, 0, 1);

  // выглядывание: Q — влево, E — вправо (держать); на бегу нельзя
  p.leanWant = p.sprint || p.mg || p.veh ? 0 : (keys.KeyE ? 1 : 0) - (keys.KeyQ ? 1 : 0);
  let sp = p.sprint ? SPEED.sprint : p.crouch ? (p.ads > 0.5 ? SPEED.crouchAds : SPEED.crouch) : p.ads > 0.5 ? SPEED.ads : SPEED.walk;
  if (Math.abs(p.lean) > 0.3) sp = Math.min(sp, LEAN.speed);
  const k = (ml ? dirSpeedK(Math.atan2(my, mx), p.a) : 1) * mk * armorSpeedK(p);     // броня — медленнее
  moveCircle(p, mx * M(sp * k) * dt, my * M(sp * k) * dt, PR);

  lookAim(p);   // взгляд всегда за мышкой — и на бегу (оружие при этом опущено)
  if (p.mg) {
    // за пулемётом: на месте стрелка, ствол — только в секторе станка
    const s = mgSeat(p.mg);
    p.x = s.x; p.y = s.y;
    p.a = mgClamp(p.mg, p.a);
  }

  if (pressed.KeyL) doAct(p, 'lamp');
  // оружие: 1, 2 — полноразмерные, 3 — пистолет; X — удар ножом
  if (pressed.Digit1) doAct(p, 'w0');
  if (pressed.Digit2) doAct(p, 'w1');
  if (pressed.Digit3) doAct(p, 'w2');
  if (pressed.KeyX) doAct(p, 'knife');
  // R — перезарядка; второе нажатие подряд (RELOAD_QUICK.dbl) — быстрая: магазин сбросить целиком
  if (pressed.KeyR) { doAct(p, G.time - (p.lastR ?? -9) < RELOAD_QUICK.dbl ? 'reloadq' : 'reload'); p.lastR = G.time; }
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

// Направление движения: WASD или сенсорный стик (TouchUI.mv); третье — доля скорости (стик отклонён не до конца — медленнее)
function moveInput() {
  if (TouchUI.on && TouchUI.mv) {
    const m = Math.hypot(TouchUI.mv.x, TouchUI.mv.y);
    return [TouchUI.mv.x, TouchUI.mv.y, clamp(m / 0.8, 0.35, 1)];
  }
  return [(keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0), 1];
}

// Действие бойца: в одиночке и у хоста — сразу, у гостя — уходит хосту со следующим пакетом ввода
function doAct(p, k) {
  if (isAuth()) applyAct(p, k); else Net.inp.acts.push(k);
}

function applyAct(p, k) {
  if (p.dead) return;
  if (k === 'mg') { if (!p.veh) mgToggle(p); return; }
  if (k === 'veh') { if (!p.mg) vehToggle(p); return; }
  if (p.veh && /^(door|kick|supply.*|heal)$/.test(k)) return;              // из машины — ни дверей, ни грузовика
  if (p.veh && p.seat === 0 && /^(w0|w1|knife)$/.test(k)) return;           // водитель: руки на руле — только пистолет
  if (p.mg && /^(w[0-2]|knife|mode|door|kick)$/.test(k)) return;      // за пулемётом — ни смены оружия, ни ножа, ни дверей
  const g = p.gun;
  if (k === 'door') { const d = doorNear(p); if (d) useDoor(p, d); }
  else if (k === 'kick') { const d = doorNear(p); if (d) startKick(p, d); }
  else if (k === 'lamp') { p.lamp = !p.lamp; emit(['mode', p.id]); }
  else if (k === 'reload') startReload(p);
  else if (k === 'reloadq') quickReload(p);
  else if (k === 'w0' || k === 'w1' || k === 'w2') switchTo(p, +k[1]);
  else if (k === 'knife') startMelee(p);
  else if (k.startsWith('kit:')) applyKitAct(p, k);
  else if (k === 'supply' || k.startsWith('supply:') || k === 'heal' || k === 'evac') survAct(p, k);
  else if (k === 'god') {
    p.god = !p.god;
    if (p.god) { if (p.down) reviveUp(p); p.hp = HP; }        // включил раненым — сразу на ногах и с полным здоровьем
    emit(['toast', p.id, p.god ? 'ОТЛАДКА: БЕССМЕРТИЕ ([)' : 'БЕССМЕРТИЕ ВЫКЛЮЧЕНО ([)']);
  }
  else if (k === 'mode') {
    const modes = WEAPONS[g.t].modes;
    if (modes.length < 2) return;                 // у ружья и пистолета режим один
    g.mode = modes[(modes.indexOf(g.mode) + 1) % modes.length];
    emit(['mode', p.id]);
    emit(['toast', p.id, g.mode === 'auto' ? 'АВТОМАТИЧЕСКИЙ ОГОНЬ' : 'ОДИНОЧНЫЙ ОГОНЬ']);
  }
}

// Шаги шумят у всех (и у людей, и у ботов, и у противников): бег слышно далеко, присед — почти неслышно
function stepNoises(dt) {
  for (const o of allPeople()) {
    if (o.dead || o.veh || o.speed < M(0.4)) { o.stepT = 0; continue; }      // в машине шумит машина (updateVehicles)
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
  let [mx, my] = moveInput();
  [mx, my] = camMove(mx, my);
  const ml = Math.hypot(mx, my);
  if (ml) { mx /= ml; my /= ml; moveCircle(p, mx * M(DOWN.crawl) * dt, my * M(DOWN.crawl) * dt, PR); }
  lookAim(p);
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
