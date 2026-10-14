'use strict';
/* =====================================================================
   PROJECT COMMANDO — реалистичный top-down шутер (черновик).
   Скрипты обычные (не модули), общий глобальный scope. Порядок загрузки — в index.html.
   ===================================================================== */

const TILE = 32;               // клетка = 1 м
const PR = 10;                 // радиус человека сверху (~0,3 м)

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r1 = (v) => Math.round(v);
const r2 = (v) => Math.round(v * 100) / 100;
const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const turnTo = (a, t, max) => a + clamp(angDiff(t, a), -max, max);

function rgba(hex, a) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Детерминированный генератор (mulberry32): карты у хоста и гостей строятся одинаково
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const fmtTime = (s) => {
  s = Math.max(0, Math.ceil(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Нормальное распределение (Бокс — Мюллер): разброс выстрелов
function gauss() {
  let u = 0;
  while (!u) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
