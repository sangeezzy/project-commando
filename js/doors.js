'use strict';
// ---------- Двери и ключи ----------
// Закрытая дверь — клетка T.DOOR: не пройти, не видно, держит свет и звук шагов; пуля — по материалу двери.
// Открытая или выбитая — обычный пол, створка рисуется сбоку и не мешает.
// Запертую дверь отпирают ключом (F) или выбивают (G), если тип позволяет (бронированную — только ключом).

function initDoors() {
  map.doors = [];
  map.doorAt = new Map();
  map.keys = [];
  for (const e of map.ents) {
    if (e.kind === 'door') {
      const T_ = DOOR_TYPES[e.type];
      const i = e.y * map.w + e.x;
      // створка поперёк прохода: стены слева-справа — проход вертикальный, створка горизонтальная
      const horiz = tileAt(e.x - 1, e.y) === T.WALL && tileAt(e.x + 1, e.y) === T.WALL;
      // открывается внутрь помещения
      const inside = horiz
        ? (map.fl[(e.y + 1) * map.w + e.x] === FM.INDOOR ? 1 : -1)
        : (map.fl[e.y * map.w + e.x + 1] === FM.INDOOR ? 1 : -1);
      const d = {
        id: map.doors.length, x: e.x, y: e.y, i, type: e.type, name: T_.name,
        key: e.key || null, locked: !!e.key, open: !!e.open, broken: false,
        ang: e.open ? 1 : 0, horiz, swing: inside, cx: (e.x + 0.5) * TILE, cy: (e.y + 0.5) * TILE,
      };
      map.doors.push(d);
      map.doorAt.set(i, d);
    } else if (e.kind === 'key') {
      map.keys.push({ id: e.id, name: e.name, x: e.x * TILE, y: e.y * TILE, taken: false, color: KEY_COLORS[e.id] || '#d0b030' });
    }
  }
}

const doorPassable = (d) => d.open || d.broken;
// Подсказка конкретному игроку (у каждого свой экран)
const tell = (p, text) => { if (p && !p.ai) emit(['toast', p.id, text]); };

// Клетка двери поменялась: пути, свет
function syncDoorTile(d) {
  map.grid[d.i] = doorPassable(d) ? T.FLOOR : T.DOOR;
  map.ver++;
  fieldCache.clear();
  buildLightMap(map.lightBase);
}

// Кто-то стоит в проёме — закрыть нельзя
function doorBlocked(d) {
  for (const o of [...G.players, ...G.enemies]) {
    if (o.dead) continue;
    const cx = clamp(o.x, d.x * TILE, d.x * TILE + TILE), cy = clamp(o.y, d.y * TILE, d.y * TILE + TILE);
    if (Math.hypot(o.x - cx, o.y - cy) < PR) return true;
  }
  return false;
}

function openDoor(d, by) {
  if (d.locked || doorPassable(d)) return false;
  d.open = true;
  syncDoorTile(d);
  emit(['door', d.cx, d.cy, 'open', d.type]);
  if (by) makeNoise(d.cx, d.cy, M(NOISE.door), 'step', by);
  return true;
}

function closeDoor(d, by) {
  if (d.broken || !d.open) return false;
  if (doorBlocked(d)) return false;
  d.open = false;
  syncDoorTile(d);
  emit(['door', d.cx, d.cy, 'close', d.type]);
  if (by) makeNoise(d.cx, d.cy, M(NOISE.door), 'step', by);
  return true;
}

function unlockDoor(d) {
  if (!d.locked) return false;
  d.locked = false;
  emit(['door', d.cx, d.cy, 'unlock', d.type]);
  return true;
}

// Удар ногой. Возвращает: 'open' — распахнул незапертую, 'broke' — выбил, 'hold' — устояла, 'never' — не выбить
function kickDoor(d, by) {
  if (doorPassable(d)) return 'none';
  const bang = (r) => { makeNoise(d.cx, d.cy, M(r), 'bang', by); };
  if (!d.locked) {
    d.open = true; d.ang = Math.max(d.ang, 0.4);
    syncDoorTile(d);
    emit(['door', d.cx, d.cy, 'slam', d.type]);
    bang(NOISE.kickNear);
    return 'open';
  }
  const chance = DOOR_TYPES[d.type].kick;
  if (chance <= 0) {
    emit(['door', d.cx, d.cy, 'thud', d.type]);
    bang(NOISE.kick * 0.6);
    return 'never';
  }
  if (Math.random() < chance) {
    d.locked = false; d.open = true; d.ang = Math.max(d.ang, 0.4);
    // деревянная слетает с петель, у металлической выломан замок
    if (d.type === 'wood') d.broken = true;
    syncDoorTile(d);
    emit(['door', d.cx, d.cy, 'break', d.type]);
    bang(NOISE.kick);
    return 'broke';
  }
  emit(['door', d.cx, d.cy, 'thud', d.type]);
  bang(NOISE.kick);
  return 'hold';
}

