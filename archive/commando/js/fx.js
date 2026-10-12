'use strict';
// ---------- Эффекты (частицы, звук), общие для хоста и гостей ----------

function addPart(x, y, vx, vy, life, color, size, drag = 3, shape = 0, spin = 0) {
  if (G.parts.length > 1800) return;
  G.parts.push({ x, y, vx, vy, life, max: life, color, size, drag, shape, rot: Math.random() * 6, spin });
}
function burst(x, y, color, n, sp, life, size = 2) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(0.2, 1) * sp;
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1) * life, color, size);
  }
}
// Осколки: вращающиеся кусочки брони/хитина, летят по направлению удара
function chunks(x, y, color, n, dir, sp, size = 4) {
  for (let i = 0; i < n; i++) {
    const a = dir + rand(-0.9, 0.9), s = rand(0.4, 1) * sp;
    addPart(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.6, 1.1), color, rand(size * 0.6, size), 4, 1, rand(-14, 14));
  }
}
function addRing(x, y, r, color) {
  G.rings.push({ x, y, r, t: 0, color });
  if (G.rings.length > 60) G.rings.shift();
}
function addDecal(x, y, r, color, kind = 0) {
  G.decals.push({ x, y, r, color, rot: Math.random() * 6, kind });
  if (G.decals.length > 300) G.decals.shift();
}
function vol(x, y) {
  const p = me();
  if (!p) return 1;
  return clamp(1 - Math.hypot(p.x - x, p.y - y) / 1000, 0.04, 1);
}

// хост: проиграть у себя и разослать гостям
function emit(ev) {
  playFx(ev, false);
  if (G.role === 'host') G.fxOut.push(ev.map((v) => (typeof v === 'number' ? r2(v) : v)));
}

function say(who, text, dur = 5) { emit(['say', who, text, dur]); }

const BUG_GOO = '#7dff5a', OIL = '#3a2a10';

