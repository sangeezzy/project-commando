'use strict';
// ---------- Тайлы, конструктор карт, коллизии, видимость, пути ----------
// Основа взята из прототипа Commando (archive/commando/js/world.js), материалы — реалистичные.

// Тип тайла: стена (не видно, не пройти), низкое укрытие (~1 м: видно поверх, присев — спрятаться)
const T = { FLOOR: 0, WALL: 1, LOW: 2, DOOR: 3 };   // DOOR — закрытая дверь (открытая — это FLOOR)
// Материал пола
const FM = { ASPHALT: 1, CONCRETE: 2, DIRT: 3, GRAVEL: 4, INDOOR: 5 };
const FLOOR_COL = {
  [FM.ASPHALT]: ['#3a3c3e', '#38393b'], [FM.CONCRETE]: ['#5d5f5b', '#5a5c58'], [FM.DIRT]: ['#5a4d3a', '#574a38'],
  [FM.GRAVEL]: ['#4f4c46', '#4c4943'], [FM.INDOOR]: ['#6b6257', '#675e53'],
};

// ---------- Конструктор карты (детерминированный) ----------
class MapBuilder {
  constructor(w, h, seed) {
    this.w = w; this.h = h;
    this.grid = new Uint8Array(w * h).fill(T.WALL);
    this.fl = new Uint8Array(w * h);
    this.wm = new Uint8Array(w * h).fill(WM.CONCRETE);
    this.light = new Float32Array(w * h).fill(1);   // освещённость клетки
    this.ents = [];
    this.rng = makeRng(seed);
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, t, m) {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.grid[i] = t;
    if (t === T.FLOOR) this.fl[i] = m; else this.wm[i] = m;
  }
  fill(x0, y0, x1, y1, fm) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, T.FLOOR, fm); }
  // пол под стенами тоже запоминаем: если стену пробьют насквозь, рисовать будет нечего, но так проще
  wall(x0, y0, x1, y1, wm) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, T.WALL, wm); }
  // Здание: стены по периметру, пол внутри, двери — проёмы
  box(x0, y0, x1, y1, wm, fm, doors = []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x === x0 || x === x1 || y === y0 || y === y1) this.set(x, y, T.WALL, wm); else this.set(x, y, T.FLOOR, fm);
    }
    for (const [dx, dy] of doors) this.set(dx, dy, T.FLOOR, fm);
  }
  low(x0, y0, x1, y1, wm) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!this.inside(x, y) || this.grid[y * this.w + x] !== T.FLOOR) continue;
      this.grid[y * this.w + x] = T.LOW; this.wm[y * this.w + x] = wm;
    }
  }
  // Предмет из нескольких клеток (машина, контейнер) — рисуется целиком, а не по клеткам
  prop(kind, x0, y0, x1, y1, props = {}) {
    const wm = kind === 'car' ? WM.CAR : kind === 'table' ? WM.TABLE : WM.CONTAINER;
    if (kind === 'car' || kind === 'table') this.low(x0, y0, x1, y1, wm); else this.wall(x0, y0, x1, y1, wm);
    this.ents.push({ kind, x0, y0, x1, y1, ...props });
  }
  // Освещённость прямоугольника (помещения): 1 — день, 0 — темнота
  dark(x0, y0, x1, y1, v) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.inside(x, y)) this.light[y * this.w + x] = v; }
  ent(kind, x, y, props = {}) { this.ents.push({ kind, x, y, ...props }); }
  // Дверь в проёме (клетка x, y). type — wood | metal | armored, key — id ключа (дверь заперта), open — открыта на старте
  door(x, y, type, props = {}) {
    const i = y * this.w + x;
    if (!this.fl[i]) this.fl[i] = FM.INDOOR;
    this.wm[i] = DOOR_TYPES[type].wm;
    this.grid[i] = props.open ? T.FLOOR : T.DOOR;
    this.ents.push({ kind: 'door', x, y, type, ...props });
  }
  // Ключ на полу (клетка x, y): id — какой двери, name — как называется
  key(id, x, y, name) { this.ents.push({ kind: 'key', id, x: x + 0.5, y: y + 0.5, name }); }
  enemy(x, y, props = {}) { this.ents.push({ kind: 'enemy', x: x + 0.5, y: y + 0.5, ...props }); }
}

