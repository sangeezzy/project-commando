'use strict';
// ---------- Тайлы, конструктор карт, коллизии, видимость, пути ----------

// Тип тайла
const T = { FLOOR: 0, WALL: 1, LOW: 2, DEBRIS: 3, GATE: 4 };
// Материал пола (влияет на вид и на освещение: пещеры и тоннели — тёмные)
const FM = { NONE: 0, CAVE: 1, SAND: 2, STREET: 3, INDOOR: 4, TUNNEL: 5, CAMP: 6, METAL: 7, PLAZA: 8 };
// Материал стен и низких укрытий
const WM = { ROCK: 1, TOWN: 2, HOUSE: 3, BASE: 4, CENTER: 5, FACILITY: 6, LROCK: 10, BARRICADE: 11, CRATE: 12, TENT: 13 };
const DARK_FLOORS = [FM.CAVE, FM.TUNNEL];

const FLOOR_COL = {
  [FM.CAVE]: ['#0b0910', '#0a080e'], [FM.SAND]: ['#18120c', '#16100b'], [FM.STREET]: ['#100f18', '#0e0d16'],
  [FM.INDOOR]: ['#15111e', '#13101b'], [FM.TUNNEL]: ['#090b09', '#080a08'], [FM.CAMP]: ['#0f141a', '#0e1218'],
  [FM.METAL]: ['#0e0c1a', '#0c0a17'], [FM.PLAZA]: ['#12101c', '#100e19'],
};
const WALL_COL = {
  [WM.ROCK]: ['#17101a', '#c0602a'], [WM.TOWN]: ['#1d1a26', '#ffb000'], [WM.HOUSE]: ['#181426', '#ff2bd6'],
  [WM.BASE]: ['#120a20', '#9d8cff'], [WM.CENTER]: ['#161a26', '#33ffcc'], [WM.FACILITY]: ['#1a1022', '#ff3344'],
};
const LOW_COL = {
  [WM.LROCK]: ['#2a1f2c', '#9a7a8a'], [WM.BARRICADE]: ['#22222c', '#ffb000'],
  [WM.CRATE]: ['#271d14', '#c08a40'], [WM.TENT]: ['#162229', '#4da6ff'],
};

// ---------- Конструктор карты (детерминированный) ----------
class MapBuilder {
  constructor(w, h, seed) {
    this.w = w; this.h = h;
    this.grid = new Uint8Array(w * h).fill(T.WALL);
    this.fl = new Uint8Array(w * h);           // материал пола
    this.wm = new Uint8Array(w * h).fill(WM.ROCK);   // материал стены/укрытия
    this.ents = [];
    this.zones = [];
    this.rng = makeRng(seed);
  }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, t, m) {
    if (!this.inside(x, y)) return;
    const i = y * this.w + x;
    this.grid[i] = t;
    if (t === T.WALL) this.wm[i] = m;
    else if (t === T.FLOOR) this.fl[i] = m;
    else this.wm[i] = m;
  }
  floor(x, y, fm) { this.set(x, y, T.FLOOR, fm); }
  fill(x0, y0, x1, y1, fm) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.floor(x, y, fm); }
  wallRect(x0, y0, x1, y1, wm) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, T.WALL, wm); }
  disc(cx, cy, r, fm) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.floor(x, y, fm);
      }
    }
  }
  // Извилистый проход по ломаной: круги с «дрожащим» радиусом
  path(pts, r0, r1, fm) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L * 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const wob = Math.sin((ax + ay + k) * 0.7) * 0.3;
        this.disc(ax + (bx - ax) * t + wob, ay + (by - ay) * t - wob, r0 + this.rng() * (r1 - r0), fm);
      }
    }
  }
  // Здание: стены по периметру, пол внутри, двери — проёмы в стене
  box(x0, y0, x1, y1, wm, fm, doors = []) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (x === x0 || x === x1 || y === y0 || y === y1) this.set(x, y, T.WALL, wm);
        else this.floor(x, y, fm);
      }
    }
    for (const [dx, dy] of doors) this.floor(dx, dy, fm);
  }
  // Низкое укрытие (камни, баррикада, ящики): не пускает и держит выстрелы, но сквозь него видно
  low(x0, y0, x1, y1, wm) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!this.inside(x, y)) continue;
      const i = y * this.w + x;
      if (this.grid[i] !== T.FLOOR) continue;
      this.grid[i] = T.LOW; this.wm[i] = wm;
    }
  }
  // Случайные камни-укрытия в области (только на полу, не у стен)
  scatterRocks(x0, y0, x1, y1, n, avoid = []) {
    for (let k = 0; k < n; k++) {
      const x = Math.floor(x0 + this.rng() * (x1 - x0)), y = Math.floor(y0 + this.rng() * (y1 - y0));
      if (avoid.some(([ax, ay, r]) => Math.hypot(x - ax, y - ay) < r)) continue;
      let ok = true;
      for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2 && ok; dx++) {
        if (!this.inside(x + dx, y + dy) || this.grid[(y + dy) * this.w + x + dx] !== T.FLOOR) ok = false;
      }
      if (!ok) continue;
      const w = this.rng() < 0.5 ? 1 : 0, h = w ? 0 : this.rng() < 0.5 ? 1 : 0;
      this.low(x, y, x + w, y + h, WM.LROCK);
    }
  }
  // Завал: закрывает проход, пока двое не разберут его (мини-игра)
  debris(id, cx, cy, r) {
    const tiles = [];
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!this.inside(x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const i = y * this.w + x;
        if (this.grid[i] === T.WALL) continue;
        this.grid[i] = T.DEBRIS; tiles.push([x, y]);
      }
    }
    this.ents.push({ kind: 'debris', id, x: cx, y: cy, tiles });
  }
  // Ворота/люк: закрытые тайлы, открываются по сценарию
  gate(id, x0, y0, x1, y1, props = {}) {
    const tiles = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * this.w + x;
      if (!this.fl[i]) this.fl[i] = props.fm || FM.STREET;
      this.grid[i] = T.GATE; tiles.push([x, y]);
    }
    this.ents.push({ kind: 'gate', id, x: (x0 + x1 + 1) / 2, y: (y0 + y1 + 1) / 2, tiles, ...props });
  }
  ent(kind, x, y, props = {}) { this.ents.push({ kind, x, y, ...props }); }
  enemy(t, x, y, props = {}) { this.ents.push({ kind: 'enemy', t, x: x + 0.5, y: y + 0.5, ...props }); }
  zone(name, x0, y0, x1, y1) { this.zones.push({ name, x0, y0, x1, y1 }); }
}

