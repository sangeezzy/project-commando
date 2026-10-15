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
  edit: false,            // настройка раскладки кнопок (меню ≡ → «Настроить кнопки»)
  drag: new Map(),        // настройка: id касания → { bid, dx, dy } — какую кнопку тащит
  layout: {},             // свои положения кнопок: id → [x / VW, y / VH] (localStorage pcr-touch-layout)
  fsTried: false,
  menuT: -9,
};

const TOUCH = {
  stickK: 1.7,            // радиус стика — в радиусах кнопки
  sprintAt: 1.6,          // палец далеко за кольцом (× радиус) — бег
  fireAt: 1.6,            // правый стик: огонь — палец далеко за кольцом (× радиус), как бег у левого
  aimDead: 0.25,          // правый стик: ближе к центру направление не меняется
  aimDist: 0.3,           // точка прицела от бойца (доля высоты экрана), с прицелом — aimDistAds
  aimDistAds: 0.42,
  // камера по взгляду (OPTS.cam 'look'): правый стик вбок — поворот, скорость lookTurn рад/с × отклонение² (за кольцом — наибольшая),
  // ближе lookDead — не поворачивает; огонь — как обычно, палец за кольцом (вверх — без поворота); ассист доворачивает взгляд (lookAssist 1/с)
  lookTurn: 3.5, lookDead: 0.12, lookAssist: 5,
  view: 18,               // м по вертикали по умолчанию (экран телефона маленький — ближе, чем на ПК)
  // Аим ассист (только сенсор, режим — OPTS.assist): пока держит правый стик или «ОГОНЬ», взгляд тянется к видимому противнику
  // рядом с направлением стика — в «окне» width м вбок от линии (не дальше maxA рад). Сила: pull внутри доли full окна,
  // дальше спадает до 0 к краю: pull × (1 − ((откл. − full) / (1 − full))²). Направление стика при этом не меняется:
  // отпустил — ассиста нет; противник ушёл из окна — взгляд снова ровно по стику.
  //   soft — мягкий: узкое окно, тянет не до конца; hard — жёсткий: окно шире, в его середине взгляд ровно на цели (захват)
  assist: {
    soft: { width: M(1.2), maxA: 0.22, pull: 0.7, full: 0, range: M(45) },
    hard: { width: M(2.5), maxA: 0.4, pull: 1, full: 0.5, range: M(50) },
  },
};

// Чёткость холста: на маленьком экране — больше пикселей холста на CSS-пиксель (интерфейс компактнее и не размыт)
TouchUI.scale = () => (TouchUI.on ? clamp(560 / Math.max(1, innerHeight), 1, Math.min(window.devicePixelRatio || 1, 2)) : 1);
const touchR = () => Math.round(clamp(VH * 0.075, 26, 60));     // радиус кнопки (px холста)
const inGame = () => !!map && G.state !== 'menu' && G.state !== 'lobby';

if (TouchUI.on) document.documentElement.classList.add('touch');

// Настройки игрока (OPTS в data.js): на телефоне по умолчанию — 60 к/с; сохранённые — поверх
if (TouchUI.on) OPTS.fps60 = true;
try {
  const s = JSON.parse(localStorage.getItem('pcr-opts') || '{}');
  if (!(s.rev >= 1)) delete s.laser;       // rev 1: лазер стал прицелом по умолчанию — сохранённое раньше «перекрестие» не выбрано, а записано заодно
  Object.assign(OPTS, s, { rev: OPTS.rev });
} catch (e) { /* ignore */ }
if (!TOUCH.assist[OPTS.assist]) OPTS.assist = 'soft';
const saveOpts = () => { try { localStorage.setItem('pcr-opts', JSON.stringify(OPTS)); } catch (e) { /* ignore */ } };

// Клавиши — настоящими событиями: их ловят и ввод (keys, pressed), и обработчики Esc, M и т. п.
const vkey = (code, down) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code }));
const vtap = (code) => { vkey(code, true); vkey(code, false); };