// ---------- Текущая карта ----------
let map = null;

function finishMap(mb, meta) {
  const ents = mb.ents.map((e, i) => ({ ...e, eid: i }));
  map = { w: mb.w, h: mb.h, grid: mb.grid, fl: mb.fl, wm: mb.wm, ents, ver: 0, ...meta };
  initDoors();
  map.canvas = renderMapCanvas();
  map.lightBase = mb.light;
  buildLightMap(mb.light);
  return map;
}

const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? T.WALL : map.grid[ty * map.w + tx]);
const wmAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? WM.CONCRETE : map.wm[ty * map.w + tx]);
const solidTile = (tx, ty) => tileAt(tx, ty) !== T.FLOOR;
const opaqueTile = (tx, ty) => { const t = tileAt(tx, ty); return t === T.WALL || t === T.DOOR; };
const opaqueT = (t) => t === T.WALL || t === T.DOOR;
// Можно пройти: пол; с doors — ещё и закрытая незапертая дверь (её откроют по пути)
function walkable(tx, ty, doors) {
  const t = tileAt(tx, ty);
  if (t === T.FLOOR) return true;
  if (!doors || t !== T.DOOR) return false;
  const d = map.doorAt.get(ty * map.w + tx);
  return !!d && (!d.locked || (doors === 'breach' && DOOR_TYPES[d.type].kick > 0));
}
const solidAt = (x, y) => solidTile(Math.floor(x / TILE), Math.floor(y / TILE));
const opaqueAt = (x, y) => opaqueTile(Math.floor(x / TILE), Math.floor(y / TILE));
const tileIndex = (x, y) => Math.floor(y / TILE) * map.w + Math.floor(x / TILE);

