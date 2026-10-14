'use strict';
// ---------- Сенсорное управление (телефон, планшет) ----------
// Включается само на устройстве с сенсорным экраном без мыши (pointer: coarse); ?touch=1 / ?touch=0 — принудительно.
// Остальной код не знает о сенсоре: левый стик двигает бойца (TouchUI.mv — вместо WASD, sprint — вместо Shift),
// правый стик ставит «мышь» (направление взгляда) и жмёт ЛКМ у внешнего кольца, кнопки нажимают клавиши (keydown/keyup).
// Всё рисуется на холсте поверх интерфейса (drawTouch); координаты — пиксели холста (на телефоне холст чётче CSS: TouchUI.scale).

const TouchUI = {
  on: (() => {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1' || q === '0') return q === '1';
    return !!window.matchMedia && matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  })(),
  mv: null,               // левый стик: { x, y } — направление и сила (длина ≤ 1)
  sprint: false,          // палец вышел за кольцо левого стика — бег
  aim: { x: 0, y: -1 },   // куда смотрит (единичный вектор; остаётся, когда палец убран)
  stickFire: false,       // правый стик у внешнего кольца — огонь
  btnFire: false,         // кнопка «ОГОНЬ»
  ads: false,             // прицел (переключатель)
  sticks: { move: null, aim: null },   // активные стики: { id, ox, oy, x, y }
  held: new Map(),        // id касания → кнопка
  fsTried: false,
  menuT: -9,
};

const TOUCH = {
  stickK: 1.7,            // радиус стика — в радиусах кнопки
  sprintAt: 1.25,         // палец дальше кольца (× радиус) — бег
  fireAt: 0.85,           // правый стик: огонь у внешнего кольца (доля радиуса)
  aimDead: 0.25,          // правый стик: ближе к центру направление не меняется
  aimDist: 0.3,           // точка прицела от бойца (доля высоты экрана), с прицелом — aimDistAds
  aimDistAds: 0.42,
  view: 18,               // м по вертикали по умолчанию (экран телефона маленький — ближе, чем на ПК)
};

// Чёткость холста: на маленьком экране — больше пикселей холста на CSS-пиксель (интерфейс компактнее и не размыт)
TouchUI.scale = () => (TouchUI.on ? clamp(560 / Math.max(1, innerHeight), 1, Math.min(window.devicePixelRatio || 1, 2)) : 1);
const touchR = () => Math.round(clamp(VH * 0.075, 26, 60));     // радиус кнопки (px холста)
const inGame = () => !!map && G.state !== 'menu' && G.state !== 'lobby';

if (TouchUI.on) document.documentElement.classList.add('touch');

// Клавиши — настоящими событиями: их ловят и ввод (keys, pressed), и обработчики Esc, M и т. п.
const vkey = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
const vtap = (code) => { vkey(code, true); vkey(code, false); };

// Что сделает F рядом: подпись кнопки (null — кнопку не показывать)
function touchUseLabel(p) {
  if (!p || p.dead || p.down) return null;
  if (G.players.some((q) => q !== p && q.down && !q.dead && Math.hypot(q.x - p.x, q.y - p.y) < DOWN.reviveR)) return 'ПОДНЯТЬ';
  if (G.surv && nearRear(p)) return 'ГРУЗОВИК';
  if (G.surv && nearMedic(p)) return 'МЕДИК';
  if (tableNear(p)) return 'СТОЛ';
  const d = doorNear(p);
  if (d) return 'ДВЕРЬ';
  return null;
}