// Что сделает F рядом: подпись кнопки (null — кнопку не показывать)
function touchUseLabel(p) {
  if (!p || p.dead || p.down) return null;
  if (G.players.some((q) => q !== p && q.down && !q.dead && Math.hypot(q.x - p.x, q.y - p.y) < DOWN.reviveR)) return 'ПОДНЯТЬ';
  if (p.veh) return carSpeed(p.veh) <= M(VEH.exitSpeed) ? 'ВЫЙТИ' : null;
  if (p.mg) return 'ОСТАВИТЬ';
  if (mgNear(p)) return 'ПУЛЕМЁТ';
  if (vehNear(p)) return 'В МАШИНУ';
  if (G.surv && nearRear(p)) return 'ГРУЗОВИК';
  if (G.surv && nearMedic(p)) return 'МЕДИК';
  if (tableNear(p)) return 'СТОЛ';
  const d = doorNear(p);
  if (d) return 'ДВЕРЬ';
  return null;
}

// Кнопки на этом кадре: { id, x, y, r, label, sub?, icon?, hold?, on?, fire?, zoom?, down() }.
// edit — режим настройки раскладки: видны все кнопки (и те, что появляются по месту), их перетаскивают.
// Положение, которое игрок выбрал сам, — TouchUI.layout[id] = [x / VW, y / VH] (доли экрана: не зависят от разрешения).
function touchButtons(edit = TouchUI.edit) {
  const p = me();
  if (!inGame() || !p) return [];
  const R = touchR(), small = Math.round(R * 0.62), B = [];
  // убранные игроком (TouchUI.hidden) в игре не показываются; в настройке видны все — убранные с пометкой off
  const add = (b, when = true) => {
    const off = TouchUI.hidden.has(b.id) && b.id !== 'menu';
    if (edit ? b.id !== 'again' : when && !off) B.push(Object.assign(b, { off }));
  };
  // меню — всегда (сверху, правее блока задачи); под ним — камера: приблизить / отдалить (держать — дальше)
  const xm = Math.min(370 + small, VW / 2 - 140 - small);
  add({ id: 'menu', x: xm, y: 14 + small, r: small, label: '≡', down: openTouchMenu });
  add({ id: 'zoomIn', x: xm, y: 14 + small * 3.4, r: small, label: '', icon: 'in', zoom: 1 / CAM.wheelStep });
  add({ id: 'zoomOut', x: xm, y: 14 + small * 5.8, r: small, label: '', icon: 'out', zoom: CAM.wheelStep });
  if (!edit && G.state !== 'play') {
    // конец раунда: заново (в забеге — нельзя)
    add({ id: 'again', x: VW / 2, y: VH * 0.62, r: R * 1.1, label: 'ЗАНОВО', down: () => vtap('Enter') }, G.mapId !== 'hub' && !G.surv);
    return touchLayout(B);
  }
  if (!edit && p.dead) return touchLayout(B);
  const x1 = VW - R - 14, x2 = x1 - R * 2.4;
  const y0 = Math.max(160 + R, VH * 0.3);
  // левая сторона: выглянуть влево / вправо (держать), рация (держать, если голос включён)
  const yl = Math.max(250 + R, VH * 0.52);
  add({ id: 'leanL', x: R + 14, y: yl, r: R * 0.85, label: '◀', sub: 'выгл.', hold: 'KeyQ', on: p.lean < -0.3 }, !p.down);
  add({ id: 'leanR', x: R + 14 + R * 2.1, y: yl, r: R * 0.85, label: '▶', sub: 'выгл.', hold: 'KeyE', on: p.lean > 0.3 }, !p.down);
  add({ id: 'radio', x: R + 14 + R * 4.2, y: yl, r: R * 0.85, label: 'РАЦИЯ', hold: 'KeyB', on: !!keys.KeyB }, !!Voice.stream && (G.role === 'host' || G.role === 'guest'));
  if (!edit && p.down) return touchLayout(B);
  // правая сторона
  add({ id: 'ads', x: x1, y: y0, r: R, label: 'ПРИЦЕЛ', on: TouchUI.ads, down: () => { TouchUI.ads = !TouchUI.ads; } });
  add({ id: 'reload', x: x1, y: y0 + R * 2.3, r: R, label: 'ПЕРЕЗ.', sub: '×2 — быстро', down: () => vtap('KeyR') });
  add({ id: 'crouch', x: x1, y: y0 + R * 4.6, r: R, label: p.crouchToggle ? 'ВСТАТЬ' : 'ПРИСЕД', on: !!p.crouchToggle, down: () => vtap('KeyC') }, !p.veh);
  add({ id: 'hbrake', x: x1, y: y0 + R * 4.6, r: R, label: 'РУЧНИК', hold: 'Space', on: !!keys.Space }, !!(p.veh && p.seat === 0));
  add({ id: 'fire', x: x2, y: y0 + R * 0.4, r: R * 1.3, label: 'ОГОНЬ', on: TouchUI.btnFire, fire: true });
  // оружие: следующее по кругу из того, что есть (1, 2 — полноразмерные, 3 — пистолет)
  const next = p.kit ? [1, 2].map((i) => (p.cur + i) % 3).find((i) => p.kit[i]) : undefined;
  add({ id: 'weapon', x: x2, y: y0 + R * 2.9, r: R * 0.85, label: 'ОРУЖ.', sub: next !== undefined ? WEAPONS[p.kit[next].t].short : '—',
    down: () => { if (next !== undefined) vtap('Digit' + (next + 1)); } }, next !== undefined);
  add({ id: 'knife', x: x2, y: y0 + R * 4.9, r: R * 0.85, label: 'НОЖ', down: () => vtap('KeyX') }, !p.veh);
  add({ id: 'carcam', x: x2, y: y0 + R * 4.9, r: R * 0.85, label: 'КАМЕРА', sub: OPTS.carCam === 'car' ? 'за машиной' : 'обычная', down: () => vtap('KeyC') }, !!p.veh);
  // сверху, левее панели оружия: фонарь, режим огня
  const xt = VW - 270 - small - 12;
  add({ id: 'lamp', x: xt, y: 14 + small, r: small, label: 'ФОНАРЬ', on: !!p.lamp, down: () => vtap('KeyL') });
  add({ id: 'mode', x: xt - small * 2.3, y: 14 + small, r: small, label: 'РЕЖИМ', down: () => vtap('KeyV') }, WEAPONS[p.gun.t].modes.length > 1);
  // по обстановке: F (дверь, подъём раненого — держать, стол, грузовик, медик), G — выбить дверь
  const use = touchUseLabel(p);
  const yb = VH - R - 14;
  add({ id: 'use', x: VW / 2 - R * 1.2, y: yb, r: R, label: use || 'ДЕЙСТВ.', hold: 'KeyF', on: !!keys.KeyF }, !!use);
  add({ id: 'kick', x: VW / 2 + R * 1.2, y: yb, r: R, label: 'ВЫБИТЬ', down: () => vtap('KeyG') }, !!doorNear(p));
  return touchLayout(B);
}