// ---------- Текущая карта ----------
let map = null;

function finishMap(mb, meta) {
  const { w, h } = mb;
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (mb.grid[i] !== T.WALL && DARK_FLOORS.includes(mb.fl[i])) dark[i] = 1;
  const zone = new Uint8Array(w * h);
  const zoneNames = ['', ...mb.zones.map((z) => z.name)];
  // зоны заданы прямоугольниками, первая подходящая важнее
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = mb.zones.findIndex((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
    if (k >= 0) zone[y * w + x] = k + 1;
  }
  // сущности: координаты в клетках -> пиксели
  const ents = mb.ents.map((e, i) => ({ ...e, eid: i, px: e.x * TILE, py: e.y * TILE }));
  map = { w, h, grid: mb.grid, fl: mb.fl, wm: mb.wm, dark, zone, zoneNames, ents, ...meta };
  buildLightMasks();
  map.canvas = renderMapCanvas();
  return map;
}

const tileAt = (tx, ty) => (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h ? T.WALL : map.grid[ty * map.w + tx]);
// не пройти (стены, укрытия, завалы, ворота)
const solidTile = (tx, ty) => tileAt(tx, ty) !== T.FLOOR;
// не видно насквозь (низкие укрытия прозрачны)
function opaqueTile(tx, ty) {
  const t = tileAt(tx, ty);
  return t === T.WALL || t === T.DEBRIS || t === T.GATE;
}
const solidAt = (x, y) => solidTile(Math.floor(x / TILE), Math.floor(y / TILE));
const opaqueAt = (x, y) => opaqueTile(Math.floor(x / TILE), Math.floor(y / TILE));
const tileIndex = (x, y) => Math.floor(y / TILE) * map.w + Math.floor(x / TILE);
function darkAt(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return false;
  return map.dark[ty * map.w + tx] === 1;
}
function zoneAt(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return '';
  return map.zoneNames[map.zone[ty * map.w + tx]];
}
// Рация работает только на поверхности: в пещерах и тоннелях связи нет
const radioAt = (x, y) => !darkAt(x, y);

function setTiles(tiles, t) {
  for (const [x, y] of tiles) map.grid[y * map.w + x] = t;
  map.ver = (map.ver || 0) + 1;     // кэш путей устарел
}

// Маски светлых и тёмных зон (мировые координаты). Стена относится к зоне соседнего пола.
function buildLightMasks() {
  const { w, h } = map;
  const mk = () => { const c = document.createElement('canvas'); c.width = w * TILE; c.height = h * TILE; return c; };
  const lit = mk(), dark = mk();
  const lg = lit.getContext('2d'), dg = dark.getContext('2d');
  lg.fillStyle = dg.fillStyle = '#fff';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let toLit = false, toDark = false;
      const i = y * w + x;
      if (map.grid[i] !== T.WALL) { if (map.dark[i]) toDark = true; else toLit = true; }
      else {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (tileAt(nx, ny) === T.WALL) continue;
          if (map.dark[ny * w + nx]) toDark = true; else toLit = true;
        }
      }
      if (toLit) lg.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (toDark) dg.fillRect(x * TILE, y * TILE, TILE, TILE);
    }
  }
  map.litMask = lit; map.darkMask = dark;
}