// Кнопки на этом кадре: { id, x, y, r, label, sub?, hold?, on?, down(), up?() }
function touchButtons() {
  const p = me();
  if (!inGame() || !p) return [];
  const R = touchR(), B = [];
  const add = (b) => B.push(b);
  const small = Math.round(R * 0.62);
  // меню — всегда (сверху, правее блока задачи)
  add({ id: 'menu', x: Math.min(370 + small, VW / 2 - 140 - small), y: 14 + small, r: small, label: '≡', down: openTouchMenu });
  if (G.state !== 'play') {
    // конец раунда: заново (в забеге — нельзя)
    if (G.mapId !== 'hub' && !G.surv && (isAuth() || G.state !== 'play')) add({ id: 'again', x: VW / 2, y: VH * 0.62, r: R * 1.1, label: 'ЗАНОВО', down: () => vtap('Enter') });
    return B;
  }
  if (p.dead) return B;
  const x1 = VW - R - 14, x2 = x1 - R * 2.4;
  const y0 = Math.max(160 + R, VH * 0.3);
  // левая сторона: выглянуть влево / вправо (держать), рация (держать, если голос включён)
  if (!p.down) {
    const yl = Math.max(250 + R, VH * 0.52);
    add({ id: 'leanL', x: R + 14, y: yl, r: R * 0.85, label: '◀', sub: 'выгл.', hold: 'KeyQ', on: p.lean < -0.3 });
    add({ id: 'leanR', x: R + 14 + R * 2.1, y: yl, r: R * 0.85, label: '▶', sub: 'выгл.', hold: 'KeyE', on: p.lean > 0.3 });
  }
  if (Voice.stream && (G.role === 'host' || G.role === 'guest')) add({ id: 'radio', x: R + 14 + R * 4.2, y: Math.max(250 + R, VH * 0.52), r: R * 0.85, label: 'РАЦИЯ', hold: 'KeyB', on: !!keys.KeyB });
  if (p.down) return B;
  // правая сторона
  add({ id: 'ads', x: x1, y: y0, r: R, label: 'ПРИЦЕЛ', on: TouchUI.ads, down: () => { TouchUI.ads = !TouchUI.ads; } });
  add({ id: 'reload', x: x1, y: y0 + R * 2.3, r: R, label: 'ПЕРЕЗ.', sub: '×2 — быстро', down: () => vtap('KeyR') });
  add({ id: 'crouch', x: x1, y: y0 + R * 4.6, r: R, label: p.crouchToggle ? 'ВСТАТЬ' : 'ПРИСЕД', on: !!p.crouchToggle, down: () => vtap('KeyC') });
  add({ id: 'fire', x: x2, y: y0 + R * 0.4, r: R * 1.3, label: 'ОГОНЬ', on: TouchUI.btnFire, fire: true });
  // оружие: следующее по кругу из того, что есть (1, 2 — полноразмерные, 3 — пистолет)
  const next = p.kit ? [1, 2].map((i) => (p.cur + i) % 3).find((i) => p.kit[i]) : undefined;
  if (next !== undefined) add({ id: 'weapon', x: x2, y: y0 + R * 2.9, r: R * 0.85, label: 'ОРУЖ.', sub: WEAPONS[p.kit[next].t].short, down: () => vtap('Digit' + (next + 1)) });
  add({ id: 'knife', x: x2, y: y0 + R * 4.9, r: R * 0.85, label: 'НОЖ', down: () => vtap('KeyX') });
  // сверху, левее панели оружия: фонарь, режим огня
  const xt = VW - 270 - small - 12;
  add({ id: 'lamp', x: xt, y: 14 + small, r: small, label: 'ФОНАРЬ', on: !!p.lamp, down: () => vtap('KeyL') });
  if (WEAPONS[p.gun.t].modes.length > 1) add({ id: 'mode', x: xt - small * 2.3, y: 14 + small, r: small, label: 'РЕЖИМ', down: () => vtap('KeyV') });
  // по обстановке: F (дверь, подъём раненого — держать, стол, грузовик, медик), G — выбить дверь
  const use = touchUseLabel(p);
  const yb = VH - R - 14;
  if (use) add({ id: 'use', x: VW / 2 - R * 1.2, y: yb, r: R, label: use, hold: 'KeyF', on: !!keys.KeyF });
  if (doorNear(p)) add({ id: 'kick', x: VW / 2 + R * 1.2, y: yb, r: R, label: 'ВЫБИТЬ', down: () => vtap('KeyG') });
  return B;
}

// ---------- Касания (координаты холста) ----------
function touchStart(id, x, y) {
  if (keys.Tab) { keys.Tab = false; return; }                  // характеристики оружия закрываются касанием
  if (!inGame()) return;
  const S = TouchUI.sticks, R = touchR();
  const b = touchButtons().find((q) => Math.hypot(q.x - x, q.y - y) <= q.r * 1.15);
  if (b) {
    TouchUI.held.set(id, b);
    if (b.fire) { TouchUI.btnFire = true; mouse.lPressed = true; }
    else if (b.hold) vkey(b.hold, true);
    else if (b.down) b.down();
    return;
  }
  const RS = R * TOUCH.stickK;
  // стик появляется под пальцем (не у самого края — чтобы было куда тянуть)
  const ox = clamp(x, RS * 0.6, VW - RS * 0.6), oy = clamp(y, RS * 0.6, VH - RS * 0.6);
  if (x < VW / 2 && !S.move) { S.move = { id, ox, oy, x, y }; touchMove(id, x, y); }
  else if (x >= VW / 2 && !S.aim) { S.aim = { id, ox, oy, x, y }; touchMove(id, x, y); }
}