// Положения, выбранные игроком (настройка кнопок), — поверх стандартных; кнопка целиком на экране
function touchLayout(B) {
  for (const b of B) {
    const L = TouchUI.layout[b.id];
    if (L) { b.x = L[0] * VW; b.y = L[1] * VH; }
    b.x = clamp(b.x, b.r + 2, VW - b.r - 2); b.y = clamp(b.y, b.r + 2, VH - b.r - 2);
  }
  return B;
}
const saveLayout = () => {
  try {
    localStorage.setItem('pcr-touch-layout', JSON.stringify(TouchUI.layout));
    localStorage.setItem('pcr-touch-hidden', JSON.stringify([...TouchUI.hidden]));
  } catch (e) { /* ignore */ }
};
try { TouchUI.layout = JSON.parse(localStorage.getItem('pcr-touch-layout') || '{}') || {}; } catch (e) { TouchUI.layout = {}; }
// убранные кнопки (настройка: значок ✕ / + в углу); меню ≡ не убирается — иначе до настройки не добраться
try { TouchUI.hidden = new Set(JSON.parse(localStorage.getItem('pcr-touch-hidden') || '[]')); } catch (e) { TouchUI.hidden = new Set(); }
// Значок «убрать / вернуть» у кнопки в настройке — правый верхний угол
const hideBadge = (b) => ({ x: b.x + b.r * 0.72, y: b.y - b.r * 0.72, r: Math.max(11, b.r * 0.34) });
function toggleHidden(id) {
  if (id === 'menu') return;
  if (TouchUI.hidden.has(id)) TouchUI.hidden.delete(id); else TouchUI.hidden.add(id);
  saveLayout();
}

