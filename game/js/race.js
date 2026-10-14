'use strict';
// ---------- Автодром (карта 'race', выход 5 в хабе): без противников, трассы и 10 машин ----------
// 200 × 130 м, вне трасс — грунт (обочина). Трассы — осевые линии (метры), полоса — по расстоянию до оси (ширина width), кромка —
// бетон (поребрик), покрытие — по участкам (surf: asphalt / gravel / dirt):
//   1. Прямая 180 м, асфальт — разгон и торможение (в конце — отбойник);
//   2. Простая трасса — «стадион»: две прямые и два полукруга, асфальт;
//   3. Сложная — «змейка» из четырёх шпилек с шиканой и S-связкой, обратная прямая, асфальт;
//   4. Смешанное покрытие — асфальт, гравий, грунт попеременно (сцепление разное: VEH.surface).
// map.tracks — трассы (точки в px, для ботов за рулём: VEH.botDrive), старт / финиш — белые полосы.

const RACE_W = 200, RACE_H = 130;
const RACE_SURF = { asphalt: FM.ASPHALT, gravel: FM.GRAVEL, dirt: FM.DIRT };

// Осевая линия из кусков: прямые и дуги (метры), точки — через ~0,5 м; у каждой точки — покрытие
function racePath() {
  const pts = [];
  let surf = 'asphalt';
  const P = {
    surf(s) { surf = s; return P; },
    to(x, y) {
      const l = pts[pts.length - 1];
      if (!l) { pts.push({ x, y, s: surf }); return P; }
      const n = Math.max(1, Math.ceil(Math.hypot(x - l.x, y - l.y) / 0.5));
      for (let i = 1; i <= n; i++) pts.push({ x: l.x + (x - l.x) * i / n, y: l.y + (y - l.y) * i / n, s: surf });
      return P;
    },
    // дуга вокруг (cx, cy) радиусом r от угла a0 до a1 (рад; знак — направление)
    arc(cx, cy, r, a0, a1) {
      const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / 0.5));
      for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s: surf }); }
      return P;
    },
    pts,
  };
  return P;
}

function raceTracks() {
  const H = Math.PI / 2, PI = Math.PI;
  // 1. прямая: запад → восток
  const straight = racePath().to(12, 8).to(186, 8).pts;
  // 2. «стадион»: по часовой; левая прямая — на север (старт)
  const oval = racePath()
    .to(15, 100).to(15, 46).arc(35, 46, 20, PI, 2 * PI).to(55, 100).arc(35, 100, 20, 0, PI).pts;
  // 3. «змейка»: ряды на восток / запад, между ними шпильки r = 9; верхний ряд — с шиканой, обратная прямая — по западу (x = 78)
  const snake = racePath()
    .to(78, 104).to(78, 40).arc(88, 40, 10, PI, PI + H)                 // обратная прямая на север, поворот на восток
    .to(102, 30).to(108, 34).to(114, 30).to(122, 30)                     // шикана
    .arc(122, 39, 9, -H, H)                                              // шпилька вниз
    .to(104, 48).arc(104, 57, 9, -H, -3 * H)                              // ряд на запад, шпилька вниз
    .to(112, 66).to(116, 70).to(122, 66)                                  // S-связка
    .arc(122, 75, 9, -H, H)                                              // шпилька вниз
    .to(104, 84).arc(104, 93, 9, -H, -3 * H)                              // ряд на запад, шпилька вниз
    .to(118, 102).arc(118, 108, 6, -H, H).to(88, 114).arc(88, 104, 10, H, PI).pts;   // вниз и обратно на запад — к обратной прямой
  // 4. смешанное покрытие: прямоугольник со скруглением r = 12, по часовой
  const mixed = racePath()
    .surf('asphalt').to(156, 30).to(176, 30).arc(176, 42, 12, -H, 0)
    .surf('gravel').to(188, 70).surf('dirt').to(188, 104).arc(176, 104, 12, 0, H)
    .surf('asphalt').to(166, 116).surf('gravel').to(156, 116).arc(156, 104, 12, H, PI)
    .surf('dirt').to(144, 70).surf('asphalt').to(144, 42).arc(156, 42, 12, PI, PI + H).pts;
  return [
    { id: 'straight', name: 'ПРЯМАЯ 180 м', pts: straight, width: 10, loop: false, start: 0 },
    { id: 'oval', name: 'ПРОСТАЯ ТРАССА', pts: oval, width: 10, loop: true },
    { id: 'snake', name: 'СЛОЖНАЯ ТРАССА', pts: snake, width: 9, loop: true },
    { id: 'mixed', name: 'АСФАЛЬТ, ГРАВИЙ, ГРУНТ', pts: mixed, width: 10, loop: true },
  ];
}

