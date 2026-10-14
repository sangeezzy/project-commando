'use strict';
// ---------- Эффекты и звук ----------
// emit — единая точка событий для эффектов (позже по ней же пойдёт сеть, как в прототипе Commando).

function addPart(x, y, vx, vy, life, color, size, drag = 3, shape = 0, spin = 0) {
  G.parts.push({ x, y, vx, vy, life, max: life, color, size, drag, shape, rot: Math.random() * 6.28, spin });
  if (G.parts.length > 1500) G.parts.splice(0, G.parts.length - 1500);
}
function addDecal(d) {
  G.decals.push(d);
  if (G.decals.length > 600) G.decals.shift();
}

const IMPACT = {
  dust:  { c: ['#b8b6ae', '#8d8b84'], n: 7, chip: '#77756f' },
  brick: { c: ['#a8705a', '#8a5a48'], n: 7, chip: '#6f3f30' },
  metal: { c: ['#ffd27a', '#fff0c0'], n: 6, spark: true, chip: '#555' },
  wood:  { c: ['#c8a46a', '#a5834d'], n: 7, chip: '#8a6a3c' },
  sand:  { c: ['#c8b384', '#b09a6a'], n: 9, chip: '#9a8558' },
};

// Хост копит события для гостей (уходят со снимком мира)
function emit(ev) {
  playFx(ev);
  if (G.role === 'host') G.fxOut.push(ev);
}