// Режим настройки раскладки: две служебные кнопки посередине (их не двигают)
function editControls() {
  const R = touchR();
  return [
    { id: 'editDone', x: VW / 2 - R * 1.5, y: VH / 2, r: R, label: 'ГОТОВО', down: () => { TouchUI.edit = false; touchReset(); } },
    { id: 'editReset', x: VW / 2 + R * 1.5, y: VH / 2, r: R, label: 'СБРОС', down: () => { TouchUI.layout = {}; TouchUI.hidden.clear(); saveLayout(); } },
  ];
}
function startLayoutEdit() { closeTouchMenu(); touchReset(); TouchUI.edit = true; }
// Одиночная игра стоит, пока открыто меню ≡ или настройка кнопок (в сети мир идёт у всех — не останавливаем)
const touchPaused = () => G.role === 'solo' && (TouchUI.edit || touchMenuOpen());      // меню — и на ПК (Esc)

// ---------- Касания (координаты холста) ----------
function touchStart(id, x, y) {
  if (keys.Tab) { keys.Tab = false; return; }                  // характеристики оружия закрываются касанием
  if (!inGame()) return;
  const S = TouchUI.sticks, R = touchR();
  const hit = (q) => Math.hypot(q.x - x, q.y - y) <= q.r * 1.15;
  if (TouchUI.edit) {
    // настройка: «Готово» / «Сброс» — нажать, значок в углу кнопки — убрать / вернуть её, остальное — тащить
    const c = editControls().find(hit);
    if (c) { c.down(); return; }
    const all = touchButtons(true).reverse();      // сверху нарисована последняя (НОЖ и КАМЕРА, ПРИСЕД и РУЧНИК — на одном месте)
    const hb = all.find((q) => q.id !== 'menu' && Math.hypot(hideBadge(q).x - x, hideBadge(q).y - y) <= hideBadge(q).r * 1.2);
    if (hb) { toggleHidden(hb.id); return; }
    const d = all.find(hit);
    if (d) TouchUI.drag.set(id, { bid: d.id, dx: d.x - x, dy: d.y - y });
    return;
  }
  const b = touchButtons().find(hit);
  if (b) {
    TouchUI.held.set(id, b);
    if (b.zoom) { touchZoom(b.zoom); b.at = G.time + 0.35; }          // держать — дальше по шагу (touchFrame)
    else if (b.fire) { TouchUI.btnFire = true; mouse.lPressed = true; }
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
  const dr = TouchUI.drag.get(id);
  if (dr) { TouchUI.layout[dr.bid] = [clamp((x + dr.dx) / VW, 0, 1), clamp((y + dr.dy) / VH, 0, 1)]; return; }
  const S = TouchUI.sticks, RS = touchR() * TOUCH.stickK;
  for (const kind of ['move', 'aim']) {
    const s = S[kind];
    if (!s || s.id !== id) continue;
    // стик стоит на месте, где его поставили (за пальцем не тянется): дальше кольца — бег / огонь
    const dx = x - s.ox, dy = y - s.oy, d = Math.hypot(dx, dy);
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
  if (TouchUI.drag.has(id)) { TouchUI.drag.delete(id); saveLayout(); return; }
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
function touchFrame(dt = 1 / 60) {
  if (!TouchUI.on) return;
  const p = me();
  if (!p || !inGame()) { mouse.l = mouse.r = false; return; }
  const z = G.zoom, L = VH * (TouchUI.ads ? TOUCH.aimDistAds : TOUCH.aimDist);
  // точка прицела — от центра бойца: угол взгляда (controlLocal) ровно тот, что у стика (с ассистом)
  const { x: sx, y: sy } = worldToScreen(p.x, p.y);
  // стик — в осях экрана; при повёрнутой камере (в машине) угол в мире — с поворотом
  if (lookCam(p)) {
    // камера по взгляду: поворот — в lookAim (через mouse.dx, как мышь), прицел — на линии взгляда над бойцом
    const s = TouchUI.sticks.aim, RS = touchR() * TOUCH.stickK;
    let turn = 0;
    if (s) {                     // и раненым: ползком тоже поворачивается (стрелять нельзя — crawl)
      const k = clamp((s.x - s.ox) / RS, -1, 1);
      if (Math.abs(k) > TOUCH.lookDead) turn = Math.sign(k) * k * k * TOUCH.lookTurn * OPTS.turnK * dt;     // чувствительность — меню
    }
    turn += angDiff(aimAssist(p, p.a), p.a) * Math.min(1, dt * TOUCH.lookAssist);
    mouse.dx = (mouse.dx || 0) + turn / CAM.turn;
    mouse.dy = 0;
    mouse.y = VH * (1 - CAM.bottom) - L;
  } else {
    const r = G.camRot || 0, a = aimAssist(p, Math.atan2(TouchUI.aim.y, TouchUI.aim.x) - r) + r;
    mouse.x = sx + Math.cos(a) * L;
    mouse.y = sy + Math.sin(a) * L;
  }
  for (const b of TouchUI.held.values()) if (b.zoom && G.time >= b.at) { touchZoom(b.zoom); b.at = G.time + 0.12; }
  mouse.l = !TouchUI.edit && (TouchUI.stickFire || TouchUI.btnFire);
  mouse.r = TouchUI.ads && !TouchUI.sprint;
}

// Аим ассист: угол взгляда a0 (по стику) → ближе к видимому противнику у этой линии (TOUCH.assist[OPTS.assist])
function aimAssist(p, a0) {
  const A = TOUCH.assist[OPTS.assist];
  if (!A || p.down || p.dead || !(TouchUI.sticks.aim || TouchUI.btnFire)) return a0;
  let best = null, bk = 0;
  for (const e of foesOf(p)) {
    if (e.dead || e.down || !enemyShown(e)) continue;          // только тех, кого игрок видит на экране
    const head = Math.abs(e.lean || 0) > 0.25 && e.lx !== undefined;  // высунулся из-за угла — тянуть к голове
    const tx = head ? e.lx : e.x, ty = head ? e.ly : e.y;
    const d = Math.hypot(tx - p.x, ty - p.y);
    if (d > A.range || d < 1) continue;
    const off = angDiff(Math.atan2(ty - p.y, tx - p.x), a0);
    const lim = Math.min(A.maxA, Math.atan2(A.width, d));       // «окно»: вбок не дальше width м
    if (Math.abs(off) >= lim) continue;
    const r = Math.max(0, (Math.abs(off) / lim - A.full) / (1 - A.full)), k = A.pull * (1 - r * r);
    if (k > bk) { bk = k; best = off; }
  }
  return best === null ? a0 : a0 + best * bk;
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
    else if (!me()?.down) ring(x, y, RS * TOUCH.fireAt, null, TouchUI.stickFire ? 'rgba(255,80,64,0.9)' : 'rgba(255,80,64,0.3)', 1.5);
    if (s) {
      const dx = s.x - s.ox, dy = s.y - s.oy, d = Math.hypot(dx, dy), k = d > RS ? RS / d : 1;
      ring(x + dx * k, y + dy * k, R * 0.6, 'rgba(232,228,216,0.35)', 'rgba(232,228,216,0.6)');
    } else {
      ctx.font = `${Math.round(R * 0.3)}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(232,228,216,0.6)';
      const fire = me()?.down ? '' : ' · ОГОНЬ';    // раненый не стреляет — только взгляд
      ctx.fillText(kind === 'move' ? 'ДВИЖЕНИЕ' : (lookCam(me()) ? '◀ ПОВОРОТ ▶' : 'ВЗГЛЯД') + fire, x, y + 4);
    }
  };
  const p = me(), edit = TouchUI.edit;
  if (G.state === 'play' && p && !p.dead && !edit) {
    stick(S.move, RS + 24, VH - RS - 24, 'move');
    stick(S.aim, VW - RS * 2.6 - 40, VH - RS - 24, 'aim');      // и раненым — смотреть / поворачиваться
  }
  ctx.globalAlpha = 1;
  if (edit) {
    // настройка раскладки: экран притемнён, кнопки — с пунктирной рамкой (их тащат), посередине «Готово» / «Сброс»
    ctx.fillStyle = 'rgba(8,9,10,0.55)'; ctx.fillRect(0, 0, VW, VH);
    txt('НАСТРОЙКА КНОПОК: перетащите пальцем', VW / 2, VH / 2 - R * 1.6, Math.round(R * 0.42), HUD_WARN, 'center');
    txt('✕ в углу — убрать кнопку, + — вернуть', VW / 2, VH / 2 - R * 1.6 + Math.round(R * 0.5), Math.round(R * 0.32), HUD_DIM, 'center');
  }
  const dragging = new Set([...TouchUI.drag.values()].map((d) => d.bid));
  const list = touchButtons();
  if (edit) list.push(...editControls().map((c) => ({ ...c, ctl: true })));
  for (const b of list) {
    const pressedNow = [...TouchUI.held.values()].some((q) => q.id === b.id) || dragging.has(b.id);
    ctx.globalAlpha = b.off ? 0.35 : 1;          // убранная (видна только в настройке)
    ring(b.x, b.y, b.r, b.on || pressedNow ? 'rgba(255,176,48,0.35)' : 'rgba(15,16,17,0.45)', b.fire ? 'rgba(255,80,64,0.7)' : 'rgba(232,228,216,0.4)');
    if (edit && !b.ctl) {
      ctx.setLineDash([5, 4]);
      ring(b.x, b.y, b.r + 4, null, dragging.has(b.id) ? 'rgba(255,176,48,0.9)' : 'rgba(255,176,48,0.5)', 1.5);
      ctx.setLineDash([]);
      if (b.id !== 'menu') {
        // значок в углу: ✕ — убрать, + — вернуть
        const h = hideBadge(b);
        ctx.globalAlpha = 1;
        ring(h.x, h.y, h.r, b.off ? 'rgba(60,150,80,0.9)' : 'rgba(170,45,35,0.9)', 'rgba(232,228,216,0.8)', 1.5);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, h.r * 0.2);
        const s = h.r * 0.45;
        ctx.beginPath();
        if (b.off) { ctx.moveTo(h.x - s, h.y); ctx.lineTo(h.x + s, h.y); ctx.moveTo(h.x, h.y - s); ctx.lineTo(h.x, h.y + s); }
        else { ctx.moveTo(h.x - s, h.y - s); ctx.lineTo(h.x + s, h.y + s); ctx.moveTo(h.x + s, h.y - s); ctx.lineTo(h.x - s, h.y + s); }
        ctx.stroke();
        ctx.globalAlpha = b.off ? 0.35 : 1;
      }
    }
    if (b.icon) { camIcon(b.x, b.y, b.r, b.icon === 'in'); ctx.globalAlpha = 1; continue; }
    ctx.textAlign = 'center';
    const fs = Math.round(clamp(b.r * (b.label.length > 6 ? 0.26 : b.label.length > 3 ? 0.32 : 0.6), 9, 30));
    ctx.font = `${fs}px Consolas, monospace`;
    ctx.fillStyle = b.on ? '#ffd890' : '#e8e4d8';
    ctx.fillText(b.label, b.x, b.y + (b.sub ? 0 : fs * 0.35));
    if (b.sub) {
      ctx.font = `${Math.round(fs * 0.75)}px Consolas, monospace`; ctx.fillStyle = 'rgba(232,228,216,0.6)';
      ctx.fillText(b.sub, b.x, b.y + fs);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

// Пиктограмма камеры со стрелкой: вверх — приблизить, вниз — отдалить
function camIcon(x, y, r, up) {
  const s = r / 22;
  ctx.save();
  ctx.translate(x - 4 * s, y);
  ctx.strokeStyle = '#e8e4d8'; ctx.fillStyle = '#e8e4d8'; ctx.lineWidth = Math.max(1.2, 1.6 * s);
  ctx.lineJoin = 'round';
  // корпус, выступ видоискателя, объектив
  ctx.beginPath();
  ctx.moveTo(-9 * s, -5 * s); ctx.lineTo(-4 * s, -5 * s); ctx.lineTo(-2.5 * s, -8 * s); ctx.lineTo(2.5 * s, -8 * s); ctx.lineTo(4 * s, -5 * s);
  ctx.lineTo(9 * s, -5 * s); ctx.lineTo(9 * s, 7 * s); ctx.lineTo(-9 * s, 7 * s); ctx.closePath();
  ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 1 * s, 3.6 * s, 0, Math.PI * 2); ctx.stroke();
  // стрелка справа от камеры
  ctx.translate(15 * s, 0);
  const d = up ? -1 : 1;
  ctx.beginPath(); ctx.moveTo(0, -7 * d * s); ctx.lineTo(0, 7 * d * s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4 * s, 3 * d * s); ctx.lineTo(0, 7.5 * d * s); ctx.lineTo(4 * s, 3 * d * s); ctx.stroke();
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
  syncOptsUI();
  touchMenuEl.classList.remove('hidden');
  for (const k of ['KeyQ', 'KeyE', 'KeyB', 'KeyF']) if (keys[k]) vkey(k, false);
  touchReset();
}
// Настройки в меню: галочки, переключатели; чувствительность поворота и прицел — только в камере по взгляду
function syncOptsUI() {
  const q = (id) => touchMenuEl.querySelector(id);
  q('#tmuFps').checked = OPTS.fps60;
  q('#tmuLight').checked = OPTS.simpleLight;
  for (const m of ['soft', 'hard']) q('#tmuAssist-' + m).classList.toggle('on', OPTS.assist === m);
  for (const m of ['std', 'look']) q('#tmuCam-' + m).classList.toggle('on', OPTS.cam === m);
  q('#tmuSight').textContent = `${sightM()} м`;
  const look = OPTS.cam === 'look';
  q('#tmuTurnRow').classList.toggle('hidden', !look);
  q('#tmuAimRow').classList.toggle('hidden', !look);
  q('#tmuTurn').value = String(OPTS.turnK);
  q('#tmuTurnV').textContent = '×' + OPTS.turnK.toFixed(2).replace('.', ',');
  q('#tmuAim-cross').classList.toggle('on', !OPTS.laser);
  q('#tmuAim-laser').classList.toggle('on', !!OPTS.laser);
}
// Закрыть меню; relock — на ПК в камере по взгляду снова захватить мышь (только по щелчку кнопки: захват из обработчика Esc
// тот же Esc у браузера тут же снимает → меню открывалось снова). Без него мышь захватит первый щелчок по игре (без выстрела).
const closeTouchMenu = (relock = false) => {
  if (!touchMenuEl || !touchMenuOpen()) return;
  touchMenuEl.classList.add('hidden');
  G.menuClosedAt = performance.now();
  if (relock === true && !TouchUI.on && inGame() && lookCam(me()) && document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
};
function touchZoom(k) {
  G.viewT = clamp(G.viewT * k, CAM.viewMin, CAM.viewMax);
  try { localStorage.setItem(VIEW_KEY, G.viewT.toFixed(1)); } catch (e) { /* ignore */ }
  if (touchMenuEl) touchMenuEl.querySelector('#tmuView').textContent = `${Math.round(G.viewT)} м`;
}
function touchFullscreen() {
  const el = document.documentElement;
  try {
    const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen && el.webkitRequestFullscreen();
    if (r && r.then) r.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
  } catch (e) { /* iPhone: нет полноэкранного режима — играем как есть */ }
}
// Кнопка «Назад» в приложении (dev/android, MainActivity.onBackPressed): true — обработала игра, false — свернуть приложение.
// Открыто меню или окно (стол, грузовик) — закрыть; в игре — меню ≡; в лобби — выйти в главное меню.
function appBack() {
  if (TouchUI.edit) { TouchUI.edit = false; touchReset(); return true; }
  if (touchMenuOpen()) { closeTouchMenu(); return true; }
  if (loadoutOpen()) { closeLoadout(); return true; }
  if (truckMenuOpen()) { closeTruckMenu(); return true; }
  if (keys.Tab) { keys.Tab = false; return true; }
  if (inGame() && touchMenuEl) { openTouchMenu(); return true; }
  if (G.state === 'lobby') { leaveToMenu(''); return true; }
  return false;
}

function touchReset() {
  TouchUI.held.clear();
  TouchUI.drag.clear();
  TouchUI.sticks.move = TouchUI.sticks.aim = null;
  TouchUI.mv = null; TouchUI.sprint = TouchUI.stickFire = TouchUI.btnFire = false;
}

// Игровое меню — и на телефоне (≡, «Назад»), и на ПК (Esc)
{
  touchMenuEl = document.getElementById('touchMenu');
  const on = (id, fn) => touchMenuEl.querySelector(id).addEventListener('click', fn);
  on('#tmuResume', () => closeTouchMenu(true));
  on('#tmuAgain', () => { closeTouchMenu(); vtap('Enter'); });
  on('#tmuHub', () => { closeTouchMenu(); vtap('Backspace'); });
  on('#tmuOut', () => touchZoom(CAM.wheelStep));
  on('#tmuIn', () => touchZoom(1 / CAM.wheelStep));
  on('#tmuSpecs', () => { closeTouchMenu(); keys.Tab = true; });
  on('#tmuLayout', startLayoutEdit);
  on('#tmuMic', () => { closeTouchMenu(); vtap('KeyM'); });
  on('#tmuFull', () => { closeTouchMenu(); touchFullscreen(); });
  touchMenuEl.querySelector('#tmuFps').addEventListener('change', (e) => { OPTS.fps60 = e.target.checked; saveOpts(); });
  touchMenuEl.querySelector('#tmuLight').addEventListener('change', (e) => { OPTS.simpleLight = e.target.checked; saveOpts(); });
  for (const m of ['soft', 'hard']) on('#tmuAssist-' + m, () => { OPTS.assist = m; saveOpts(); syncOptsUI(); });
  // камера из меню: мышь не захватывать сейчас (меню открыто) — захватит закрытие меню
  for (const m of ['std', 'look']) on('#tmuCam-' + m, () => { setCamMode(m, true); syncOptsUI(); });
  touchMenuEl.querySelector('#tmuTurn').addEventListener('input', (e) => { OPTS.turnK = clamp(+e.target.value || 1, TURN_K.min, TURN_K.max); saveOpts(); syncOptsUI(); });
  on('#tmuAim-cross', () => { OPTS.laser = false; saveOpts(); syncOptsUI(); });
  on('#tmuAim-laser', () => { OPTS.laser = true; saveOpts(); syncOptsUI(); });
  on('#tmuSightDn', () => { stepSight(-1); syncOptsUI(); });
  on('#tmuSightUp', () => { stepSight(1); syncOptsUI(); });
  on('#tmuLeave', () => { touchMenuEl.classList.add('hidden'); leaveToMenu(''); });
  // ПК: Esc в игре — открыть / закрыть меню (окна стола и грузовика закрываются своим Esc раньше)
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || !inGame()) return;
    if (touchMenuOpen()) { if (performance.now() - (G.lockMenuAt || 0) > 400) closeTouchMenu(); }   // только что открыло снятие захвата — тот же Esc
    else if (!uiOpen()) openTouchMenu();
  });
  // ПК, камера по взгляду: Esc снимает захват мыши (сам Esc браузер игре может и не передать) — тогда сразу меню
  document.addEventListener('pointerlockchange', () => {
    // только что закрыли меню (захват мог сняться тем же нажатием) — не открывать снова
    const justClosed = performance.now() - (G.menuClosedAt || -1e9) < 500;
    if (!document.pointerLockElement && !TouchUI.on && inGame() && G.state === 'play' && lookCam(me()) && !uiOpen() && !G.lockDrop && !justClosed) {
      openTouchMenu(); G.lockMenuAt = performance.now();
    }
    G.lockDrop = false;
  });
}

if (TouchUI.on) {
  const k =() => VW / Math.max(1, innerWidth);
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