function playFx(ev, remote) {
  const [k] = ev;
  switch (k) {
    case 'shot': {
      const [, x, y, a, o, w] = ev;     // o: idx героя, -1 враг, -2 союзник
      if (remote && o === G.myIdx) return;
      const c = o === -1 ? ENEMY_BOLT : o === -2 ? ALLY_BOLT : charColor(pById(o) ? pById(o).ch : 0);
      for (let i = 0; i < 4; i++) {
        const aa = a + rand(-0.5, 0.5), s = rand(80, 220);
        addPart(x, y, Math.cos(aa) * s, Math.sin(aa) * s, 0.15, c, 2);
      }
      const v = vol(x, y);
      if (o === -1) SFX.eshot(v);
      else if (o === -2) SFX.rifle(v * 0.8);
      else (SFX[w] || SFX.rifle)(v);
      if (o >= 0 && WEAPONS[CHARS[pById(o) ? pById(o).ch : 0].weapon]) addRing(x, y, WEAPONS[CHARS[pById(o).ch].weapon].noise, c);
      break;
    }
    case 'hit': {
      // попадание по врагу: осколки по типу врага, искры
      const [, x, y, t, dir, frac] = ev;
      const T = ETYPES[t] || ETYPES.D;
      if (T.kind === 'bug' || T.kind === 'worm') {
        chunks(x, y, T.color, 4, dir, 220, 4);
        burst(x, y, BUG_GOO, 8, 160, 0.35, 2);
        if (Math.random() < 0.5) addDecal(x + rand(-8, 8), y + rand(-8, 8), rand(5, 9), BUG_GOO, 1);
      } else {
        chunks(x, y, T.color, 3, dir, 260, 4);
        burst(x, y, '#ffd28a', 10, 260, 0.25);
        if (frac < 0.5) burst(x, y, '#ffffff', 4, 300, 0.15, 1.5);
      }
      SFX.hit(vol(x, y), T.kind);
      break;
    }
    case 'armor': {
      const [, x, y] = ev;    // рикошет от брони
      burst(x, y, '#ffffff', 8, 280, 0.18, 1.5);
      SFX.ricochet(vol(x, y));
      break;
    }
    case 'limb': {
      // отлетевшая деталь (рука дроида, лапа жука)
      const [, x, y, t, dir] = ev;
      const T = ETYPES[t] || ETYPES.D;
      addPart(x, y, Math.cos(dir) * 240, Math.sin(dir) * 240, 1.4, T.color, 9, 3, 2, rand(-10, 10));
      burst(x, y, T.kind === 'droid' || T.kind === 'boss' ? '#ffd28a' : BUG_GOO, 12, 200, 0.4);
      break;
    }
    case 'kill': {
      const [, x, y, t, dir] = ev;
      const T = ETYPES[t] || ETYPES.D;
      chunks(x, y, T.color, T.kind === 'boss' ? 30 : 9, dir, 300, T.kind === 'boss' ? 10 : 6);
      if (T.kind === 'droid' || T.kind === 'boss') {
        burst(x, y, '#ffb000', 16, 220, 0.5, 2.5);
        addDecal(x, y, rand(14, 20), OIL, 2);
      } else {
        burst(x, y, BUG_GOO, 22, 240, 0.6, 2.5);
        addDecal(x, y, rand(14, 20), BUG_GOO, 1);
      }
      G.shake = Math.max(G.shake, T.kind === 'boss' ? 18 : 4);
      SFX.kill(vol(x, y), T.kind);
      break;
    }
    case 'akill': {
      const [, x, y, c] = ev;
      burst(x, y, c, 26, 260, 0.6, 2.5);
      addDecal(x, y, 16, c);
      SFX.pdie(vol(x, y) * 0.7);
      break;
    }
    case 'hm': {
      // хитмаркер для стрелявшего: 0 попал, 1 убил, 2 броня
      const [, o, kind] = ev;
      if (o !== G.myIdx) return;
      G.hitmark = { k: kind, t: 0.25 };
      SFX.tick(kind);
      break;
    }
    case 'phit': {
      const [, x, y, idx] = ev;
      const p = pById(idx);
      burst(x, y, p ? charColor(p.ch) : '#fff', 12, 220, 0.3);
      if (idx === G.myIdx) { G.shake = Math.max(G.shake, 6); G.hurtFlash = 0.35; }
      SFX.phit(vol(x, y));
      break;
    }
    case 'pdown': {
      const [, x, y, idx] = ev;
      const p = pById(idx);
      const c = p ? charColor(p.ch) : '#fff';
      burst(x, y, c, 40, 300, 0.8, 3);
      addDecal(x, y, 20, c);
      G.shake = Math.max(G.shake, 9);
      SFX.pdie(vol(x, y));
      break;
    }
    case 'rev': {
      const [, x, y, idx] = ev;
      const p = pById(idx);
      const c = p ? charColor(p.ch) : '#fff';
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        addPart(x + Math.cos(a) * 30, y + Math.sin(a) * 30, -Math.cos(a) * 60, -Math.sin(a) * 60, 0.5, c, 2.5, 1);
      }
      SFX.rev(vol(x, y));
      break;
    }
    case 'spark': {
      const [, x, y, c] = ev;
      burst(x, y, c, 5, 140, 0.18, 1.5);
      break;
    }
    case 'boom': {
      const [, x, y] = ev;
      burst(x, y, '#ffb000', 60, 420, 0.7, 3);
      burst(x, y, '#ff3d00', 40, 260, 0.9, 3);
      burst(x, y, '#ffffff', 20, 500, 0.25, 2);
      addDecal(x, y, 46, '#ff6a00');
      addRing(x, y, NOISE.boom, '#ffb000');
      G.shake = Math.max(G.shake, 14);
      SFX.boom(vol(x, y));
      break;
    }
    case 'flashbang': {
      const [, x, y] = ev;
      burst(x, y, '#ffffff', 70, 500, 0.5, 3);
      addRing(x, y, 150, '#ffffff');
      const p = me();
      if (p && Math.hypot(p.x - x, p.y - y) < 260 && los(p.x, p.y, x, y)) G.whiteT = 0.5;
      G.shake = Math.max(G.shake, 8);
      SFX.flashbang(vol(x, y));
      break;
    }
    case 'throw': {
      const [, x, y, o] = ev;
      if (remote && o === G.myIdx) return;
      SFX.throw(vol(x, y));
      break;
    }
    case 'decoy': {
      const [, x, y] = ev;
      addRing(x, y, NOISE.decoy, '#c77dff');
      SFX.decoy(vol(x, y));
      break;
    }
    case 'mel': {
      const [, x, y, a, o] = ev;
      if (remote && o === G.myIdx) return;
      const p = pById(o);
      if (p) p.mel = 0.2;
      SFX.melee(vol(x, y));
      break;
    }
    case 'take': {
      const [, x, y, o] = ev;    // тихое устранение
      burst(x, y, '#ffffff', 6, 120, 0.2);
      if (o === G.myIdx) G.hitmark = { k: 1, t: 0.3 };
      SFX.takedown(vol(x, y));
      break;
    }
    case 'dbr': {
      // завал сдвинули
      const [, x, y, done] = ev;
      for (let i = 0; i < (done ? 60 : 22); i++) {
        const a = Math.random() * Math.PI * 2, s = rand(40, done ? 320 : 180);
        addPart(x + rand(-40, 40), y + rand(-40, 40), Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 1.2), i % 3 ? '#8a6a50' : '#c0a080', rand(2, 5), 3, 1, rand(-8, 8));
      }
      G.shake = Math.max(G.shake, done ? 10 : 4);
      SFX.rubble(vol(x, y), done);
      break;
    }
    case 'dhit': {
      const [, idx, ok] = ev;  // попадание/промах в мини-игре завала
      if (idx === G.myIdx) { G.dgFlash = { ok, t: 0.35 }; SFX.tick(ok ? 0 : 2); }
      break;
    }
    case 'gate': {
      const [, x, y] = ev;
      burst(x, y, '#3dff8a', 30, 200, 0.6);
      SFX.open();
      break;
    }
    case 'cam': {
      const [, x, y] = ev;    // камера засекла
      burst(x, y, '#ff3344', 20, 160, 0.5);
      SFX.siren();
      break;
    }
    case 'alarm': {
      const [, zone] = ev;
      G.alarmFlash = 2.5;
      G.alarmText = zone === 'cen' ? 'ТРЕВОГА В ЦЕНТРЕ' : 'ТРЕВОГА НА ОКРАИНАХ';
      SFX.siren();
      break;
    }
    case 'say': {
      const [, who, text, dur] = ev;
      G.subs.push({ who, text, t: dur, max: dur });
      if (G.subs.length > 4) G.subs.shift();
      SFX.radio(who);
      break;
    }
    case 'obj': {
      const [, text] = ev;
      G.toast = { text, t: 4 };
      SFX.objective();
      break;
    }
    case 'cp': G.toast = { text: 'КОНТРОЛЬНАЯ ТОЧКА', t: 2.5 }; SFX.objective(); break;
    case 'brief': G.brief = { lv: ev[1], t: 0 }; break;
    case 'pick': {
      const [, x, y] = ev;
      burst(x, y, '#c77dff', 24, 160, 0.6);
      SFX.pickup();
      break;
    }
    case 'arm': {
      // у босса взорвалась рука с оружием
      const [, x, y, dir] = ev;
      burst(x, y, '#ffb000', 80, 420, 0.8, 3);
      burst(x, y, '#ff3d00', 40, 300, 0.9, 3);
      chunks(x, y, '#ff5a5a', 18, dir, 420, 8);
      addPart(x, y, Math.cos(dir) * 300, Math.sin(dir) * 300, 2, '#ff5a5a', 16, 2.5, 2, rand(-8, 8));
      G.shake = Math.max(G.shake, 20);
      SFX.boom(vol(x, y));
      break;
    }
    case 'jam': {
      const [, x, y] = ev;
      burst(x, y, '#ff8800', 30, 220, 0.6);
      SFX.overheat(vol(x, y));
      break;
    }
    case 'punch': {
      const [, x, y] = ev;
      burst(x, y, '#ff5a5a', 18, 260, 0.3);
      G.shake = Math.max(G.shake, 7);
      SFX.punch(vol(x, y));
      break;
    }
    case 'ride': SFX.mount(); break;
    case 'bite': {
      const [, x, y] = ev;
      burst(x, y, '#d07dff', 10, 200, 0.25);
      SFX.bite(vol(x, y));
      break;
    }
  }
}