function renderMapCanvas() {
  const c = document.createElement('canvas');
  c.width = map.w * TILE; c.height = map.h * TILE;
  const g = c.getContext('2d');
  const rng = makeRng(map.w * 7919 + map.h);
  g.fillStyle = '#05030a';
  g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x, t = map.grid[i];
      const X = x * TILE, Y = y * TILE;
      if (t === T.WALL) {
        g.fillStyle = (WALL_COL[map.wm[i]] || WALL_COL[WM.ROCK])[0];
        g.fillRect(X, Y, TILE, TILE);
        continue;
      }
      const fm = map.fl[i] || FM.STREET;
      const cols = FLOOR_COL[fm] || FLOOR_COL[FM.STREET];
      g.fillStyle = cols[(x + y) & 1];
      g.fillRect(X, Y, TILE, TILE);
      if (fm === FM.STREET || fm === FM.METAL || fm === FM.PLAZA) {
        g.strokeStyle = fm === FM.PLAZA ? 'rgba(51,255,204,0.06)' : 'rgba(157,140,255,0.05)';
        g.strokeRect(X + 0.5, Y + 0.5, TILE - 1, TILE - 1);
      } else if (fm === FM.INDOOR) {
        g.strokeStyle = 'rgba(255,43,214,0.04)';
        g.beginPath(); g.moveTo(X, Y + 16.5); g.lineTo(X + TILE, Y + 16.5); g.stroke();
      } else {
        // песок, камень: мелкие камешки
        const n = fm === FM.SAND ? 3 : 2;
        for (let k = 0; k < n; k++) {
          g.fillStyle = fm === FM.SAND ? 'rgba(255,176,0,0.07)' : fm === FM.TUNNEL ? 'rgba(120,255,140,0.05)' : 'rgba(255,140,90,0.06)';
          g.fillRect(X + rng() * 30, Y + rng() * 30, 2, 2);
        }
      }
    }
  }
  // низкие укрытия
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      if (map.grid[i] !== T.LOW) continue;
      const [fill, edge] = LOW_COL[map.wm[i]] || LOW_COL[WM.LROCK];
      const X = x * TILE, Y = y * TILE;
      g.fillStyle = fill;
      g.strokeStyle = edge; g.lineWidth = 1.5;
      if (map.wm[i] === WM.LROCK) {
        g.beginPath();
        const cx = X + 16, cy = Y + 16;
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2, r = 12 + rng() * 4;
          if (k === 0) g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.closePath(); g.fill(); g.globalAlpha = 0.6; g.stroke(); g.globalAlpha = 1;
      } else {
        g.fillRect(X + 2, Y + 2, TILE - 4, TILE - 4);
        g.globalAlpha = 0.7; g.strokeRect(X + 2.5, Y + 2.5, TILE - 5, TILE - 5);
        if (map.wm[i] === WM.BARRICADE) {
          g.beginPath(); g.moveTo(X + 4, Y + 28); g.lineTo(X + 28, Y + 4); g.stroke();
        } else if (map.wm[i] === WM.CRATE) {
          g.beginPath(); g.moveTo(X + 4, Y + 4); g.lineTo(X + 28, Y + 28); g.moveTo(X + 28, Y + 4); g.lineTo(X + 4, Y + 28); g.stroke();
        }
        g.globalAlpha = 1;
      }
    }
  }
  // неоновые кромки стен — только там, где стена граничит с проходимым
  const paths = new Map();
  const open = (nx, ny) => nx >= 0 && ny >= 0 && nx < map.w && ny < map.h && tileAt(nx, ny) !== T.WALL;
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const i = y * map.w + x;
      if (map.grid[i] !== T.WALL) continue;
      const col = (WALL_COL[map.wm[i]] || WALL_COL[WM.ROCK])[1];
      if (!paths.has(col)) paths.set(col, []);
      const segs = paths.get(col);
      const X = x * TILE, Y = y * TILE;
      if (open(x, y - 1)) segs.push([X, Y, X + TILE, Y]);
      if (open(x, y + 1)) segs.push([X, Y + TILE, X + TILE, Y + TILE]);
      if (open(x - 1, y)) segs.push([X, Y, X, Y + TILE]);
      if (open(x + 1, y)) segs.push([X + TILE, Y, X + TILE, Y + TILE]);
    }
  }
  g.lineCap = 'round';
  for (const [col, segs] of paths) {
    g.beginPath();
    for (const [a, b, cc, d] of segs) { g.moveTo(a, b); g.lineTo(cc, d); }
    g.strokeStyle = col; g.shadowColor = col;
    g.globalAlpha = 0.28; g.lineWidth = 7; g.shadowBlur = 20; g.stroke();
    g.globalAlpha = 0.95; g.lineWidth = 2.2; g.shadowBlur = 9; g.stroke();
    g.shadowBlur = 0; g.strokeStyle = '#fff'; g.globalAlpha = 0.45; g.lineWidth = 0.8; g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

// Круг против тайловой сетки. Возвращает true, если упёрлись.
function moveCircle(o, dx, dy, r) {
  const ox = o.x, oy = o.y;
  o.x += dx; o.y += dy;
  let hit = false;
  for (let it = 0; it < 2; it++) {
    const x0 = Math.floor((o.x - r) / TILE), x1 = Math.floor((o.x + r) / TILE);
    const y0 = Math.floor((o.y - r) / TILE), y1 = Math.floor((o.y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solidTile(tx, ty)) continue;
        const cx = clamp(o.x, tx * TILE, tx * TILE + TILE);
        const cy = clamp(o.y, ty * TILE, ty * TILE + TILE);
        const ddx = o.x - cx, ddy = o.y - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2), push = r - d;
          o.x += (ddx / d) * push; o.y += (ddy / d) * push;
        } else {
          const l = o.x - tx * TILE, rr = tx * TILE + TILE - o.x;
          const t = o.y - ty * TILE, b = ty * TILE + TILE - o.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) o.x -= l + r; else if (m === rr) o.x += rr + r;
          else if (m === t) o.y -= t + r; else o.y += b + r;
        }
      }
    }
  }
  // выталкивания с двух сторон могли погасить друг друга (крупный круг в узком проходе) — не пускаем
  if (hit && circleStuck(o, r) && !circleStuck({ x: ox, y: oy }, r)) { o.x = ox; o.y = oy; }
  return hit;
}