// ---------- Отрисовка карты один раз в canvas ----------
// Неподвижная часть карты (пол, разметка, тени, укрытия, стены, контейнеры, стол) — кусками MAP_CHUNK × MAP_CHUNK px, по требованию:
// рисуется только видимое, в памяти — не больше MAP_CHUNK_KEEP кусков (давно не нужные выбрасываются). Большая карта (автодром 200 × 130 м —
// 6400 × 4160 px, ~100 МБ одной картинкой) так и в память влезает, и рисуется быстрее. Мелкие детали (шум покрытия, сколы) — от координат
// клетки (makeRng на клетку), поэтому куски стыкуются без швов и одинаковы при каждой перерисовке.
const MAP_CHUNK = 1024, MAP_CHUNK_KEEP = 20;
const tileRng = (x, y, k = 0) => makeRng(((x * 73856093) ^ (y * 19349663) ^ (k * 83492791) ^ (map.w * 7919)) >>> 0);
function renderMapCanvas() {
  map.chunks = new Map();
  map.chunkT = 0;
  return { width: map.w * TILE, height: map.h * TILE };   // размеры «картинки» (для совместимости: map.canvas.width / height)
}
function mapChunk(cx, cy) {
  const key = cy * 4096 + cx;
  let ch = map.chunks.get(key);
  if (!ch) {
    ch = { c: renderMapChunk(cx, cy), t: 0 };
    map.chunks.set(key, ch);
    if (map.chunks.size > MAP_CHUNK_KEEP) {                // выбросить самый давно нужный
      let old = null;
      for (const [k, v] of map.chunks) if (k !== key && (!old || v.t < old[1].t)) old = [k, v];
      if (old) map.chunks.delete(old[0]);
    }
  }
  ch.t = ++map.chunkT;
  return ch.c;
}
// Нарисовать видимую часть карты (прямоугольник мира x0..x1, y0..y1) кусками; один соседний кусок — заранее (без рывка при прокрутке)
function drawMapView(g, x0, y0, x1, y1) {
  const W = map.w * TILE, H = map.h * TILE;
  const cx0 = Math.max(0, Math.floor(x0 / MAP_CHUNK)), cy0 = Math.max(0, Math.floor(y0 / MAP_CHUNK));
  const cx1 = Math.min(Math.ceil(W / MAP_CHUNK) - 1, Math.floor(x1 / MAP_CHUNK)), cy1 = Math.min(Math.ceil(H / MAP_CHUNK) - 1, Math.floor(y1 / MAP_CHUNK));
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) g.drawImage(mapChunk(cx, cy), cx * MAP_CHUNK, cy * MAP_CHUNK);
  for (let cy = cy0 - 1; cy <= cy1 + 1; cy++) for (let cx = cx0 - 1; cx <= cx1 + 1; cx++) {
    if (cx < 0 || cy < 0 || cx * MAP_CHUNK >= W || cy * MAP_CHUNK >= H || map.chunks.has(cy * 4096 + cx)) continue;
    if (map.chunks.size < MAP_CHUNK_KEEP) { mapChunk(cx, cy); return; }   // заготовить один за кадр (пока есть место)
  }
}
function renderMapChunk(cx, cy) {
  const X0 = cx * MAP_CHUNK, Y0 = cy * MAP_CHUNK;
  const c = document.createElement('canvas');
  c.width = Math.min(MAP_CHUNK, map.w * TILE - X0); c.height = Math.min(MAP_CHUNK, map.h * TILE - Y0);
  const g = c.getContext('2d');
  g.translate(-X0, -Y0);
  g.beginPath(); g.rect(X0, Y0, c.width, c.height); g.clip();
  g.fillStyle = '#2a2b2c';
  g.fillRect(X0, Y0, c.width, c.height);
  // клетки куска с запасом (тени и края стен заходят на соседние)
  const tx0 = Math.max(0, Math.floor(X0 / TILE) - 1), ty0 = Math.max(0, Math.floor(Y0 / TILE) - 1);
  const tx1 = Math.min(map.w - 1, Math.floor((X0 + c.width) / TILE) + 1), ty1 = Math.min(map.h - 1, Math.floor((Y0 + c.height) / TILE) + 1);
  // пол (и под низкими укрытиями)
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const i = y * map.w + x;
    if (map.grid[i] === T.WALL) continue;   // под дверью рисуем пол проёма
    const fm = map.fl[i] || FM.ASPHALT, rng = tileRng(x, y);
    const X = x * TILE, Y = y * TILE;
    g.fillStyle = FLOOR_COL[fm][(x * 3 + y * 5) % 2];
    g.fillRect(X, Y, TILE, TILE);
    if (fm === FM.CONCRETE || fm === FM.INDOOR) {
      // плиты 2×2 м / доски
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
      if (fm === FM.CONCRETE && !(x % 2) && !(y % 2)) g.strokeRect(X + 0.5, Y + 0.5, TILE * 2 - 1, TILE * 2 - 1);
      if (fm === FM.INDOOR) { g.beginPath(); g.moveTo(X, Y + 0.5); g.lineTo(X + TILE, Y + 0.5); g.moveTo(X, Y + 16.5); g.lineTo(X + TILE, Y + 16.5); g.stroke(); }
    }
    const n = fm === FM.GRAVEL ? 7 : fm === FM.DIRT ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const v = rng();
      g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.06)';
      const sz = fm === FM.GRAVEL ? 2 : 1 + (rng() * 2 | 0);
      g.fillRect(X + rng() * 30, Y + rng() * 30, sz, sz);
    }
  }
  const inChunk = (x0, y0, x1, y1) => x1 >= X0 - TILE && x0 <= X0 + c.width + TILE && y1 >= Y0 - TILE && y0 <= Y0 + c.height + TILE;
  // разметка на асфальте
  for (const e of map.ents) {
    if (e.kind !== 'stripe' || !inChunk(e.x * TILE, e.y * TILE, (e.x + (e.w || 0.15)) * TILE, (e.y + (e.h || 0.15)) * TILE)) continue;
    g.fillStyle = e.c || 'rgba(220,200,120,0.35)';
    g.fillRect(e.x * TILE, e.y * TILE, (e.w || 0.15) * TILE, (e.h || 0.15) * TILE);
  }
  // тени от стен и укрытий (солнце с северо-запада)
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const t = map.grid[y * map.w + x];
    if (t === T.FLOOR || t === T.DOOR || map.wm[y * map.w + x] === WM.CAR) continue;     // машины — со своей тенью (js/vehicle.js)
    const sh = t === T.WALL ? 10 : 5;
    g.fillRect(x * TILE + sh, y * TILE + sh, TILE, TILE);
  }
  // низкие укрытия по клеткам (машины рисуются отдельно)
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const i = y * map.w + x;
    if (map.grid[i] !== T.LOW || map.wm[i] === WM.CAR || map.wm[i] === WM.TABLE) continue;
    drawLowTile(g, x, y, map.wm[i], tileRng(x, y, 1));
  }
  // стены: верх + светлая кромка
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const i = y * map.w + x;
    if (map.grid[i] !== T.WALL || map.wm[i] === WM.CONTAINER) continue;
    drawWallTile(g, x, y, map.wm[i], tileRng(x, y, 2));
  }
  for (const e of map.ents) {
    if ((e.kind !== 'container' && e.kind !== 'table') || !inChunk(e.x0 * TILE, e.y0 * TILE, (e.x1 + 1) * TILE, (e.y1 + 1) * TILE)) continue;
    if (e.kind === 'container') drawContainer(g, e); else drawTable(g, e);
  }
  return c;
}

