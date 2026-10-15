'use strict';
// ---------- Погода (пока — на карте «Выживание»): видимость и слышимость для всех, дождь, гроза, туман ----------
// G.weather: kind — что сейчас «задумано», vis/hear/rain/fog — текущие значения (плавно идут к целевым WEATHER[kind] за ~blend с),
// bolt — счётчик молний (гость видит вспышку, когда он растёт), flash — яркость вспышки.
// Видимость: ИИ видит не дальше ENEMY.sight × vis и замечает дольше; игрок видит противников не дальше VIS_BASE × vis.
// Слышимость: радиус шума (makeNoise) и громкость далёких звуков × hear.

const WEATHER = {
  clear: { name: 'ясно', w: 40, vis: 1, hear: 1, rain: 0, fog: 0 },
  rain: { name: 'слабый дождь', w: 25, vis: 0.85, hear: 0.95, rain: 0.35, fog: 0.08 },
  heavy: { name: 'сильный дождь', w: 13, vis: 0.6, hear: 0.82, rain: 1, fog: 0.2 },
  storm: { name: 'гроза', w: 12, vis: 0.6, hear: 0.65, rain: 1, fog: 0.2, storm: true },
  fog: { name: 'туман', w: 10, vis: 0.33, hear: 1, rain: 0, fog: 1 },
};
const WEATHER_IDS = ['clear', 'rain', 'heavy', 'storm', 'fog'];
const VIS_BASE = M(70);            // дальше этого в ясную погоду противников не различить (на экране) — наибольшая видимость
// Видимость до погоды (OPTS.sight у хоста, гостю — в снимке `vs`): 10, 15, … 70 м; sightK — доля от VIS_BASE (и для ИИ — от ENEMY.sight)
const SIGHT = { min: 10, step: 5, max: 70 };
const sightM = () => clamp((isAuth() ? OPTS.sight : G.netSight) || SIGHT.max, SIGHT.min, SIGHT.max);
const sightK = () => M(sightM()) / VIS_BASE;
// K — меньше на 5 м (с 10 — снова 70), Shift+K — больше (с 70 — 10); только хост и одиночка
function stepSight(d) {
  if (!isAuth()) { toast('ВИДИМОСТЬ МЕНЯЕТ ХОСТ', 1.4); return; }
  let s = sightM() + d * SIGHT.step;
  if (s < SIGHT.min) s = SIGHT.max; else if (s > SIGHT.max) s = SIGHT.min;
  OPTS.sight = s; saveOpts();
  toast(`ВИДИМОСТЬ: ${s} М (K / SHIFT+K)`, 1.4);
}
const WEATHER_BLEND = 8;           // с: смена погоды
const BOLT_GAP = [12, 30];         // с: между молниями в грозу

const visK = () => (G.weather ? G.weather.vis : 1);
const hearK = () => (G.weather ? G.weather.hear : 1);

// Выбор погоды (rnd — генератор карты): ясно чаще всего, слабый дождь — второй, сильный и гроза — третьи, туман — реже всего
function rollWeather(rnd) {
  const total = WEATHER_IDS.reduce((s, k) => s + WEATHER[k].w, 0);
  let r = rnd() * total;
  for (const k of WEATHER_IDS) { r -= WEATHER[k].w; if (r < 0) return k; }
  return 'clear';
}
function initWeather(kind) {
  const W = WEATHER[kind];
  G.weather = { kind, vis: W.vis, hear: W.hear, rain: W.rain, fog: W.fog, bolt: 0, boltT: rand(BOLT_GAP[0], BOLT_GAP[1]), flash: 0, thunder: [] };
}
function setWeather(kind) {
  if (!G.weather) { initWeather(kind); return; }
  G.weather.kind = kind;
}

// Каждый кадр (хост, одиночка): значения плавно к целевым; гроза — молнии
function updateWeather(dt) {
  const w = G.weather;
  if (!w) return;
  const W = WEATHER[w.kind], k = Math.min(1, dt / WEATHER_BLEND * 3);
  for (const f of ['vis', 'hear', 'rain', 'fog']) w[f] += (W[f] - w[f]) * k;
  if (W.storm) {
    w.boltT -= dt;
    if (w.boltT <= 0) { w.boltT = rand(BOLT_GAP[0], BOLT_GAP[1]); w.bolt++; }
  }
}