function circleStuck(o, r) {
  const x0 = Math.floor((o.x - r) / TILE), x1 = Math.floor((o.x + r) / TILE);
  const y0 = Math.floor((o.y - r) / TILE), y1 = Math.floor((o.y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (!solidTile(tx, ty)) continue;
      const cx = clamp(o.x, tx * TILE, tx * TILE + TILE), cy = clamp(o.y, ty * TILE, ty * TILE + TILE);
      if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (r - 1) * (r - 1)) return true;
    }
  }
  return false;
}

// Прямая видимость (низкие укрытия не мешают)
function los(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 8);
  for (let i = 1; i < steps; i++) {
    if (opaqueAt(x0 + (dx * i) / steps, y0 + (dy * i) / steps)) return false;
  }
  return true;
}
// Чистый путь для перемещения/броска (укрытия мешают)
function clearPath(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.ceil(Math.hypot(dx, dy) / 8);
  for (let i = 1; i < steps; i++) {
    if (solidAt(x0 + (dx * i) / steps, y0 + (dy * i) / steps)) return false;
  }
  return true;
}

// BFS по клеткам: расстояние «по пути». По нему идёт звук и по нему ходят ИИ.
// passDebris — считать завалы проходимыми (боты планируют маршрут сквозь завал и разбирают его)
function bfsFrom(x, y, maxD = 1e9, passDebris = false) {
  const { w, h } = map;
  const f = new Int32Array(w * h).fill(1e9);
  const sx = Math.floor(x / TILE), sy = Math.floor(y / TILE);
  const pass = (tx, ty) => {
    const t = tileAt(tx, ty);
    return t === T.FLOOR || (passDebris && t === T.DEBRIS);
  };
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { f, x, y };
  const q = new Int32Array(w * h);
  let qh = 0, qt = 0;
  f[sy * w + sx] = 0; q[qt++] = sy * w + sx;
  while (qh < qt) {
    const i = q[qh++];
    if (f[i] >= maxD) continue;
    const x0 = i % w, y0 = (i / w) | 0, nd = f[i] + 1;
    if (x0 + 1 < w && pass(x0 + 1, y0) && f[i + 1] > nd) { f[i + 1] = nd; q[qt++] = i + 1; }
    if (x0 > 0 && pass(x0 - 1, y0) && f[i - 1] > nd) { f[i - 1] = nd; q[qt++] = i - 1; }
    if (y0 + 1 < h && pass(x0, y0 + 1) && f[i + w] > nd) { f[i + w] = nd; q[qt++] = i + w; }
    if (y0 > 0 && pass(x0, y0 - 1) && f[i - w] > nd) { f[i - w] = nd; q[qt++] = i - w; }
  }
  return { f, x, y, passDebris };
}