function drawWallTile(g, x, y, wm, rng) {
  const X = x * TILE, Y = y * TILE, m = MAT[wm];
  g.fillStyle = m.top;
  g.fillRect(X, Y, TILE, TILE);
  if (wm === WM.VOID) return;                       // за пределами карты — просто темнота
  const open = (nx, ny) => tileAt(nx, ny) !== T.WALL;
  g.fillStyle = 'rgba(255,255,255,0.12)';
  if (open(x, y - 1)) g.fillRect(X, Y, TILE, 3);
  if (open(x - 1, y)) g.fillRect(X, Y, 3, TILE);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  if (open(x, y + 1)) g.fillRect(X, Y + TILE - 3, TILE, 3);
  if (open(x + 1, y)) g.fillRect(X + TILE - 3, Y, 3, TILE);
  if (wm === WM.BRICK) {
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 1;
    g.beginPath();
    for (let k = 1; k < 4; k++) { g.moveTo(X, Y + k * 8 + 0.5); g.lineTo(X + TILE, Y + k * 8 + 0.5); }
    g.stroke();
  } else if (wm === WM.PLYWOOD) {
    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.beginPath(); g.moveTo(X + 16.5, Y); g.lineTo(X + 16.5, Y + TILE); g.stroke();
  } else if (wm === WM.STACK) {
    g.strokeStyle = 'rgba(40,25,10,0.6)'; g.lineWidth = 1.5;
    g.strokeRect(X + 2, Y + 2, TILE - 4, TILE - 4);
    g.beginPath(); g.moveTo(X + 3, Y + 3); g.lineTo(X + TILE - 3, Y + TILE - 3); g.stroke();
  } else if (wm === WM.CONCRETE) {
    for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(X + rng() * 28, Y + rng() * 28, 3, 3); }
  }
}