// Дверь, с которой боец может что-то сделать: ближайшая в пределах досягаемости, лучше та, что впереди
function doorNear(o) {
  let best = null, bs = 1e9;
  for (const d of map.doors) {
    const dist = Math.hypot(d.cx - o.x, d.cy - o.y);
    if (dist > DOOR.reach) continue;
    const off = Math.abs(angDiff(Math.atan2(d.cy - o.y, d.cx - o.x), o.a));
    const s = dist + off * TILE * 0.6;
    if (s < bs) { bs = s; best = d; }
  }
  return best;
}

// Что подсказать игроку у двери
function doorPrompt(p, d) {
  const hasKey = d.key && p.keys && p.keys.has(d.key);
  const lines = [];
  if (d.broken) lines.push('Дверь выбита');
  else if (d.open) lines.push('F — закрыть');
  else if (!d.locked) lines.push('F — открыть');
  else if (hasKey) lines.push(`F — отпереть (${keyName(d.key)})`);
  else lines.push(`Заперто${d.key ? ': нужен ' + keyName(d.key).toLowerCase() : ''}`);
  if (!doorPassable(d)) lines.push(DOOR_TYPES[d.type].kick > 0 || !d.locked ? 'G — выбить' : 'выбить нельзя');
  return { title: d.name[0].toUpperCase() + d.name.slice(1), lines };
}

const keyName = (id) => { const k = map.keys.find((q) => q.id === id); return k ? k.name : 'ключ'; };

// ---------- Действия игрока у двери ----------
function useDoor(p, d) {
  if (p.act) return;
  if (d.broken) return;
  if (d.open) { if (!closeDoor(d, p)) tell(p, 'Мешают закрыть'); return; }
  if (!d.locked) { openDoor(d, p); return; }
  if (p.keys && p.keys.has(d.key)) { p.act = { kind: 'unlock', d, t: 0, dur: DOOR.unlock }; emit(['door', d.cx, d.cy, 'key', d.type]); return; }
  emit(['door', d.cx, d.cy, 'rattle', d.type]);
  makeNoise(d.cx, d.cy, M(NOISE.lockRattle), 'step', p);
  tell(p, 'Заперто');
}

function startKick(p, d) {
  if (p.act || doorPassable(d)) return;
  p.act = { kind: 'kick', d, t: 0, dur: DOOR.kick, hit: false };
}

// Ход действий бойца (отпирание, удар). Возвращает true, пока боец занят.
function updateAct(p, dt) {
  const a = p.act;
  if (!a) return false;
  a.t += dt;
  // отошёл от двери — бросил
  if (Math.hypot(a.d.cx - p.x, a.d.cy - p.y) > DOOR.reach + M(0.4)) { p.act = null; return false; }
  if (a.kind === 'unlock' && a.t >= a.dur) {
    unlockDoor(a.d);
    openDoor(a.d, p);
    tell(p, 'Отперто');
    p.act = null;
  } else if (a.kind === 'kick') {
    if (!a.hit && a.t >= DOOR.kickHit) {
      a.hit = true;
      G.shake = Math.max(G.shake, 3);
      const r = kickDoor(a.d, p);
      if (r === 'never') tell(p, 'Не выбить — нужен ключ');
      else if (r === 'hold') tell(p, 'Дверь выдержала');
      else if (r === 'broke') tell(p, 'Дверь выбита');
    }
    if (a.t >= a.dur) p.act = null;
  }
  return !!p.act;
}

// ---------- Ключи ----------
function updateKeys() {
  for (const k of map.keys) {
    if (k.taken) continue;
    for (const p of G.players) {
      if (p.ai || p.dead || Math.hypot(k.x - p.x, k.y - p.y) > M(0.9)) continue;
      k.taken = true;
      p.keys = p.keys || new Set();
      p.keys.add(k.id);
      emit(['key', k.x, k.y]);
      tell(p, 'Подобран: ' + k.name.toLowerCase());
      break;
    }
  }
}

// Анимация створок
function updateDoors(dt) {
  for (const d of map.doors) d.ang = approach(d.ang, doorPassable(d) ? 1 : 0, dt, DOOR.anim / 3);
}

// ---------- ИИ: открыть закрытую незапертую дверь на пути ----------
// Возвращает true, если боец сейчас возится с дверью (идти не надо)
function aiDoorAhead(e, ang, dt) {
  // прямо по ходу или чуть в сторону (подход к двери наискосок)
  let tx = -1, ty = -1;
  for (const da of [0, 0.6, -0.6]) {
    const px = e.x + Math.cos(ang + da) * (PR + 10), py = e.y + Math.sin(ang + da) * (PR + 10);
    const x = Math.floor(px / TILE), y = Math.floor(py / TILE);
    if (tileAt(x, y) === T.DOOR) { tx = x; ty = y; break; }
  }
  if (tx < 0) { e.doorT = 0; return false; }
  const d = map.doorAt.get(ty * map.w + tx);
  if (!d || d.locked) return false;
  e.doorT = (e.doorT || 0) + dt;
  e.want = Math.atan2(d.cy - e.y, d.cx - e.x);
  if (e.doorT >= DOOR.aiOpen) { openDoor(d, e); e.doorT = 0; }
  return true;
}