function playFx(ev) {
  const [k] = ev;
  const p = me();
  if (k === 'shot') {
    const [, x, y, a, side, id, wt = 'm4a1'] = ev;
    const cls = WEAPONS[wt].cls;
    // вспышка, дымок, гильза вылетает вправо-назад (у ружья — пластиковая гильза, у пистолета — маленькая)
    for (let i = 0; i < 5; i++) {
      const s = rand(0.3, 1);
      addPart(x, y, Math.cos(a + rand(-0.35, 0.35)) * 260 * s, Math.sin(a + rand(-0.35, 0.35)) * 260 * s, 0.05, '#fff2b0', 3, 10);
    }
    addPart(x, y, Math.cos(a) * 40, Math.sin(a) * 40, 0.5, 'rgba(200,200,200,0.25)', 6, 3, 3);
    const ca = a + Math.PI / 2 + rand(-0.3, 0.3);
    const cx = x - Math.cos(a) * 18, cy = y - Math.sin(a) * 18;
    G.parts.push({ x: cx, y: cy, vx: Math.cos(ca) * rand(90, 140), vy: Math.sin(ca) * rand(90, 140), life: 0.45, max: 0.45,
      color: cls === 'shotgun' ? '#a8322a' : '#c9a646', size: cls === 'shotgun' ? 3 : cls === 'pistol' ? 1.5 : 2, drag: 5, shape: 2, rot: a, spin: rand(-30, 30), casing: true });
    G.muzzle = G.muzzle || [];
    G.muzzle.push({ x, y, a, t: 0.05 });
    if (p && id === p.id) { G.shake = Math.max(G.shake, cls === 'shotgun' ? 4 : cls === 'pistol' ? 1.4 : 2.2); SFX.shot(1, 0, 0, false, wt); }
    else if (p) {
      const d = Math.hypot(x - p.x, y - p.y);
      SFX.shot(vol(d), pan(x), d / PX_M / SOUND_SPEED, !los(p.x, p.y, x, y), wt);
    }
  } else if (k === 'trail') {
    const [, x0, y0, x1, y1] = ev;
    G.parts.push({ x: x0, y: y0, x1, y1, vx: 0, vy: 0, life: 0.09, max: 0.09, color: '#fff3c4', size: 1, drag: 0, shape: 4, rot: 0, spin: 0 });
  } else if (k === 'imp') {
    const [, x, y, a, fx] = ev;
    const s = IMPACT[fx] || IMPACT.dust;
    for (let i = 0; i < s.n; i++) {
      const aa = a + rand(-0.9, 0.9), sp = rand(40, 200);
      addPart(x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.2, 0.5), pickRandom(s.c), s.spark ? 1.5 : rand(1.5, 3), s.spark ? 4 : 6, s.spark ? 1 : 0);
    }
    addPart(x, y, Math.cos(a) * 25, Math.sin(a) * 25, 0.6, s.spark ? 'rgba(90,90,90,0.25)' : 'rgba(180,170,150,0.3)', 5, 2, 3);
    addDecal({ x, y, r: 1.6, c: 'rgba(20,18,15,0.7)' });
    if (p && Math.hypot(x - p.x, y - p.y) < M(25)) SFX.impact(vol(Math.hypot(x - p.x, y - p.y)) * 0.6, fx);
  } else if (k === 'blood') {
    const [, x, y, a, big] = ev;
    for (let i = 0; i < (big ? 12 : 7); i++) {
      const aa = a + rand(-0.5, 0.5), sp = rand(60, 220);
      addPart(x, y, Math.cos(aa) * sp, Math.sin(aa) * sp, rand(0.2, 0.4), i % 3 ? '#7a0d0d' : '#a51b1b', rand(1.5, 2.5), 6);
    }
    addDecal({ x: x + Math.cos(a) * rand(6, 18), y: y + Math.sin(a) * rand(6, 18), r: rand(3, 6), c: 'rgba(110,10,10,0.6)' });
    if (p) SFX.flesh(vol(Math.hypot(x - p.x, y - p.y)));
  } else if (k === 'die') {
    const [, x, y, a] = ev;
    addDecal({ x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8, r: 14, c: 'rgba(90,8,8,0.55)', grow: 1 });
  } else if (k === 'reload') {
    const [, x, y, side, empty, id] = ev;
    const who = allPeople().find((q) => q.id === id), wt = who && who.gun ? who.gun.t : 'm4a1';
    if (p) SFX.reload(id === p.id ? 1 : vol(Math.hypot(x - p.x, y - p.y)) * 0.5, empty, wt);
    if (empty === 2) return;                       // ружьё: патрон в магазин, магазин не выпадает
    // выпавший магазин
    G.parts.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: 0, vy: 0, life: 20, max: 20, color: '#2b2b2b', size: 3, drag: 0, shape: 5, rot: rand(0, 6.28), spin: 0 });
  } else if (k === 'wsw') {
    const [, x, y, side, id] = ev;
    if (p) SFX.wsw(id === p.id ? 1 : vol(Math.hypot(x - p.x, y - p.y)) * 0.4);
  } else if (k === 'knife') {
    const [, x, y, a, hit] = ev;
    if (!p) return;
    const v = vol(Math.hypot(x - p.x, y - p.y));
    if (hit) SFX.flesh(v * 1.2); else SFX.swish(v);
  } else if (k === 'dry') {
    const [, x, y, side, id] = ev;
    if (p && id === p.id) SFX.click();
  } else if (k === 'nomag') {
    if (p && ev[1] === p.id) toast('НЕТ МАГАЗИНОВ');
  } else if (k === 'crack') {
    if (p && ev[3] === p.id) SFX.crack();
  } else if (k === 'hm') {
    if (p && ev[1] === p.id) G.hitmark = { t: 0.25, kill: !!ev[2], armor: !!ev[3] };
  } else if (k === 'radio') {
    // сообщение по рации (видно и слышно всем своим): щелчок рации и текст
    G.radioMsg = { text: ev[1], t: 6 };
    if (AC) SFX.click(0.6);
  } else if (k === 'result') {
    // итоги забега (в хабе): победа/поражение, «Штурм»?, зачищено/отбито, убито, потерь
    G.runResult = { win: !!ev[1], assault: !!ev[2], cleared: ev[3], kills: ev[4], losses: ev[5], t: RUN_RESULT_T };
  } else if (k === 'banner') {
    G.banner = { text: ev[1], sub: ev[2], t: 4 };
  } else if (k === 'arm') {
    // попадание в плиту: искры, звон (удержала — звонче)
    const [, x, y, , stop] = ev;
    for (let i = 0; i < 5; i++) addPart(x, y, rand(-90, 90), rand(-90, 90), rand(0.1, 0.25), stop ? '#e8e0b0' : '#c0b8a0', 1.5, 4, 1);
    if (p) SFX.impact(vol(Math.hypot(x - p.x, y - p.y)) * (stop ? 0.8 : 0.5), 'metal');
  } else if (k === 'hurt') {
    if (p && ev[1] === p.id) { G.hurt.push({ a: ev[2], t: 1.2 }); G.shake = Math.max(G.shake, 6); p.hurtT = 0; }
  } else if (k === 'toast') {
    if (p && ev[1] === p.id) toast(ev[2]);
  } else if (k === 'door') {
    const [, x, y, what, type] = ev;
    const v = p ? vol(Math.hypot(x - p.x, y - p.y)) : 0;
    if (what === 'break' || what === 'slam') {
      const s = type === 'wood' ? IMPACT.wood : IMPACT.metal;
      for (let i = 0; i < 16; i++) { const a = rand(0, 6.28), sp = rand(40, 220); addPart(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.7), pickRandom(s.c), rand(1.5, 3), 5); }
      addPart(x, y, 0, 0, 0.8, 'rgba(180,170,150,0.35)', 10, 1, 3);
      G.shake = Math.max(G.shake, 4 * v);
    }
    SFX.door(v, what, type);
  } else if (k === 'bark') {
    const [, x, y, text, side, id] = ev;
    if (p && Math.hypot(x - p.x, y - p.y) < M(35)) {
      // id — кто сказал: видимого противника реплика висит над ним (drawBarksOver), иначе — внизу экрана
      G.barks = (G.barks || []).filter((b) => b.t > 0).slice(-5);
      G.barks.push({ text, t: 2.5, foe: side !== p.side, id, over: false });
    }
  } else if (k === 'down') {
    const [, x, y, id] = ev;
    addDecal({ x, y, r: 9, c: 'rgba(100,8,8,0.5)', grow: 1 });
    if (p && id === p.id) { G.shake = Math.max(G.shake, 8); SFX.flesh(1); }
  } else if (k === 'up') {
    const [, x, y, id] = ev;
    if (p && id === p.id) toast('ВАС ПОДНЯЛИ', 2);
    else if (p && Math.hypot(x - p.x, y - p.y) < M(20)) SFX.click(0.4);
  } else if (k === 'key') {
    SFX.click(0.5); SFX.casing(0.6);
  } else if (k === 'lamp') {
    const [, x, y] = ev;
    if (p && Math.hypot(x - p.x, y - p.y) < M(8)) SFX.click(0.4 * vol(Math.hypot(x - p.x, y - p.y)));
  } else if (k === 'mode') {
    if (p && ev[1] === p.id) SFX.click(0.6);
  }
}