function drawLowTile(g, x, y, wm, rng) {
  const X = x * TILE, Y = y * TILE, m = MAT[wm];
  const same = (nx, ny) => tileAt(nx, ny) === T.LOW && wmAt(nx, ny) === wm;
  g.fillStyle = m.top;
  if (wm === WM.JERSEY) {
    // бетонный блок: сплошной, со скошенными гранями
    const l = same(x - 1, y) ? 0 : 3, r = same(x + 1, y) ? 0 : 3, t = same(x, y - 1) ? 0 : 3, b = same(x, y + 1) ? 0 : 3;
    g.fillRect(X + l, Y + t, TILE - l - r, TILE - t - b);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(X + l, Y + TILE / 2 - 2, TILE - l - r, 4);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    if (!same(x + 1, y)) g.fillRect(X + TILE - 4, Y + t, 1, TILE - t - b);
  } else if (wm === WM.SANDBAG) {
    for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
      const off = r % 2 ? 8 : 0;
      const bx = X + k * 16 + off - 4, by = Y + r * 16 + 2;
      g.fillStyle = m.top;
      g.beginPath(); g.ellipse(bx + 8, by + 6, 9, 6.5, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(60,45,20,0.6)'; g.lineWidth = 1; g.stroke();
    }
  } else if (wm === WM.CRATE) {
    g.fillRect(X + 2, Y + 2, TILE - 4, TILE - 4);
    g.strokeStyle = 'rgba(50,30,10,0.7)'; g.lineWidth = 1.5;
    g.strokeRect(X + 2.5, Y + 2.5, TILE - 5, TILE - 5);
    g.beginPath(); g.moveTo(X + 4, Y + 4); g.lineTo(X + TILE - 4, Y + TILE - 4); g.moveTo(X + TILE - 4, Y + 4); g.lineTo(X + 4, Y + TILE - 4); g.stroke();
  } else if (wm === WM.BARREL) {
    g.beginPath(); g.arc(X + 16, Y + 16, 13, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X + 16, Y + 16, 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.beginPath(); g.arc(X + 11, Y + 11, 3, 0, Math.PI * 2); g.fill();
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// Легковой автомобиль ~2×4 м, вид сверху
// Оружейный стол (хаб): столешница, на ней — все стволы
function drawTable(g, e) {
  const X = e.x0 * TILE, Y = e.y0 * TILE, W = (e.x1 - e.x0 + 1) * TILE, H = (e.y1 - e.y0 + 1) * TILE;
  g.fillStyle = '#6e4f2e'; roundRect(g, X + 2, Y + 3, W - 4, H - 6, 3); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1.5; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  for (let x = X + 10; x < X + W - 4; x += 12) { g.beginPath(); g.moveTo(x, Y + 4); g.lineTo(x, Y + H - 4); g.stroke(); }
  // стволы на столе — все, что можно взять: полноразмерные стволом вверх в ряд, пистолеты — справа
  const ids = [...PRIMARY_IDS, ...PISTOL_IDS], step = (W - 16) / ids.length;
  ids.forEach((t, i) => {
    const pistol = WEAPONS[t].cls === 'pistol';
    g.save(); g.translate(X + 8 + step * (i + 0.5), pistol ? Y + H / 2 + 6 : Y + H - 12); g.rotate(-Math.PI / 2 + 0.08);
    g.scale(pistol ? 1.3 : 1.05, pistol ? 1.3 : 1.05);
    drawGunShape(t, 1, g); g.restore();
  });
}

function drawCar(g, e) {
  const X = e.x0 * TILE, Y = e.y0 * TILE, W = (e.x1 - e.x0 + 1) * TILE, H = (e.y1 - e.y0 + 1) * TILE;
  const vert = H > W;
  g.save();
  g.translate(X + W / 2, Y + H / 2);
  if (!vert) g.rotate(Math.PI / 2);
  const w = vert ? W : H, h = vert ? H : W;
  g.fillStyle = e.color || '#6a7078';
  roundRect(g, -w / 2 + 3, -h / 2 + 2, w - 6, h - 4, 9); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1.5; g.stroke();
  // стёкла и крыша
  g.fillStyle = 'rgba(25,35,45,0.85)';
  roundRect(g, -w / 2 + 8, -h / 2 + h * 0.24, w - 16, h * 0.14, 3); g.fill();
  roundRect(g, -w / 2 + 8, h / 2 - h * 0.3, w - 16, h * 0.1, 3); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(g, -w / 2 + 9, -h / 2 + h * 0.4, w - 18, h * 0.28, 4); g.fill();
  // фары
  g.fillStyle = 'rgba(255,240,200,0.6)';
  g.fillRect(-w / 2 + 6, -h / 2 + 3, 7, 3); g.fillRect(w / 2 - 13, -h / 2 + 3, 7, 3);
  g.restore();
}

// Морской контейнер: гофрированная крыша
function drawContainer(g, e) {
  const X = e.x0 * TILE, Y = e.y0 * TILE, W = (e.x1 - e.x0 + 1) * TILE, H = (e.y1 - e.y0 + 1) * TILE;
  g.fillStyle = e.color || MAT[WM.CONTAINER].top;
  g.fillRect(X + 1, Y + 1, W - 2, H - 2);
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1;
  g.beginPath();
  if (W > H) for (let x = X + 6; x < X + W - 3; x += 6) { g.moveTo(x + 0.5, Y + 3); g.lineTo(x + 0.5, Y + H - 3); }
  else for (let y = Y + 6; y < Y + H - 3; y += 6) { g.moveTo(X + 3, y + 0.5); g.lineTo(X + W - 3, y + 0.5); }
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
  g.strokeRect(X + 1, Y + 1, W - 2, H - 2);
}

// ---------- Движение ----------
// Круг против тайловой сетки. Возвращает true, если упёрлись.
function moveCircle(o, dx, dy, r) {
  const ox = o.x, oy = o.y;
  o.x += dx; o.y += dy;
  let hit = false;
  for (let it = 0; it < 2; it++) {
    const x0 = Math.floor((o.x - r) / TILE), x1 = Math.floor((o.x + r) / TILE);
    const y0 = Math.floor((o.y - r) / TILE), y1 = Math.floor((o.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (!solidTile(tx, ty)) continue;
      const cx = clamp(o.x, tx * TILE, tx * TILE + TILE), cy = clamp(o.y, ty * TILE, ty * TILE + TILE);
      const ddx = o.x - cx, ddy = o.y - cy, d2 = ddx * ddx + ddy * ddy;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2), push = r - d;
        o.x += (ddx / d) * push; o.y += (ddy / d) * push;
      } else {
        const l = o.x - tx * TILE, rr = tx * TILE + TILE - o.x, t = o.y - ty * TILE, b = ty * TILE + TILE - o.y;
        const m = Math.min(l, rr, t, b);
        if (m === l) o.x -= l + r; else if (m === rr) o.x += rr + r; else if (m === t) o.y -= t + r; else o.y += b + r;
      }
    }
  }
  if (hit && circleStuck(o, r) && !circleStuck({ x: ox, y: oy }, r)) { o.x = ox; o.y = oy; }
  return hit;
}

function circleStuck(o, r) {
  const x0 = Math.floor((o.x - r) / TILE), x1 = Math.floor((o.x + r) / TILE);
  const y0 = Math.floor((o.y - r) / TILE), y1 = Math.floor((o.y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (!solidTile(tx, ty)) continue;
    const cx = clamp(o.x, tx * TILE, tx * TILE + TILE), cy = clamp(o.y, ty * TILE, ty * TILE + TILE);
    if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (r - 1) * (r - 1)) return true;
  }
  return false;
}

// ---------- Видимость ----------
// Прямая видимость между точками: только стены (сквозь низкие укрытия видно)
function los(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 8);
  for (let i = 1; i < steps; i++) if (opaqueAt(x0 + (dx * i) / steps, y0 + (dy * i) / steps)) return false;
  return true;
}

// Сколько энергии пули останется на линии (0..1): стены и закрытые двери гасят её по материалу (MAT.pen за клетку),
// как в updateBullets; низкие укрытия пропускают (стрелок стоя). Меньше 0,2 — пуля гибнет: 0.
function fireLineK(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 6);
  let k = 1, last = -1;
  for (let i = 1; i < steps; i++) {
    const tx = Math.floor((x0 + (dx * i) / steps) / TILE), ty = Math.floor((y0 + (dy * i) / steps) / TILE), ti = ty * map.w + tx;
    if (ti === last || !opaqueT(tileAt(tx, ty))) continue;
    last = ti;
    k *= MAT[wmAt(tx, ty)].pen;
    if (k < 0.2) return 0;
  }
  return k;
}