// У каждого (и у гостя): вспышка и гром по счётчику молний; звук дождя
let lastBolt = 0, rainSnd = null;
// Вне игры (главное меню, лобби) — дождь не шумит (раньше петля оставалась с последней громкостью)
function rainSoundOff() { if (rainSnd) rainSnd.set(0); }
function weatherFx(dt) {
  const w = G.weather;
  if (!w) { if (rainSnd) { rainSnd.stop(); rainSnd = null; } return; }
  if (w.bolt !== lastBolt) {
    if (w.bolt > lastBolt) {
      w.flash = 1;
      w.thunder.push({ t: rand(1, 4.5), v: rand(0.6, 1) });      // гром — позже, по «расстоянию» до молнии
    }
    lastBolt = w.bolt;
  }
  w.flash = Math.max(0, w.flash - dt * 3.5);
  for (const th of w.thunder) { th.t -= dt; if (th.t <= 0 && !th.done) { th.done = true; SFX.thunder(th.v); } }
  w.thunder = w.thunder.filter((th) => !th.done);
  // дождь: шум, громкость — по силе
  if (AC) {
    if (!rainSnd && w.rain > 0.02) rainSnd = SFX.rainLoop();
    if (rainSnd) rainSnd.set(w.rain);
  }
}

// Отрисовка поверх мира (экранные координаты): дымка (туман, дождь), косые струи, вспышка молнии.
// m (у drawRain — cm) — матрица камеры (CAMM: сдвиг, масштаб, поворот), p — чьими глазами смотрим.
// Дождь (положения — от времени, без хранения частиц). Число струй — по площади экрана (на телефоне холст другой).
// Слабый — тонкие короткие струи. Сильный (rain > 0,5, heavy 0…1): гуще, второй слой — ближние длинные яркие струи,
// брызги на земле (привязаны к миру: при движении камеры не «едут»), сумрак. Упрощённый свет (OPTS.simpleLight) — вдвое реже.
function drawRain(rain, cm = CAMM) {
  const t = G.time, heavy = clamp((rain - 0.5) / 0.5, 0, 1);
  const area = (VW * VH) / (1280 * 720), lite = OPTS.simpleLight ? 0.5 : 1;
  const px = Math.max(1, VH / 720);                          // толщина и длина — по размеру холста
  if (heavy > 0) { ctx.fillStyle = `rgba(14,20,30,${0.16 * heavy})`; ctx.fillRect(0, 0, VW, VH); }
  // дальний слой
  const n = Math.round((260 * rain + 380 * heavy) * area * lite);
  ctx.strokeStyle = `rgba(190,200,215,${0.18 + 0.2 * rain})`; ctx.lineWidth = px;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const sx = (i * 977.3) % VW, sp = (900 + (i * 131) % 500) * px;
    const y = ((i * 613.7) + t * sp) % (VH + 40 * px) - 20 * px, x = (sx + t * 120 * px) % VW;
    ctx.moveTo(x, y); ctx.lineTo(x - 4 * px, y + (14 + 8 * heavy) * px);
  }
  ctx.stroke();
  if (heavy <= 0) return;
  // ближний слой: длинные косые струи
  const m = Math.round(110 * heavy * area * lite);
  ctx.strokeStyle = `rgba(215,225,240,${0.3 * heavy + 0.1})`; ctx.lineWidth = 1.6 * px;
  ctx.beginPath();
  for (let i = 0; i < m; i++) {
    const sx = (i * 733.1 + 211) % VW, sp = (1700 + (i * 97) % 600) * px;
    const y = ((i * 389.3) + t * sp) % (VH + 80 * px) - 40 * px, x = (sx + t * 260 * px) % VW;
    ctx.moveTo(x, y); ctx.lineTo(x - 9 * px, y + 34 * px);
  }
  ctx.stroke();
  // брызги: расходящиеся кольца, каждое живёт 0,35 с; точка — в мире (плитка со стороной P вокруг камеры, перевод — матрицей cm):
  // при сдвиге и повороте камеры брызги остаются на месте на земле. Плитка — по диагонали экрана (повёрнутый экран тоже покрыт),
  // число брызг — с запасом на её площадь (на экран попадает столько же, сколько раньше), лишние отсекаются
  const life = 0.35, z = Math.hypot(cm[0], cm[1]) || 1, P = Math.hypot(VW, VH) / z;
  const k = Math.round(90 * heavy * area * lite * (VW * VW + VH * VH) / (VW * VH));
  const cx = G.cam.x - P / 2, cy = G.cam.y - P / 2, pad = 8 * px;
  ctx.strokeStyle = `rgba(200,212,230,${0.45 * heavy})`; ctx.lineWidth = px;
  ctx.beginPath();
  for (let i = 0; i < k; i++) {
    const ph = (t / life + i * 0.618) % 1, gen = Math.floor(t / life + i * 0.618);
    const h = Math.sin(i * 12.9898 + gen * 78.233) * 43758.5453;
    const u = h - Math.floor(h), v = (h * 7.13) - Math.floor(h * 7.13);
    const X = cx + ((((u * P - cx) % P) + P) % P), Y = cy + ((((v * P - cy) % P) + P) % P);
    const wx = cm[0] * X + cm[2] * Y + cm[4], wy = cm[1] * X + cm[3] * Y + cm[5];
    if (wx < -pad || wy < -pad || wx > VW + pad || wy > VH + pad) continue;
    const r = (1.2 + 3.8 * ph) * px;
    ctx.moveTo(wx + r, wy);
    ctx.ellipse(wx, wy, r, r * 0.55, 0, 0, Math.PI * 2);
  }
  ctx.stroke();
}

