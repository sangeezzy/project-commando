'use strict';
// ---------- Освещение, фонарь, автоэкспозиция ----------
// Яркость мира: карта освещённости (день на улице, тёмные помещения, свет из дверей) + фонари + вспышки выстрелов.
// Глаз привыкает к яркости того, на что смотрит (G.expo): в темноте сначала почти ничего не видно,
// на свету после темноты картинка засвечена. Противники тоже видят хуже в темноте.

const LSUB = 4;                 // карта освещённости: 4 ячейки на клетку (стены светятся со стороны соседнего пола)
const LQ = 4;                   // экранный буфер света в 4 раза меньше экрана: дёшево и мягко

// ---------- Карта освещённости ----------
// Строится один раз на карту (buildLightMap); дверь открыли/закрыли — пересчитывается только кусок вокруг неё (updateLightAt):
// свет растекается не дальше LIGHT.spillSteps клеток, остальная карта от двери не зависит.
const LBLUR = 'blur(1.5px)', LBLUR_M = 5;    // размытие текстуры света и сколько пикселей ячеек оно задевает вокруг

function buildLightMap(base) {
  const { w, h } = map;
  map.light = new Float32Array(w * h);
  spillLight(base, 0, 0, w - 1, h - 1, 0, 0, w - 1, h - 1);
  const W = w * LSUB, H = h * LSUB;
  map.lightSub = new Float32Array(W * H); map.lw = W; map.lh = H;
  map.lightRaw = document.createElement('canvas');
  map.lightRaw.width = W; map.lightRaw.height = H;
  map.lightCanvas = document.createElement('canvas');
  map.lightCanvas.width = W; map.lightCanvas.height = H;
  lightCells(0, 0, w - 1, h - 1);
  paintLight(0, 0, w - 1, h - 1);
}

// Дверь в клетке (tx, ty) открылась или закрылась
function updateLightAt(tx, ty) {
  const R = LIGHT.spillSteps, { w, h } = map;
  const c = (v, n) => clamp(v, 0, n - 1);
  // растекание считаем в окне 2R вокруг двери (пути длиной ≤ R от изменившихся клеток не выходят из него),
  // берём — изменившиеся клетки (≤ R от двери); ячейки и текстура — ещё на клетку шире (стены берут свет соседнего пола)
  spillLight(map.lightBase, c(tx - 2 * R - 1, w), c(ty - 2 * R - 1, h), c(tx + 2 * R + 1, w), c(ty + 2 * R + 1, h),
    c(tx - R, w), c(ty - R, h), c(tx + R, w), c(ty + R, h));
  const x0 = c(tx - R - 1, w), y0 = c(ty - R - 1, h), x1 = c(tx + R + 1, w), y1 = c(ty + R + 1, h);
  lightCells(x0, y0, x1, y1);
  paintLight(x0, y0, x1, y1);
}

// Свет затекает из дверей и проёмов (но не сквозь стены; закрытая дверь держит свет): spillSteps шагов в окне (x0..x1, y0..y1)
// от исходной освещённости base; в map.light записываются клетки (cx0..cx1, cy0..cy1)
function spillLight(base, x0, y0, x1, y1, cx0, cy0, cx1, cy1) {
  const { w, h } = map, ww = x1 - x0 + 1, wh = y1 - y0 + 1, g = map.grid, k = LIGHT.spill;
  const open = new Uint8Array(ww * wh);
  let L = new Float32Array(ww * wh);
  for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
    const i = (y0 + y) * w + x0 + x;
    L[y * ww + x] = base[i];
    open[y * ww + x] = opaqueT(g[i]) ? 0 : 1;
  }
  // как во всей карте: крайние клетки карты сами не меняются, но отдают свет соседям
  const ax = Math.max(0, 1 - x0), ay = Math.max(0, 1 - y0), bx = Math.min(ww - 1, w - 2 - x0), by = Math.min(wh - 1, h - 2 - y0);
  let n = new Float32Array(ww * wh);
  for (let it = 0; it < LIGHT.spillSteps; it++) {
    n.set(L);
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) {
      const i = y * ww + x;
      if (!open[i]) continue;
      let m = L[i], v;
      if (x > 0 && open[i - 1] && (v = L[i - 1] * k) > m) m = v;
      if (x < ww - 1 && open[i + 1] && (v = L[i + 1] * k) > m) m = v;
      if (y > 0 && open[i - ww] && (v = L[i - ww] * k) > m) m = v;
      if (y < wh - 1 && open[i + ww] && (v = L[i + ww] * k) > m) m = v;
      n[i] = m;
    }
    const t = L; L = n; n = t;
  }
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) map.light[y * w + x] = L[(y - y0) * ww + x - x0];
}