function toast(text, t = 1.6) { G.toast = { text, t }; }

// ---------- Звук (WebAudio, синтез) ----------
let AC = null, master = null, noiseBuf = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.55; master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 1.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
// громкость по расстоянию: выстрел громкий везде, но заметно тише вдали
// громкость по расстоянию; в дождь и грозу далёкое слышно хуже (hearK — погода)
const vol = (d) => clamp(1 / (1 + d / (M(12) * (typeof hearK === 'function' ? hearK() : 1))), 0.04, 1);
const pan = (x) => clamp((x - G.cam.x) / 700, -1, 1);

function out(panV) {
  if (!AC.createStereoPanner) return master;
  const p = AC.createStereoPanner(); p.pan.value = panV || 0; p.connect(master); return p;
}
function noise(dest, dur, v, ftype, freq, delay = 0, q = 0.8, attack = 0.002) {
  const t0 = AC.currentTime + delay;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; f.Q.value = q;
  const g = AC.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(v, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.05);
}
function tone(dest, type, f0, f1, dur, v, delay = 0) {
  const t0 = AC.currentTime + delay;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.02);
}

const SFX = {
  // выстрел: резкий хлопок + низкий удар + хвост эха. delay — задержка звука (с), muffled — за стеной.
  // 5,56 — резкий; 7,62×39 — ниже и тяжелее; .45 — тише и суше; 12 калибр — глухой мощный удар
  shot(v = 1, p = 0, delay = 0, muffled = false, wt = 'm4a1') {
    if (!AC) return;
    const o = out(p);
    const S = { m4a1: [4500, 160, 1, 1], akm: [3600, 120, 1.1, 1.1], m1911: [3000, 140, 0.7, 0.6], w1300: [2600, 90, 1.3, 1.5] }[wt] || [4500, 160, 1, 1];
    const hi = muffled ? 1200 : S[0];
    noise(o, 0.09 * S[3], 0.9 * v * S[2], 'lowpass', hi, delay, 0.7, 0.001);
    noise(o, 0.05, 0.5 * v * S[2], 'highpass', 2500, delay, 0.5, 0.001);
    tone(o, 'sine', S[1], 45, 0.12 * S[3], 0.8 * v * S[2], delay);
    noise(o, 0.6 * S[3], 0.12 * v * S[2], 'lowpass', 900, delay + 0.03, 0.5, 0.02);
  },
  wsw(v = 1) { if (!AC) return; const o = out(0); noise(o, 0.12, 0.25 * v, 'bandpass', 900, 0, 1.5); noise(o, 0.03, 0.3 * v, 'highpass', 3000, 0.12); },
  swish(v = 1) { if (!AC) return; noise(out(0), 0.12, 0.3 * v, 'bandpass', 2400, 0, 3, 0.04); },
  crack() { if (!AC) return; const o = out(0); noise(o, 0.025, 0.55, 'highpass', 3000, 0, 0.6, 0.001); tone(o, 'sawtooth', 2400, 900, 0.03, 0.08); },
  impact(v, fx) {
    if (!AC) return;
    const o = out(0);
    if (fx === 'metal') { tone(o, 'triangle', 2200, 1400, 0.12, 0.12 * v); noise(o, 0.05, 0.3 * v, 'bandpass', 3000); }
    else if (fx === 'wood') noise(o, 0.07, 0.4 * v, 'bandpass', 900, 0, 1.5);
    else noise(o, 0.06, 0.35 * v, 'bandpass', 1600, 0, 1.2);
  },
  flesh(v) { if (!AC) return; const o = out(0); noise(o, 0.08, 0.4 * v, 'lowpass', 500, 0, 1); },
  click(v = 1) { if (!AC) return; const o = out(0); noise(o, 0.02, 0.35 * v, 'highpass', 4000); tone(o, 'square', 1800, 1500, 0.015, 0.05 * v); },
  // магазин отстегнуть, вставить, (пустой) задержка затвора
  reload(v = 1, empty = 0, wt = 'm4a1') {
    if (!AC) return;
    const o = out(0), W = WEAPONS[wt];
    if (empty === 2) { noise(o, 0.04, 0.35 * v, 'bandpass', 1500, 0.25, 2); tone(o, 'square', 500, 350, 0.02, 0.05 * v, 0.25); return; }   // патрон в ружьё
    noise(o, 0.04, 0.4 * v, 'bandpass', 2500, 0.15, 2);
    noise(o, 0.06, 0.3 * v, 'bandpass', 1200, 0.35, 2);
    const tin = empty ? W.reloadEmpty - 0.6 : W.reloadTac - 0.35;
    noise(o, 0.05, 0.6 * v, 'bandpass', 1800, tin, 2.5);
    tone(o, 'square', 300, 200, 0.03, 0.06 * v, tin);
    if (empty) { noise(o, 0.07, 0.7 * v, 'bandpass', 2200, tin + 0.4, 2); tone(o, 'triangle', 900, 500, 0.06, 0.12 * v, tin + 0.4); }
  },
  casing(v = 0.3) { if (!AC) return; const o = out(0); tone(o, 'sine', rand(3800, 5200), 3000, 0.08, 0.05 * v); },
  // двери: скрип открытия, хлопок, лязг замка, удар, треск
  door(v, what, type) {
    if (!AC || v <= 0.01) return;
    const o = out(0), metal = type !== 'wood';
    if (what === 'open') { noise(o, 0.35, 0.12 * v, 'bandpass', metal ? 900 : 500, 0, 6, 0.05); tone(o, 'sawtooth', metal ? 320 : 180, metal ? 260 : 140, 0.3, 0.02 * v); }
    else if (what === 'close') { noise(o, 0.12, 0.5 * v, 'lowpass', metal ? 1400 : 600); tone(o, 'sine', metal ? 140 : 90, 60, 0.15, 0.4 * v); }
    else if (what === 'unlock' || what === 'key') { noise(o, 0.03, 0.3 * v, 'highpass', 3000, 0); noise(o, 0.03, 0.35 * v, 'highpass', 2500, what === 'key' ? 0.25 : 0.1); }
    else if (what === 'rattle') { for (let i = 0; i < 3; i++) noise(o, 0.04, 0.3 * v, 'bandpass', metal ? 2200 : 1200, i * 0.07, 3); }
    else if (what === 'thud') { noise(o, 0.15, 0.8 * v, 'lowpass', metal ? 700 : 400); tone(o, 'sine', metal ? 110 : 80, 40, 0.2, 0.7 * v); }
    else { noise(o, 0.35, 0.9 * v, 'lowpass', metal ? 2500 : 1500); tone(o, 'sine', 90, 35, 0.3, 0.8 * v); noise(o, 0.5, 0.25 * v, 'bandpass', metal ? 1800 : 700, 0.08, 1.5); }
  },
  step(v = 0.15) { if (!AC) return; noise(out(0), 0.05, v, 'lowpass', 600); },
  // гром: треск и долгий низкий раскат
  thunder(v = 1) {
    if (!AC) return;
    const o = out(0);
    noise(o, 0.4, 0.5 * v, 'bandpass', 900, 0, 1, 0.01);
    noise(o, 3.2, 0.9 * v, 'lowpass', 180, 0.05, 0.7, 0.15);
    noise(o, 2.2, 0.5 * v, 'lowpass', 90, 0.4, 0.7, 0.3);
  },
  // шум дождя — постоянный, громкость по силе (set 0..1): k^0,6 × 0,05 — слабый (0,35) почти как раньше (0,027),
  // сильный (1) вдвое тише прежнего (0,05 вместо 0,09): шум ливня не глушит шаги и выстрелы
  rainLoop() {
    const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = AC.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.4;
    const g = AC.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(master); s.start();
    return { set(k) { g.gain.setTargetAtTime(0.05 * Math.pow(Math.max(0, k), 0.6), AC.currentTime, 0.5); }, stop() { try { s.stop(); } catch (e) { /* ignore */ } } };
  },
};
