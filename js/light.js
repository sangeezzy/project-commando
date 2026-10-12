'use strict';
// ---------- Освещение, фонарь, автоэкспозиция ----------
// Яркость мира: карта освещённости (день на улице, тёмные помещения, свет из дверей) + фонари + вспышки выстрелов.
// Глаз привыкает к яркости того, на что смотрит (G.expo): в темноте сначала почти ничего не видно,
// на свету после темноты картинка засвечена. Противники тоже видят хуже в темноте.

const LSUB = 4;                 // карта освещённости: 4 ячейки на клетку (стены светятся со стороны соседнего пола)
const LQ = 4;                   // экранный буфер света в 4 раза меньше экрана: дёшево и мягко

// ---------- Карта освещённости ----------
function buildLightMap(base) {
  const { w, h } = map;
  const open = (i) => !opaqueT(map.grid[i]);   // закрытая дверь держит свет
  // свет затекает из дверей и проёмов (но не сквозь стены)
  let L = Float32Array.from(base);
  for (let it = 0; it < LIGHT.spillSteps; it++) {
    const n = L.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!open(i)) continue;
      let m = L[i];
      for (const j of [i - 1, i + 1, i - w, i + w]) if (open(j)) m = Math.max(m, L[j] * LIGHT.spill);
      n[i] = m;
    }
    L = n;
  }
  map.light = L;
  // ячейки: стена берёт освещённость ближайшей к ячейке соседней клетки пола
  const W = w * LSUB, H = h * LSUB;
  const sub = new Float32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    for (let sy = 0; sy < LSUB; sy++) for (let sx = 0; sx < LSUB; sx++) {
      let v = L[i];
      if (!open(i)) {
        const cx = x + (sx + 0.5) / LSUB, cy = y + (sy + 0.5) / LSUB;
        let bd = 1e9;
        v = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !open(ny * w + nx)) continue;
          const d = Math.hypot(clamp(cx, nx, nx + 1) - cx, clamp(cy, ny, ny + 1) - cy);
          if (d < bd) { bd = d; v = L[ny * w + nx]; }
        }
        if (bd === 1e9) v = 1;
      }
      sub[(y * LSUB + sy) * W + x * LSUB + sx] = v;
    }
  }
  map.lightSub = sub; map.lw = W; map.lh = H;
  const raw = document.createElement('canvas');
  raw.width = W; raw.height = H;
  const g = raw.getContext('2d');
  const img = g.createImageData(W, H);
  for (let k = 0; k < W * H; k++) {
    const c = Math.round(clamp(sub[k], 0, 1) * 255);
    img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = c; img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // лёгкое размытие: края света мягкие
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const cg = c.getContext('2d');
  cg.drawImage(raw, 0, 0);
  cg.filter = 'blur(1.5px)';
  cg.drawImage(raw, 0, 0);
  map.lightCanvas = c;
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

// Многоугольник, куда достаёт свет из точки (стены задерживают), в координатах мира
function lightPoly(x, y, r, rays) {
  const poly = new Path2D();
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    const d = Math.min(r, castRay(x, y, dx, dy, r) + 4);
    if (i === 0) poly.moveTo(x + dx * d, y + dy * d); else poly.lineTo(x + dx * d, y + dy * d);
  }
  poly.closePath();
  return poly;
}

// k — общая сила (1 — свет в буфере освещения, меньше — дневной контур луча)
function drawLamp(g, p, k = 1) {
  const R = LIGHT.lampRange;
  g.save();
  g.clip(lightPoly(p.x, p.y, R, 360));
  // рассеянный конус: слои от узкого ядра к широкому ореолу, плюс размытие
  g.filter = g === ctx ? 'blur(8px)' : 'blur(3px)';    // буфер света в 4 раза мельче экрана
  const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
  for (let i = 0; i <= 10; i++) gr.addColorStop(i / 10, `rgba(255,255,255,${LIGHT.lampPower * lampRadial((i / 10) * R) * k})`);
  g.fillStyle = gr;
  const N = 8;
  let prev = 1;
  for (let i = 1; i <= N; i++) {
    const half = LIGHT.lampCore + ((LIGHT.lampEdge - LIGHT.lampCore) * i) / N;
    const f = lampAngular(half - 1e-6);
    g.globalAlpha = Math.max(0, prev - f);
    prev = f;
    g.beginPath(); g.moveTo(p.x, p.y); g.arc(p.x, p.y, R, p.a - half, p.a + half); g.closePath(); g.fill();
  }
  // отражённый свет вокруг бойца
  g.globalAlpha = 1;
  const sp = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, LIGHT.lampSpillR);
  sp.addColorStop(0, `rgba(255,255,255,${LIGHT.lampSpill * k})`); sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp;
  g.fillRect(p.x - LIGHT.lampSpillR, p.y - LIGHT.lampSpillR, LIGHT.lampSpillR * 2, LIGHT.lampSpillR * 2);
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
    outside.rect(-1e5, -1e5, 2e5, 2e5);
    outside.addPath(view);
    const c = Math.round(255 / gain);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${c},${c},${c})`;
    g.fill(outside, 'evenodd');
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'multiply';
  ctx.filter = `brightness(${gain})`;
  ctx.drawImage(lightC, 0, 0, w * LQ, h * LQ);
  // засветка (g·L − 1) / R: brightness(k) + contrast(c) дают c·k·L + 0,5 − 0,5c, откуда c = 1 + 2/R, k = g / (R·c)
  const R = LIGHT.overRange, c = 1 + 2 / R;
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `brightness(${gain / (R * c)}) contrast(${c})`;
  ctx.globalAlpha = LIGHT.overexpose;
  ctx.drawImage(lightC, 0, 0, w * LQ, h * LQ);
  ctx.restore();
}