// Видимость между людьми: низкое укрытие закрывает того, кто присел за ним вплотную
// (и присевший сам не видит поверх своего укрытия).
function sightLine(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  const steps = Math.ceil(L / 8);
  for (let i = 1; i < steps; i++) {
    const k = i / steps, x = a.x + dx * k, y = a.y + dy * k;
    const t = tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
    if (opaqueT(t)) return false;
    if (t === T.LOW && ((a.crouch && L * k < COVER_NEAR) || (b.crouch && L * (1 - k) < COVER_NEAR))) return false;
  }
  return true;
}

// Человек присел за укрытием, которое закрывает его от точки (x, y)
function coveredFrom(o, x, y) {
  if (!o.crouch) return false;
  const dx = x - o.x, dy = y - o.y, L = Math.hypot(dx, dy);
  if (L < COVER_NEAR) return false;
  for (let d = 8; d <= COVER_NEAR; d += 6) {
    const t = tileAt(Math.floor((o.x + (dx / L) * d) / TILE), Math.floor((o.y + (dy / L) * d) / TILE));
    if (t === T.LOW) return true;
    if (opaqueT(t)) return true;
  }
  return false;
}

// Луч по сетке (DDA): расстояние до первой непрозрачной клетки. opq(tx, ty, t) — своё условие.
function castRay(ox, oy, dx, dy, maxR, opq = opaqueTile) {
  let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tdX = dx !== 0 ? Math.abs(TILE / dx) : Infinity, tdY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let tmX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
  let tmY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
  let t = 0;
  while (t < maxR) {
    if (tmX < tmY) { t = tmX; tmX += tdX; tx += stepX; } else { t = tmY; tmY += tdY; ty += stepY; }
    if (opq(tx, ty, t)) return t;
  }
  return maxR;
}