// Ячейки LSUB×LSUB на клетку: стена берёт освещённость ближайшей к ячейке соседней клетки пола
function lightCells(x0, y0, x1, y1) {
  const { w, h } = map, L = map.light, W = map.lw, sub = map.lightSub;
  const open = (i) => !opaqueT(map.grid[i]);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * w + x;
    if (open(i)) {
      for (let sy = 0; sy < LSUB; sy++) sub.fill(L[i], (y * LSUB + sy) * W + x * LSUB, (y * LSUB + sy) * W + x * LSUB + LSUB);
      continue;
    }
    for (let sy = 0; sy < LSUB; sy++) for (let sx = 0; sx < LSUB; sx++) {
      const cx = x + (sx + 0.5) / LSUB, cy = y + (sy + 0.5) / LSUB;
      let bd = 1e9, v = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open(ny * w + nx)) continue;
        const d = Math.hypot(clamp(cx, nx, nx + 1) - cx, clamp(cy, ny, ny + 1) - cy);
        if (d < bd) { bd = d; v = L[ny * w + nx]; }
      }
      if (bd === 1e9) v = 1;
      sub[(y * LSUB + sy) * W + x * LSUB + sx] = v;
    }
  }
}

// Текстура света для клеток (x0..x1, y0..y1): ячейки → пиксели (lightRaw), сверху — лёгкое размытие (lightCanvas, края света мягкие).
// Размытие куска: источник берётся с запасом, рисуется только внутри куска (+ сколько задевает размытие) — шов не виден
function paintLight(x0, y0, x1, y1) {
  const W = map.lw, H = map.lh, sub = map.lightSub;
  const X0 = x0 * LSUB, Y0 = y0 * LSUB, RW = (x1 - x0 + 1) * LSUB, RH = (y1 - y0 + 1) * LSUB;
  const raw = map.lightRaw, rg = raw.getContext('2d');
  const img = rg.createImageData(RW, RH), d = img.data;
  for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
    const c = Math.round(clamp(sub[(Y0 + y) * W + X0 + x], 0, 1) * 255), o = (y * RW + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = c; d[o + 3] = 255;
  }
  rg.putImageData(img, X0, Y0);
  const box = (m) => {
    const ax = Math.max(0, X0 - m), ay = Math.max(0, Y0 - m);
    return [ax, ay, Math.min(W, X0 + RW + m) - ax, Math.min(H, Y0 + RH + m) - ay];
  };
  const [cx, cy, cw, ch] = box(LBLUR_M), [sx, sy, sw, sh] = box(LBLUR_M * 2 + 2);
  const g = map.lightCanvas.getContext('2d');
  g.save();
  g.beginPath(); g.rect(cx, cy, cw, ch); g.clip();
  g.drawImage(raw, sx, sy, sw, sh, sx, sy, sw, sh);
  g.filter = LBLUR;
  g.drawImage(raw, sx, sy, sw, sh, sx, sy, sw, sh);
  g.restore();
}

// Освещённость помещения/улицы в точке (билинейно по ячейкам)
function ambientAt(x, y) {
  const fx = (x / TILE) * LSUB - 0.5, fy = (y / TILE) * LSUB - 0.5;
  const x0 = clamp(Math.floor(fx), 0, map.lw - 1), y0 = clamp(Math.floor(fy), 0, map.lh - 1);
  const x1 = Math.min(x0 + 1, map.lw - 1), y1 = Math.min(y0 + 1, map.lh - 1);
  const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1), s = map.lightSub, W = map.lw;
  const a = s[y0 * W + x0] + (s[y0 * W + x1] - s[y0 * W + x0]) * tx;
  const b = s[y1 * W + x0] + (s[y1 * W + x1] - s[y1 * W + x0]) * tx;
  return a + (b - a) * ty;
}

// Угловой профиль фонаря: яркое ядро и широкий плавный ореол
function lampAngular(off) {
  if (off <= LIGHT.lampCore) return 1;
  if (off >= LIGHT.lampEdge) return 0;
  const k = (LIGHT.lampEdge - off) / (LIGHT.lampEdge - LIGHT.lampCore);
  return k * k;
}
const lampRadial = (d) => Math.pow(Math.max(0, 1 - d / LIGHT.lampRange), 1.5);