// Маленький буфер пелены (упрощённый свет)
const veilC = document.createElement('canvas'), veilX = veilC.getContext('2d');
function veilBuf(w, h) {
  if (veilC.width !== w || veilC.height !== h) { veilC.width = w; veilC.height = h; }
  veilX.setTransform(1, 0, 0, 1, 0, 0);
  veilX.clearRect(0, 0, w, h);
  return veilX;
}

// Пелена видимости: edge — ширина перехода у границы, м (edgePx — не уже, px экрана); capped — плотность за границей, когда
// видимость ограничена настройкой (K / меню)
const VEIL = { edge: 2, edgePx: 20, capped: 0.88 };
function drawWeather(m = CAMM, p = null) {
  const w = G.weather, vis = w ? w.vis : 1, fog = w ? w.fog : 0, sk = sightK();
  if (!w && sk > 0.995) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // дымка — вокруг глаз бойца: дальше VIS_BASE × vis противников не различить (playerSees), там же на экране — почти сплошная пелена;
  // ближе — плотнеет с расстоянием. Туман — светло-серый, дождь — сизый.
  if ((vis < 0.995 || fog > 0.01 || sk < 0.995) && !G.noFog) {      // отладка ]: без пелены; видимость меньше 70 м — пелена и без погоды
    const z = G.zoom, eye = p && !p.dead ? eyeOf(p) : G.cam;
    const es = worldToScreen(eye.x, eye.y, CAMM), ex = es.x, ey = es.y, D = VIS_BASE * sk * vis * z;
    // за границей — плотная пелена (видимость ограничена настройкой — не прозрачнее VEIL.capped: граница читается)
    const fk = clamp(fog, 0, 1), aMax = clamp(Math.max(0.45 + 0.5 * fk + 0.4 * (1 - vis) + 0.5 * (1 - sk), sk < 0.995 ? VEIL.capped : 0), 0, 0.96);
    const c = `${Math.round(118 + 52 * fk)},${Math.round(128 + 47 * fk)},${Math.round(142 + 38 * fk)}`;
    // градиент — в буфер в 4 раза меньше (упрощённый свет — в 8), на экран — растянуть: плавный, размытия не видно, а растеризация
    // градиента на весь экран — одна из самых дорогих операций кадра
    const q = OPTS.simpleLight ? 8 : 4, tg = veilBuf(Math.ceil(VW / q), Math.ceil(VH / q));
    // чёткая граница: до неё пелена плотнеет слабо, у самой границы — узкая полоса (VEIL.edge м, не уже VEIL.edgePx px) до полной.
    // Граница — ровно там, дальше чего противников не различить (playerSees)
    const band = clamp(Math.max(M(VEIL.edge) * z, VEIL.edgePx) / Math.max(1, D), 0.02, 0.3);
    const gr = tg.createRadialGradient(ex / q, ey / q, 0, ex / q, ey / q, D / q);
    gr.addColorStop(0, `rgba(${c},${0.04 * fk})`);
    gr.addColorStop(0.4, `rgba(${c},${aMax * 0.1})`);
    gr.addColorStop(1 - band, `rgba(${c},${aMax * 0.3})`);
    gr.addColorStop(1, `rgba(${c},${aMax})`);
    tg.fillStyle = gr; tg.fillRect(0, 0, VW / q + 1, VH / q + 1);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(veilC, 0, 0, veilC.width, veilC.height, 0, 0, veilC.width * q, veilC.height * q);
  }
  if (w && w.rain > 0.02) drawRain(w.rain, m);
  if (w && w.flash > 0.01) { ctx.fillStyle = `rgba(235,240,255,${w.flash * 0.55})`; ctx.fillRect(0, 0, VW, VH); }
  ctx.restore();
}

// Для снимка: [вид, видимость, слышимость, дождь, туман, молний]
const weatherState = () => (G.weather ? [WEATHER_IDS.indexOf(G.weather.kind), r2(G.weather.vis), r2(G.weather.hear), r2(G.weather.rain), r2(G.weather.fog), G.weather.bolt] : 0);
function applyWeatherState(a) {
  if (!a) { G.weather = null; return; }
  if (!G.weather) initWeather(WEATHER_IDS[a[0]]);
  Object.assign(G.weather, { kind: WEATHER_IDS[a[0]], vis: a[1], hear: a[2], rain: a[3], fog: a[4], bolt: a[5] });
}