function touchMove(id, x, y) {
  const S = TouchUI.sticks, RS = touchR() * TOUCH.stickK;
  for (const kind of ['move', 'aim']) {
    const s = S[kind];
    if (!s || s.id !== id) continue;
    let dx = x - s.ox, dy = y - s.oy, d = Math.hypot(dx, dy);
    // палец ушёл далеко — стик тянется за ним
    const far = RS * (kind === 'move' ? TOUCH.sprintAt + 0.4 : 1.3);
    if (d > far) { s.ox = x - (dx / d) * far; s.oy = y - (dy / d) * far; dx = x - s.ox; dy = y - s.oy; d = far; }
    s.x = x; s.y = y;
    const m = d / RS, k = Math.min(1, m) / (d || 1);
    if (kind === 'move') {
      TouchUI.mv = m > 0.12 ? { x: dx * k, y: dy * k } : null;
      TouchUI.sprint = m >= TOUCH.sprintAt;
      if (TouchUI.sprint) TouchUI.ads = false;
    } else {
      if (m >= TOUCH.aimDead) TouchUI.aim = { x: dx / d, y: dy / d };
      const fire = m >= TOUCH.fireAt;
      if (fire && !TouchUI.stickFire) mouse.lPressed = true;
      TouchUI.stickFire = fire;
    }
  }
}

function touchEnd(id) {
  const b = TouchUI.held.get(id);
  if (b) {
    TouchUI.held.delete(id);
    if (b.fire) TouchUI.btnFire = false;
    else if (b.hold) vkey(b.hold, false);
    return;
  }
  const S = TouchUI.sticks;
  if (S.move && S.move.id === id) { S.move = null; TouchUI.mv = null; TouchUI.sprint = false; }
  if (S.aim && S.aim.id === id) { S.aim = null; TouchUI.stickFire = false; }
}

// Каждый кадр до управления бойцом: «мышь» — точка прицела от бойца, ЛКМ — огонь, ПКМ — прицел
function touchFrame() {
  if (!TouchUI.on) return;
  const p = me();
  if (!p || !inGame()) { mouse.l = mouse.r = false; return; }
  const z = G.zoom, L = VH * (TouchUI.ads ? TOUCH.aimDistAds : TOUCH.aimDist);
  const sx = ((p.lx ?? p.x) - G.cam.x) * z + VW / 2, sy = ((p.ly ?? p.y) - G.cam.y) * z + VH / 2;
  mouse.x = sx + TouchUI.aim.x * L;
  mouse.y = sy + TouchUI.aim.y * L;
  mouse.l = TouchUI.stickFire || TouchUI.btnFire;
  mouse.r = TouchUI.ads && !TouchUI.sprint;
}