// Свет фонаря бойца p в точке (без проверки стен)
function lampK(p, x, y) {
  const d = Math.hypot(x - p.x, y - p.y);
  let v = d < LIGHT.lampSpillR ? LIGHT.lampSpill * (1 - d / LIGHT.lampSpillR) : 0;
  if (d < LIGHT.lampRange) v += LIGHT.lampPower * lampAngular(Math.abs(angDiff(Math.atan2(y - p.y, x - p.x), p.a))) * lampRadial(d);
  return v;
}

const lampOn = (p) => p.lamp && !p.dead;

// Полная освещённость точки: помещение + фонари + вспышки выстрелов
// only — учитывать из фонарей только этого бойца (для его глаз чужой свет в лицо считается отдельно, как ослепление)
function lightAt(x, y, only = null) {
  let v = ambientAt(x, y);
  for (const p of [...G.players, ...G.enemies]) {
    if (!lampOn(p) || (only && p !== only)) continue;
    const k = lampK(p, x, y);
    if (k > 0.005 && los(p.x, p.y, x, y)) v += k;
  }
  if (G.muzzle) for (const m of G.muzzle) {
    const d = Math.hypot(x - m.x, y - m.y);
    if (d < LIGHT.flashR && los(m.x, m.y, x, y)) v += LIGHT.flash * (m.t / 0.05) * (1 - d / LIGHT.flashR);
  }
  return Math.min(v, 2);
}

// Усиление глаза, привыкшего к яркости A
const gainFor = (A) => clamp(Math.pow(1 / Math.max(A, 1e-3), LIGHT.gainPow), 1, LIGHT.maxGain);

// Насколько хорошо наблюдатель o различает человека t (0..1+): освещённость цели × привыкание к своей обстановке.
// Включённый фонарь, направленный на наблюдателя, слепит и выдаёт сразу.
function seenBrightness(o, t) {
  const v = lightAt(t.x, t.y) * gainFor(lightAt(o.x, o.y));
  // фонарь в лицо выдаёт светящего — в темноте; днём его почти не видно
  if (lampOn(t) && lampK(t, o.x, o.y) > 0.05) return Math.max(v, Math.min(1, 2 * glareDarkness(o.x, o.y)));
  return v;
}

// Насколько темно вокруг глаза: 1 — темнота, 0 — светлее LIGHT.glareDark (днём фонарь не слепит)
const glareDarkness = (x, y) => clamp(1 - ambientAt(x, y) / LIGHT.glareDark, 0, 1);

// Слепящий свет чужих фонарей в глаза бойцу o: сильнее, если смотрит на источник; только в темноте
function glareAt(o) {
  const dk = glareDarkness(o.x, o.y);
  if (dk <= 0) return 0;
  let g = 0;
  for (const l of [...G.players, ...G.enemies]) {
    if (l === o || !lampOn(l)) continue;
    const d = Math.hypot(o.x - l.x, o.y - l.y);
    if (d > LIGHT.lampRange) continue;
    const beam = LIGHT.lampPower * lampAngular(Math.abs(angDiff(Math.atan2(o.y - l.y, o.x - l.x), l.a))) * lampRadial(d);
    if (beam < 0.01 || !los(l.x, l.y, o.x, o.y)) continue;
    const look = Math.max(0, Math.cos(angDiff(Math.atan2(l.y - o.y, l.x - o.x), o.a)));
    g += beam * (0.3 + 0.7 * look);
  }
  return g * dk;
}

// ---------- Автоэкспозиция игрока ----------
// Ключевая яркость — лог-среднее по точке бойца и по направлению взгляда (до стены).
// Свет в точке бойца: без чужих фонарей (их ослепление — glareAt, только в темноте). Ключ не выше дня:
// на улице свет фонарей не «пересвечивает» глаз, и потом в темноте он привыкает как обычно.
function exposureKey(p) {
  const self = Math.min(1, lightAt(p.x, p.y, p)) + LIGHT.glare * glareAt(p);
  let sum = 2 * Math.log(self + 0.005), wsum = 2;
  const ux = Math.cos(p.a), uy = Math.sin(p.a);
  const wall = castRay(p.x, p.y, ux, uy, M(10));
  for (let k = 1; k <= 4; k++) {
    const d = M(2 * k);
    if (d > wall - 8) break;
    sum += Math.log(Math.min(1, lightAt(p.x + ux * d, p.y + uy * d)) + 0.005); wsum += 1;
  }
  return Math.min(Math.exp(sum / wsum), 2);
}