// ---------- Звук (синтез WebAudio) ----------
let AC = null, master = null, noiseBuf = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.4; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function tone(type, f0, f1, dur, v, delay = 0) {
  if (!AC || v < 0.002) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, v, ftype, freq, delay = 0) {
  if (!AC || v < 0.002) return;
  const t = AC.currentTime + delay, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = ftype; f.frequency.value = freq;
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.4); s.stop(t + dur + 0.02);
}
const SFX = {
  rifle:   (v) => { tone('sawtooth', 1400, 200, 0.14, 0.12 * v); tone('square', 700, 120, 0.09, 0.05 * v); },
  sniper:  (v) => { tone('sawtooth', 2200, 90, 0.35, 0.16 * v); noise(0.25, 0.12 * v, 'highpass', 1500); },
  scatter: (v) => { noise(0.18, 0.22 * v, 'bandpass', 1200); tone('square', 500, 80, 0.16, 0.08 * v); },
  smg:     (v) => { tone('triangle', 900, 300, 0.07, 0.07 * v); noise(0.05, 0.04 * v, 'highpass', 3000); },
  eshot:   (v) => { tone('square', 1100, 170, 0.17, 0.07 * v); },
  hit:     (v, kind) => { if (kind === 'droid' || kind === 'boss') tone('square', 600, 250, 0.07, 0.09 * v); else noise(0.08, 0.12 * v, 'bandpass', 600); },
  ricochet:(v) => { tone('sine', 3000, 1400, 0.12, 0.08 * v); tone('square', 1800, 900, 0.05, 0.04 * v); },
  kill:    (v, kind) => { if (kind === 'droid' || kind === 'boss') { noise(0.25, 0.25 * v, 'bandpass', 900); tone('sawtooth', 300, 60, 0.25, 0.07 * v); } else { noise(0.2, 0.2 * v, 'lowpass', 700); tone('square', 900, 200, 0.1, 0.05 * v); } },
  tick:    (k) => { tone('square', k === 1 ? 1800 : k === 2 ? 500 : 1300, k === 1 ? 1200 : 400, 0.05, 0.05); },
  phit:    (v) => { tone('sawtooth', 300, 90, 0.15, 0.12 * v); noise(0.1, 0.1 * v, 'lowpass', 900); },
  pdie:    (v) => { tone('sawtooth', 420, 30, 0.7, 0.16 * v); noise(0.5, 0.2 * v, 'lowpass', 800); },
  boom:    (v) => { noise(0.9, 0.55 * v, 'lowpass', 500); tone('sine', 140, 30, 0.6, 0.4 * v); },
  flashbang:(v) => { noise(0.5, 0.45 * v, 'highpass', 2000); tone('sine', 3500, 3400, 0.8, 0.06 * v); },
  dash:    () => { noise(0.12, 0.1, 'highpass', 2500); },
  step:    (k) => { noise(0.05, 0.05 * k, 'lowpass', 700); },
  throw:   (v) => { tone('triangle', 600, 300, 0.1, 0.1 * v); },
  decoy:   (v) => { tone('square', 880, 880, 0.08, 0.06 * v); tone('square', 660, 660, 0.08, 0.06 * v, 0.1); },
  melee:   (v) => { noise(0.1, 0.12 * v, 'bandpass', 2400); },
  takedown:(v) => { noise(0.12, 0.1 * v, 'lowpass', 500); tone('sine', 200, 60, 0.15, 0.08 * v); },
  rev:     (v) => { tone('sine', 440, 880, 0.35, 0.14 * v); tone('sine', 660, 1320, 0.35, 0.07 * v); },
  open:    () => { tone('sine', 330, 660, 0.5, 0.13); tone('sine', 495, 990, 0.5, 0.09); },
  overheat:(v = 1) => { tone('square', 300, 80, 0.5, 0.1 * v); noise(0.4, 0.1 * v, 'highpass', 4000); },
  siren:   () => { for (let i = 0; i < 3; i++) { tone('sawtooth', 600, 900, 0.25, 0.06, i * 0.5); tone('sawtooth', 900, 600, 0.25, 0.06, i * 0.5 + 0.25); } },
  radio:   (who) => { noise(0.08, 0.05, 'bandpass', 2500); tone('square', 1400, 1400, 0.04, 0.03); },
  objective:() => { tone('sine', 523, 523, 0.15, 0.08); tone('sine', 784, 784, 0.25, 0.08, 0.12); },
  pickup:  () => { tone('sine', 660, 1320, 0.3, 0.1); tone('triangle', 990, 1980, 0.3, 0.05, 0.05); },
  rubble:  (v, done) => { noise(done ? 1 : 0.4, (done ? 0.4 : 0.2) * v, 'lowpass', 300); tone('sine', 80, 40, done ? 0.8 : 0.3, 0.2 * v); },
  punch:   (v) => { noise(0.2, 0.35 * v, 'lowpass', 400); tone('sine', 120, 40, 0.25, 0.3 * v); },
  mount:   () => { tone('sawtooth', 120, 240, 0.3, 0.06); },
  bite:    (v) => { noise(0.1, 0.15 * v, 'bandpass', 1600); tone('square', 300, 150, 0.08, 0.05 * v); },
  click:   () => { tone('square', 1000, 1000, 0.03, 0.04); },
};