function buildRace() {
  const W = RACE_W, H = RACE_H;
  const b = new MapBuilder(W, H, 99);
  b.box(0, 0, W - 1, H - 1, WM.CONCRETE, FM.DIRT);
  b.fill(1, 1, W - 2, H - 2, FM.DIRT);
  const tracks = raceTracks();
  // полоса: ближайшая точка оси в радиусе — покрытие; кромка (1 м) — бетон
  const best = new Float32Array(W * H).fill(1e9), surf = new Uint8Array(W * H);
  for (const t of tracks) {
    const hw = t.width / 2, R = Math.ceil(hw + 1.5);
    for (const p of t.pts) {
      for (let y = Math.floor(p.y) - R; y <= Math.floor(p.y) + R; y++) for (let x = Math.floor(p.x) - R; x <= Math.floor(p.x) + R; x++) {
        if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y), i = y * W + x;
        if (d - hw < best[i]) { best[i] = d - hw; surf[i] = d <= hw ? RACE_SURF[p.s] : FM.CONCRETE; }
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (best[i] <= 1) { const x = i % W, y = (i / W) | 0; b.set(x, y, T.FLOOR, surf[i]); }
  // отбойник в конце прямой (зона торможения 10 м за финишем) и разделители площадок (с проездами)
  b.low(196, 3, 196, 13, WM.JERSEY);
  for (let y = 18; y < H - 2; y++) if (y % 22 > 5) { b.low(68, y, 68, y, WM.JERSEY); b.low(137, y, 137, y, WM.JERSEY); }
  for (let x = 2; x < W - 2; x++) if (x % 24 > 6) b.low(x, 16, x, 16, WM.JERSEY);
  // старт и финиш: шахматные полосы поперёк трассы
  const line = (x, y, horiz, len) => { for (let k = 0; k < len * 2; k++) b.ent('stripe', horiz ? x + k * 0.5 : x, horiz ? y : y + k * 0.5, { w: horiz ? 0.5 : 0.5, h: 0.5, c: k % 2 ? 'rgba(20,20,20,0.85)' : 'rgba(235,235,235,0.9)' }); };
  line(16, 3, false, 10); line(176, 3, false, 10);          // прямая: старт, финиш
  line(10, 70, true, 10);                                   // «стадион»
  line(73, 70, true, 10);                                   // «змейка» (обратная прямая)
  line(160, 25, false, 10);                                 // смешанная
  // 10 машин: на старте каждой трассы (модели — все пять, по две; спорткары — на прямой и «стадионе»); a — куда смотрит
  const car = (x0, y0, vert, model, color, a) => b.prop('car', x0, y0, x0 + (vert ? 1 : 3), y0 + (vert ? 3 : 1), { model, color, a });
  car(10, 3, false, 'sedan', '#2f3a48', 0); car(10, 6, false, 'suv', '#7a3b32', 0);
  car(11, 74, true, 'hatch', '#c9c3b5', -Math.PI / 2); car(16, 78, true, 'van', '#6c7580', -Math.PI / 2);
  car(74, 74, true, 'sedan', '#8a6a2a', -Math.PI / 2); car(79, 78, true, 'hatch', '#3f5f7a', -Math.PI / 2);
  car(153, 26, false, 'suv', '#5f6a3a', 0); car(153, 31, false, 'van', '#7a3f32', 0);
  car(10, 10, false, 'sport', '#b8241c', 0); car(11, 81, true, 'sport', '#e0b020', -Math.PI / 2);
  const m = finishMap(b, { name: 'АВТОДРОМ', start: { x: 24, y: 13, a: 0 } });
  map.tracks = tracks.map((t) => ({ ...t, pts: t.pts.map((p) => ({ x: p.x * TILE, y: p.y * TILE, s: p.s })) }));
  return m;
}

// ---------- Боты за рулём на автодроме (только при VEH.botDrive) ----------
// Свободный бот берёт ближайшую свободную машину и катает круги по той трассе, у старта которой она стоит
function raceBots() {
  if (!VEH.botDrive || G.mapId !== 'race' || !map.tracks || !isAuth()) return;
  for (const e of G.players) {
    if (!e.ai || e.dead || e.down || e.drive) continue;
    let car = null, bd = 1e9;
    for (const c of map.cars) {
      if (c.seats[0]) continue;
      if (G.players.some((q) => q !== e && q.drive && q.drive.car === c)) continue;
      const d = Math.hypot(c.x - e.x, c.y - e.y);
      if (d < bd) { bd = d; car = c; }
    }
    if (!car) return;
    let tr = null, td = 1e9;
    for (const t of map.tracks) for (const p of t.pts) { const d = Math.hypot(p.x - car.x, p.y - car.y); if (d < td) { td = d; tr = t; } }
    botDrive(e, car, { pts: tr.pts, loop: tr.loop });
  }
}