// ---------- Пути ----------
// BFS по клеткам: расстояние «по пути». По нему идёт звук шагов и ходят ИИ.
// doors — закрытые незапертые двери проходимы (ИИ откроет); 'breach' — и запертые, которые можно выбить (бот в бою);
// без него закрытая дверь — стена (так идёт звук шагов)
// Очередь обхода — общая (не возвращается наружу): не выделять на каждый вызов массив на всю карту
let bfsQ = new Int32Array(0);
function bfsFrom(x, y, maxD = 1e9, doors = false) {
  const { w, h } = map, g = map.grid, FLOOR = T.FLOOR, DOOR = T.DOOR;
  const ok = (i) => g[i] === FLOOR || (doors && g[i] === DOOR && walkable(i % w, (i / w) | 0, doors));
  const f = new Int32Array(w * h).fill(1e9);
  const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { f, x, y, doors };
  if (bfsQ.length < w * h) bfsQ = new Int32Array(w * h);
  const q = bfsQ;
  let qh = 0, qt = 0;
  f[sy * w + sx] = 0; q[qt++] = sy * w + sx;
  while (qh < qt) {
    const i = q[qh++];
    if (f[i] >= maxD) continue;
    const x0 = i % w, y0 = (i / w) | 0, nd = f[i] + 1;
    if (x0 + 1 < w && ok(i + 1) && f[i + 1] > nd) { f[i + 1] = nd; q[qt++] = i + 1; }
    if (x0 > 0 && ok(i - 1) && f[i - 1] > nd) { f[i - 1] = nd; q[qt++] = i - 1; }
    if (y0 + 1 < h && ok(i + w) && f[i + w] > nd) { f[i + w] = nd; q[qt++] = i + w; }
    if (y0 > 0 && ok(i - w) && f[i - w] > nd) { f[i - w] = nd; q[qt++] = i - w; }
  }
  return { f, x, y, doors };
}

// Поле звука: путь по проходимым клеткам (над низкими укрытиями тоже), закрытая дверь съедает DOOR_TYPES.sound метров.
// door[i] — последняя закрытая дверь на пути от источника к клетке (через неё слушатель и услышал).
function soundField(x, y, maxD) {
  const { w, h } = map;
  const f = new Int32Array(w * h).fill(1e9), door = new Int16Array(w * h).fill(-1);
  const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { f, door };
  // корзины по расстоянию — по требованию; соседи — без массива на каждую клетку (звук шагов считается часто)
  const buckets = [];
  const g = map.grid, DOOR = T.DOOR, FLOOR = T.FLOOR, LOW = T.LOW;
  const relax = (i, j, dd) => {
    const t = g[j];
    let c = 1, via = door[i];
    if (t === DOOR) {
      const d = map.doorAt.get(j), s = DOOR_TYPES[d.type].sound;
      if (s < 0) return;
      c += s; via = d.id;
    } else if (t !== FLOOR && t !== LOW) return;
    const nd = dd + c;
    if (nd > maxD || nd >= f[j]) return;
    f[j] = nd; door[j] = via;
    (buckets[nd] || (buckets[nd] = [])).push(j);
  };
  f[sy * w + sx] = 0; buckets[0] = [sy * w + sx];
  for (let dd = 0; dd <= maxD; dd++) {
    const b = buckets[dd];
    if (!b) continue;
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      if (f[i] !== dd) continue;
      const x0 = i % w;
      if (x0 + 1 < w) relax(i, i + 1, dd);
      if (x0 > 0) relax(i, i - 1, dd);
      if (i + w < w * h) relax(i, i + w, dd);
      if (i - w >= 0) relax(i, i - w, dd);
    }
  }
  return { f, door };
}