function updateExposure(p, dt) {
  const key = exposureKey(p);
  if (!G.expo) G.expo = { A: key, gain: gainFor(key), key };
  const e = G.expo;
  const tau = key > e.A ? LIGHT.adaptBright : LIGHT.adaptDark;
  const la = Math.log(e.A) + (Math.log(key) - Math.log(e.A)) * (1 - Math.exp(-dt / tau));
  e.A = Math.exp(la); e.key = key;
  e.gain = gainFor(e.A);
}

// Что игрок видит в точке: яркость с учётом привыкания (больше 1 — засветка)
const perceivedAt = (x, y) => lightAt(x, y) * (G.expo ? G.expo.gain : 1);
// Сколько белого добавляет засветка при видимой яркости v (то же считает фильтр в drawLighting)
const overAmount = (v) => clamp((v - 1) / LIGHT.overRange, 0, 1) * LIGHT.overexpose;

// ---------- Отрисовка света ----------
const lightC = document.createElement('canvas'), lightX = lightC.getContext('2d');

// Многоугольник, куда достаёт свет из точки (стены задерживают), в координатах мира.
// Кэш: за кадр фонарь рисуется дважды (буфер света и дневной контур), стоящий — с того же места много кадров
const lightPolyCache = new Map();
function lightPoly(x, y, r, rays) {
  const key = `${x},${y},${r},${rays},${map.ver}`;
  let poly = lightPolyCache.get(key);
  if (poly) return poly;
  if (lightPolyCache.size > 48) lightPolyCache.clear();
  poly = new Path2D();
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    const d = Math.min(r, castRay(x, y, dx, dy, r) + 4);
    if (i === 0) poly.moveTo(x + dx * d, y + dy * d); else poly.lineTo(x + dx * d, y + dy * d);
  }
  poly.closePath();
  lightPolyCache.set(key, poly);
  return poly;
}

// Пятно фонаря (луч вправо, центр — боец), нарисованное один раз с размытием: размытие — самая дорогая операция canvas,
// а форма пятна от кадра к кадру не меняется. Пересобирается, только если поменялись настройки фонаря.
const LAMP_SPRITE_K = 0.5;       // пикселей заготовки на пиксель мира (пятно мягкое — полного разрешения не нужно)
let lampSprite = null;
function lampSpriteFor() {
  const R = LIGHT.lampRange;
  const key = [R, LIGHT.lampCore, LIGHT.lampEdge, LIGHT.lampPower, LIGHT.lampSpill, LIGHT.lampSpillR].join();
  if (lampSprite && lampSprite.key === key) return lampSprite.c;
  const s = LAMP_SPRITE_K, size = Math.ceil(2 * R * s);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.setTransform(s, 0, 0, s, size / 2, size / 2);
  g.globalCompositeOperation = 'lighter';
  // рассеянный конус: слои от узкого ядра к широкому ореолу, плюс размытие
  g.filter = `blur(${Math.max(1, Math.round(6 * s))}px)`;
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, R);
  for (let i = 0; i <= 10; i++) gr.addColorStop(i / 10, `rgba(255,255,255,${LIGHT.lampPower * lampRadial((i / 10) * R)})`);
  g.fillStyle = gr;
  const N = 8;
  let prev = 1;
  for (let i = 1; i <= N; i++) {
    const half = LIGHT.lampCore + ((LIGHT.lampEdge - LIGHT.lampCore) * i) / N;
    const f = lampAngular(half - 1e-6);
    g.globalAlpha = Math.max(0, prev - f);
    prev = f;
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, -half, half); g.closePath(); g.fill();
  }
  // отражённый свет вокруг бойца
  g.globalAlpha = 1;
  const sp = g.createRadialGradient(0, 0, 0, 0, 0, LIGHT.lampSpillR);
  sp.addColorStop(0, `rgba(255,255,255,${LIGHT.lampSpill})`); sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp;
  g.fillRect(-LIGHT.lampSpillR, -LIGHT.lampSpillR, LIGHT.lampSpillR * 2, LIGHT.lampSpillR * 2);
  lampSprite = { key, c };
  return c;
}

// k — общая сила (1 — свет в буфере освещения, меньше — дневной контур луча)
function drawLamp(g, p, k = 1) {
  const R = LIGHT.lampRange;
  g.save();
  g.clip(lightPoly(p.x, p.y, R, 360));
  g.translate(p.x, p.y);
  g.rotate(p.a);
  g.globalAlpha = k;
  g.imageSmoothingEnabled = true;
  g.drawImage(lampSpriteFor(), -R, -R, 2 * R, 2 * R);
  g.restore();
}