// Гул двигателей спидеров: по голосу на каждый, громкость от скорости и расстояния
const engines = new Map();
function makeEngine() {
  const o1 = AC.createOscillator(), o2 = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain();
  o1.type = 'sawtooth'; o2.type = 'square';
  f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 3;
  g.gain.value = 0;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
  o1.start(); o2.start();
  return { o1, o2, f, g };
}
function updateEngines() {
  if (!AC) return;
  const t = AC.currentTime;
  const active = new Set();
  if (G.state === 'play' && map) {
    for (const s of G.speeders) {
      const occupied = s.seats.some((q) => q >= 0);
      if (!occupied) continue;
      active.add(s.id);
      let h = engines.get(s.id);
      if (!h) { h = makeEngine(); engines.set(s.id, h); }
      const sp = Math.hypot(s.vx, s.vy) / RIDE_SPEED;
      const v = 0.035 * vol(s.x, s.y) * (0.4 + sp);
      const fr = 55 + sp * 70;
      h.g.gain.setTargetAtTime(v, t, 0.05);
      h.o1.frequency.setTargetAtTime(fr, t, 0.05);
      h.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
      h.f.frequency.setTargetAtTime(400 + sp * 900, t, 0.05);
    }
  }
  for (const [id, h] of engines) {
    if (active.has(id)) continue;
    h.g.gain.setTargetAtTime(0, t, 0.08);
    h.o1.stop(t + 0.5); h.o2.stop(t + 0.5);
    engines.delete(id);
  }
}