// Путь с весами (Дейкстра на корзинах): cost(i) — цена входа в клетку (целое ≥ 1). Через незапертые двери.
// Возвращает поле в формате bfsFrom — по нему ходит fieldStep.
function weightedField(x, y, cost, maxD = 4000) {
  const { w, h } = map;
  const f = new Int32Array(w * h).fill(1e9);
  const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
  const res = { f, x, y, doors: true };
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return res;
  // корзины по стоимости (Дейкстра с целыми весами), соседи — без выделения памяти (вызывается на всю карту: обход ИИ)
  const buckets = [];
  let left = 1;
  const g = map.grid, FLOOR = T.FLOOR, DOOR = T.DOOR;
  const ok = (j) => g[j] === FLOOR || (g[j] === DOOR && walkable(j % w, (j / w) | 0, true));
  const relax = (j, dd) => {
    if (!ok(j)) return;
    const nd = dd + cost(j);
    if (nd > maxD || nd >= f[j]) return;
    f[j] = nd; (buckets[nd] || (buckets[nd] = [])).push(j); left++;
  };
  f[sy * w + sx] = 0; buckets[0] = [sy * w + sx];
  for (let dd = 0; dd <= maxD && left; dd++) {
    const b = buckets[dd];
    if (!b) continue;
    buckets[dd] = null;
    left -= b.length;
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      if (f[i] !== dd) continue;
      const x0 = i % w, y0 = (i / w) | 0;
      if (x0 + 1 < w) relax(i + 1, dd);
      if (x0 > 0) relax(i - 1, dd);
      if (y0 + 1 < h) relax(i + w, dd);
      if (y0 > 0) relax(i - w, dd);
    }
  }
  return res;
}

const fieldCache = new Map();
function fieldTo(x, y) {
  const key = tileIndex(x, y);
  const c = fieldCache.get(key);
  if (c && G.time - c.t < 3 && c.ver === map.ver) return c.field;
  const field = bfsFrom(x, y, 1e9, true);    // кэш — для ИИ: умеют открывать незапертые двери
  fieldCache.set(key, { field, t: G.time, ver: map.ver });
  if (fieldCache.size > 80) fieldCache.delete(fieldCache.keys().next().value);
  return field;
}

// Шаг по BFS-полю к источнику: угол движения или null (пришли / не добраться)
function fieldStep(o, goal) {
  const tx = Math.floor(o.x / TILE), ty = Math.floor(o.y / TILE);
  const w = map.w, f = goal.f;
  const cur = f[ty * w + tx];
  if (cur >= 1e9) return null;
  if (cur === 0) {
    if (Math.hypot(goal.x - o.x, goal.y - o.y) < 6) return null;
    return Math.atan2(goal.y - o.y, goal.x - o.x);
  }
  const pass = (nx, ny) => walkable(nx, ny, goal.doors);
  let best = cur, bx = tx, by = ty;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = tx + dx, ny = ty + dy;
    if (!pass(nx, ny)) continue;
    if (dx && dy && (!pass(tx + dx, ty) || !pass(tx, ty + dy))) continue;
    const v = f[ny * w + nx] + (dx && dy ? 0.4 : 0);
    if (v < best) { best = v; bx = nx; by = ny; }
  }
  if (bx === tx && by === ty) return null;
  const gx = bx * TILE + TILE / 2, gy = by * TILE + TILE / 2;
  return Math.atan2(gy - o.y, gx - o.x);
}

function freeSpotNear(x, y, r = PR) {
  for (let rad = 0; rad < 6 * TILE; rad += 8) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      if (solidAt(px, py)) continue;
      const o = { x: px, y: py };
      moveCircle(o, 0, 0, r);
      if (Math.hypot(o.x - px, o.y - py) < 1 && !solidAt(o.x, o.y)) return o;
    }
  }
  return { x, y };
}