// ---------- Отрисовка ----------
function drawTouch() {
  if (!TouchUI.on || !inGame()) return;
  ctx.save();
  if (VH > VW) {
    ctx.fillStyle = 'rgba(10,11,12,0.85)'; ctx.fillRect(0, 0, VW, VH);
    txt('ПОВЕРНИТЕ ТЕЛЕФОН ГОРИЗОНТАЛЬНО', VW / 2, VH / 2, Math.round(VW / 22), HUD_WARN, 'center');
    ctx.restore();
    return;
  }
  const R = touchR(), RS = R * TOUCH.stickK, S = TouchUI.sticks;
  const ring = (x, y, r, fill, stroke, w = 2) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(); }
  };
  // стики: активный — кольцо под пальцем и ручка; нет — слабая подсказка, где начинать
  const stick = (s, rx, ry, kind) => {
    const x = s ? s.ox : rx, y = s ? s.oy : ry;
    ctx.globalAlpha = s ? 0.9 : 0.35;
    ring(x, y, RS, 'rgba(15,16,17,0.25)', 'rgba(232,228,216,0.35)');
    if (kind === 'move') ring(x, y, RS * TOUCH.sprintAt, null, TouchUI.sprint ? 'rgba(255,176,48,0.8)' : 'rgba(232,228,216,0.12)', 1.5);
    else ring(x, y, RS * TOUCH.fireAt, null, TouchUI.stickFire ? 'rgba(255,80,64,0.9)' : 'rgba(255,80,64,0.3)', 1.5);
    if (s) {
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), k = d > RS ? RS / d : 1;
      ring(x + dx * k, y + dy * k, R * 0.6, 'rgba(232,228,216,0.35)', 'rgba(232,228,216,0.6)');
    } else {
      ctx.font = `${Math.round(R * 0.3)}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,228,216,0.6)';
      ctx.fillText(kind === 'move' ? 'ДВИЖЕНИЕ' : 'ВЗГЛЯД · ОГОНЬ', x, y + 4);
    }
  };
  const p = me();
  if (G.state === 'play' && p && !p.dead) {
    stick(S.move, RS + 24, VH - RS - 24, 'move');
    if (!p.down) stick(S.aim, VW - RS * 2.6 - 40, VH - RS - 24, 'aim');
  }
  ctx.globalAlpha = 1;
  for (const b of touchButtons()) {
    const pressedNow = [...TouchUI.held.values()].some((q) => q.id === b.id);
    ring(b.x, b.y, b.r, b.on || pressedNow ? 'rgba(255,176,48,0.35)' : 'rgba(15,16,17,0.45)', b.fire ? 'rgba(255,80,64,0.7)' : 'rgba(232,228,216,0.4)');
    ctx.textAlign = 'center';
    const fs = Math.round(clamp(b.r * (b.label.length > 6 ? 0.26 : b.label.length > 3 ? 0.32 : 0.6), 9, 30));
    ctx.font = `${fs}px Consolas, monospace`;
    ctx.fillStyle = b.on ? '#ffd890' : '#e8e4d8';
    ctx.fillText(b.label, b.x, b.y + (b.sub ? 0 : fs * 0.35));
    if (b.sub) {
      ctx.font = `${Math.round(fs * 0.75)}px Consolas, monospace`; ctx.fillStyle = 'rgba(232,228,216,0.6)';
      ctx.fillText(b.sub, b.x, b.y + fs);
    }
  }
  ctx.restore();
}

// ---------- Меню (≡): то, что на ПК — редкие клавиши ----------
let touchMenuEl = null;
const touchMenuOpen = () => !!touchMenuEl && !touchMenuEl.classList.contains('hidden');
function openTouchMenu() {
  if (!touchMenuEl) return;
  const show = (id, v) => touchMenuEl.querySelector(id).classList.toggle('hidden', !v);
  show('#tmuAgain', G.mapId !== 'hub' && !G.surv && (isAuth() || G.state !== 'play'));
  show('#tmuHub', isAuth() && G.mapId !== 'hub');
  show('#tmuMic', !!Voice.stream);
  touchMenuEl.querySelector('#tmuMic').textContent = Voice.muted ? 'МИКРОФОН: ВКЛЮЧИТЬ' : 'МИКРОФОН: ВЫКЛЮЧИТЬ';
  touchMenuEl.querySelector('#tmuView').textContent = `${Math.round(G.viewT)} м`;
  touchMenuEl.classList.remove('hidden');
  for (const k of ['KeyQ', 'KeyE', 'KeyB', 'KeyF']) if (keys[k]) vkey(k, false);
  touchReset();
}
const closeTouchMenu = () => { if (touchMenuEl) touchMenuEl.classList.add('hidden'); };
function touchZoom(k) {
  G.viewT = clamp(G.viewT * k, CAM.viewMin, CAM.viewMax);
  try { localStorage.setItem(VIEW_KEY, G.viewT.toFixed(1)); } catch (e) { /* ignore */ }
  touchMenuEl.querySelector('#tmuView').textContent = `${Math.round(G.viewT)} м`;
}
function touchFullscreen() {
  const el = document.documentElement;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    if (r && r.then) r.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  } catch (e) { /* iPhone: нет полноэкранного режима — играем как есть */ }
}
function touchReset() {
  TouchUI.held.clear();
  TouchUI.sticks.move = TouchUI.sticks.aim = null;
  TouchUI.mv = null; TouchUI.sprint = TouchUI.stickFire = TouchUI.btnFire = false;
}

if (TouchUI.on) {
  touchMenuEl = document.getElementById('touchMenu');
  const on = (id, fn) => touchMenuEl.querySelector(id).addEventListener('click', fn);
  on('#tmuResume', closeTouchMenu);
  on('#tmuAgain', () => { closeTouchMenu(); vtap('Enter'); });
  on('#tmuHub', () => { closeTouchMenu(); vtap('Backspace'); });
  on('#tmuOut', () => touchZoom(CAM.wheelStep));
  on('#tmuIn', () => touchZoom(1 / CAM.wheelStep));
  on('#tmuSpecs', () => { closeTouchMenu(); keys.Tab = true; });
  on('#tmuMic', () => { closeTouchMenu(); vtap('KeyM'); });
  on('#tmuFull', () => { closeTouchMenu(); touchFullscreen(); });
  on('#tmuLeave', () => { closeTouchMenu(); vtap('Escape'); });

  const k = () => VW / Math.max(1, innerWidth);
  const each = (e, fn) => { for (const t of e.changedTouches) fn(t.identifier, t.clientX * k(), t.clientY * k()); };
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); initAudio(); each(e, touchStart); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); each(e, touchMove); }, { passive: false });
  canvas.addEventListener('touchend', (e) => { e.preventDefault(); each(e, (id) => touchEnd(id)); }, { passive: false });
  canvas.addEventListener('touchcancel', (e) => { each(e, (id) => touchEnd(id)); });
  addEventListener('blur', touchReset);
  // первое касание в игре — во весь экран и горизонтально (дальше — из меню ≡)
  addEventListener('touchend', () => {
    if (TouchUI.fsTried || !inGame() || document.fullscreenElement) return;
    TouchUI.fsTried = true;
    touchFullscreen();
  });
}