// Кэш полей BFS по клетке цели (для союзников и ботов, которые часто идут к одним и тем же точкам)
const fieldCache = new Map();
function fieldTo(x, y, passDebris = false) {
  const key = tileIndex(x, y) * 2 + (passDebris ? 1 : 0);
  const now = G.time;
  const c = fieldCache.get(key);
  if (c && now - c.t < 1.5 && c.ver === map.ver) return c.field;
  const field = bfsFrom(x, y, 1e9, passDebris);
  fieldCache.set(key, { field, t: now, ver: map.ver });
  if (fieldCache.size > 80) fieldCache.delete(fieldCache.keys().next().value);
  return field;
}

// Шаг по BFS-полю к источнику. Возвращает угол движения или null (пришли / не добраться).
function fieldStep(o, goal, r) {
  const tx = Math.floor(o.x / TILE), ty = Math.floor(o.y / TILE);
  const w = map.w, f = goal.f;
  const cur = f[ty * w + tx];
  if (cur >= 1e9) return null;
  if (cur === 0) {
    if (Math.hypot(goal.x - o.x, goal.y - o.y) < 14) return null;
    return Math.atan2(goal.y - o.y, goal.x - o.x);
  }
  const passable = (nx, ny) => {
    const t = tileAt(nx, ny);
    return t === T.FLOOR || (goal.passDebris && t === T.DEBRIS);
  };
  let best = cur, bx = tx, by = ty;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (!passable(nx, ny)) continue;
      if (dx && dy && (!passable(tx + dx, ty) || !passable(tx, ty + dy))) continue;
      const v = f[ny * w + nx] + (dx && dy ? 0.4 : 0);
      if (v < best) { best = v; bx = nx; by = ny; }
    }
  }
  if (bx === tx && by === ty) return null;
  // целимся в центр следующей клетки, но держимся подальше от углов
  const gx = bx * TILE + TILE / 2, gy = by * TILE + TILE / 2;
  return Math.atan2(gy - o.y, gx - o.x);
}

// Луч по сетке (DDA): расстояние до первого непрозрачного тайла
function castRay(ox, oy, dx, dy, maxR) {
  let tx = Math.floor(ox / TILE), ty = Math.floor(oy / TILE);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tdX = dx !== 0 ? Math.abs(TILE / dx) : Infinity;
  const tdY = dy !== 0 ? Math.abs(TILE / dy) : Infinity;
  let tmX = dx > 0 ? ((tx + 1) * TILE - ox) / dx : dx < 0 ? (tx * TILE - ox) / dx : Infinity;
  let tmY = dy > 0 ? ((ty + 1) * TILE - oy) / dy : dy < 0 ? (ty * TILE - oy) / dy : Infinity;
  let t = 0;
  while (t < maxR) {
    if (tmX < tmY) { t = tmX; tmX += tdX; tx += stepX; } else { t = tmY; tmY += tdY; ty += stepY; }
    if (opaqueTile(tx, ty)) return t;
  }
  return maxR;
}

// Найти ближайшую свободную точку рядом (для высадки со спидера, появления и т.п.)
function freeSpotNear(x, y, r = PR) {
  for (let rad = 0; rad < 6 * TILE; rad += 8) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad;
      const o = { x: px, y: py };
      if (solidAt(px, py)) continue;
      moveCircle(o, 0, 0, r);
      if (Math.hypot(o.x - px, o.y - py) < 1 && !solidAt(o.x, o.y)) return o;
    }
  }
  return { x, y };
}