function drawFlashLight(g, m) {
  const R = LIGHT.flashR;
  g.save();
  g.clip(lightPoly(m.x, m.y, R, 64));
  const gr = g.createRadialGradient(m.x, m.y, 0, m.x, m.y, R);
  gr.addColorStop(0, `rgba(255,240,210,${LIGHT.flash * Math.min(1, m.t / 0.05)})`); gr.addColorStop(1, 'rgba(255,240,210,0)');
  g.fillStyle = gr;
  g.fillRect(m.x - R, m.y - R, R * 2, R * 2);
  g.restore();
}

// Наложить свет на уже нарисованный мир: умножение на яркость × усиление глаза, затем засветка там, где ярче 1
// Контур луча на свету: там, где яркость и так на максимуме, добавка фонаря пропадает —
// рисуем поверх слабое свечение, тем заметнее, чем светлее вокруг (в темноте луч и так виден)
function drawLampDaylight() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const o of [...G.players, ...G.enemies]) {
    if (!lampOn(o) || !onScreen(o.x, o.y, LIGHT.lampRange)) continue;
    const k = LIGHT.lampDay * clamp(ambientAt(o.x, o.y), 0, 1);
    if (k > 0.005) drawLamp(ctx, o, k);
  }
  ctx.restore();
}

// view — многоугольник видимости игрока: за его пределами глаз не участвует, экспозиция нейтральная
function drawLighting(offX, offY, view) {
  const z = G.zoom, w = Math.ceil(VW / LQ), h = Math.ceil(VH / LQ);
  if (lightC.width !== w || lightC.height !== h) { lightC.width = w; lightC.height = h; }
  const g = lightX;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.globalAlpha = 1;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.setTransform(z / LQ, 0, 0, z / LQ, offX / LQ, offY / LQ);
  g.imageSmoothingEnabled = true;
  g.drawImage(map.lightCanvas, 0, 0, map.w * TILE, map.h * TILE);
  g.globalCompositeOperation = 'lighter';
  for (const o of [...G.players, ...G.enemies]) if (lampOn(o) && onScreen(o.x, o.y, LIGHT.lampRange)) drawLamp(g, o);
  if (G.muzzle) for (const m of G.muzzle) if (onScreen(m.x, m.y, LIGHT.flashR)) drawFlashLight(g, m);
  const gain = G.expo ? G.expo.gain : 1;
  if (view && gain > 1.01) {
    // вне видимости делим на усиление: после brightness(gain) там останется обычная яркость без засветки
    const outside = new Path2D();
    outside.rect(-offX / z - 8, -offY / z - 8, VW / z + 16, VH / z + 16);     // экран в координатах мира
    outside.addPath(view);
    const c = Math.round(255 / gain);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${c},${c},${c})`;
    g.fill(outside, 'evenodd');
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';

  // фильтры — на маленьком буфере (в LQ² раз меньше пикселей), на экран — только растянуть без фильтра.
  // Без усиления (обычный день) фильтр не нужен, а засветки нет: в 8-битном буфере L ≤ 1, значит g·L ≤ 1
  const lit = Math.abs(gain - 1) < 1e-3 ? lightC : lightPass(0, w, h, `brightness(${gain})`);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(lit, 0, 0, w, h, 0, 0, w * LQ, h * LQ);
  if (gain > 1 + 1e-3) {
    // засветка (g·L − 1) / R: brightness(k) + contrast(c) дают c·k·L + 0,5 − 0,5c, откуда c = 1 + 2/R, k = g / (R·c)
    const R = LIGHT.overRange, c = 1 + 2 / R;
    const over = lightPass(1, w, h, `brightness(${gain / (R * c)}) contrast(${c})`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = LIGHT.overexpose;
    ctx.drawImage(over, 0, 0, w, h, 0, 0, w * LQ, h * LQ);
  }
  ctx.restore();
}

// Буфер света через фильтр в отдельный маленький холст (i — какой из двух)
const lightPassC = [0, 1].map(() => { const c = document.createElement('canvas'); return { c, g: c.getContext('2d') }; });
function lightPass(i, w, h, filter) {
  const { c, g } = lightPassC[i];
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'copy';
  g.filter = filter;
  g.drawImage(lightC, 0, 0);
  g.filter = 'none';
  return c;
}
