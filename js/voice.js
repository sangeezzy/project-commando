'use strict';
// ---------- Голосовой чат: ближний голос + рация ----------
// Перенесено из прототипа Commando (archive/commando/js/voice.js) с другим транспортом: там голос шёл звонками WebRTC,
// здесь — кусочками звука через тот же канал, что и игра (PeerJS или server.py), хост раздаёт их остальным.
// Ближний голос: слышно рядом, громкость падает с расстоянием, за стеной — глуше, стерео-панорама.
// Рация (держать B): слышат все свои с любого расстояния — если связь есть и у говорящего, и у слушающего.
// В помещениях (пол здания) связи нет. Мёртвые не говорят. M — микрофон вкл/выкл.

const VOICE = {
  rate: 16000,                 // Гц: частота передачи (речь)
  range: M(25),                // ближний голос слышно до 25 м
  wallK: 0.5, wallCut: 700,    // за стеной: тише и глуше
  vad: 0.012,                  // порог голоса (RMS): тишину не отправляем
  hang: 0.35,                  // с: продолжать передачу после конца фразы
  jitter: 0.12,                // с: буфер на неровную доставку
  maxLag: 0.6,                 // с: копится больше — сбросить отставание
};

// Связь по рации: в зданиях (пол помещения) сигнала нет
const radioOk = (o) => !!o && !o.dead && !!map && map.fl[tileIndex(o.x, o.y)] !== FM.INDOOR;

const Voice = {
  wanted: false, stream: null, muted: false, error: '',
  src: null, proc: null, sink: null, seq: 0, vadUntil: 0, level: 0, sending: false, onAir: false,
  remotes: new Map(),          // slot → цепочка воспроизведения и состояние говорящего
  stats: { tx: 0, rx: {}, rxRadio: {} },

  supported: () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext,

  async enable() {
    this.wanted = true;
    initAudio();
    if (this.stream) return true;
    if (!this.supported()) {
      this.error = 'Микрофон доступен только на странице, открытой через localhost (start.bat) или https. ' +
        'Для голоса запустите игру у себя через start.bat и войдите по адресу хоста.';
      this.wanted = false;
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      this.error = 'Микрофон недоступен: ' + (e.name || e);
      this.wanted = false;
      return false;
    }
    if (!AC) { this.error = 'Звук браузера недоступен'; return false; }
    this.error = '';
    this.src = AC.createMediaStreamSource(this.stream);
    // ScriptProcessor — проще AudioWorklet и работает с file:// и http
    this.proc = AC.createScriptProcessor(4096, 1, 1);
    this.sink = AC.createGain(); this.sink.gain.value = 0;      // чтобы обработчик вызывался, узел должен быть подключён к выходу
    this.src.connect(this.proc); this.proc.connect(this.sink); this.sink.connect(AC.destination);
    this.proc.onaudioprocess = (ev) => this.capture(ev.inputBuffer);
    return true;
  },

  disable() {
    this.wanted = false;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    try { if (this.proc) this.proc.disconnect(); if (this.src) this.src.disconnect(); } catch (e) { /* ignore */ }
    this.stream = null; this.proc = null; this.src = null;
    this.sending = false; this.onAir = false;
  },

  toggleMute() {
    if (!this.stream) return;
    this.muted = !this.muted;
    toast(this.muted ? 'МИКРОФОН ВЫКЛЮЧЕН (M)' : 'МИКРОФОН ВКЛЮЧЁН (M)', 2);
  },

  // Можно ли сейчас говорить (в сетевой игре, микрофон включён, жив)
  canTalk() {
    if (!this.stream || this.muted || (G.role !== 'host' && G.role !== 'guest')) return false;
    if (G.state === 'lobby') return true;
    const p = me();
    return !!p && !p.dead && (G.state === 'play' || G.state === 'dead' || G.state === 'win');
  },
  // В эфире по рации: держит B и есть связь
  radioWanted() { const p = me(); return !!keys.KeyB && G.state !== 'lobby' && radioOk(p); },

  // Кусок с микрофона: порог голоса, перевод в 16 кГц, сжатие μ-law, отправка
  capture(buf) {
    const x = buf.getChannelData(0);
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    this.level = Math.sqrt(s / x.length);
    const now = AC.currentTime;
    if (this.level > VOICE.vad) this.vadUntil = now + VOICE.hang;
    this.onAir = this.radioWanted();
    this.sending = this.canTalk() && now < this.vadUntil;
    if (!this.sending) return;
    const ratio = buf.sampleRate / VOICE.rate, n = Math.floor(x.length / ratio);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * ratio, k = Math.floor(p), f = p - k;
      out[i] = muEncode(x[k] + ((x[k + 1] ?? x[k]) - x[k]) * f);
    }
    this.stats.tx++;
    const pkt = { t: 'vo', s: G.mySlot, r: this.onAir ? 1 : 0, q: this.seq++, d: b64(out) };
    if (G.role === 'host') broadcast(pkt);
    else if (G.role === 'guest') send(pkt);
  },

  // Цепочка воспроизведения говорящего: ближний голос (фильтр стены, громкость, панорама) и рация (полоса, перегруз)
  remote(slot) {
    let r = this.remotes.get(slot);
    if (r) return r;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8000;
    const gain = AC.createGain(); gain.gain.value = 0;
    const pan = AC.createStereoPanner ? AC.createStereoPanner() : AC.createGain();
    lp.connect(gain); gain.connect(pan); pan.connect(AC.destination);
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.9;
    const ws = AC.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const v = i / 128 - 1; curve[i] = Math.tanh(v * 2.5); }
    ws.curve = curve;
    const rgain = AC.createGain(); rgain.gain.value = 0;
    bp.connect(ws); ws.connect(rgain); rgain.connect(AC.destination);
    r = { lp, gain, pan, bp, rgain, next: 0, talkUntil: 0, radioUntil: 0 };
    this.remotes.set(slot, r);
    return r;
  },

  // Кусок голоса от другого игрока
  receive(pkt) {
    if (!pkt || pkt.s === G.mySlot || typeof pkt.d !== 'string') return;
    initAudio();
    if (!AC) return;
    const bytes = unb64(pkt.d);
    if (!bytes.length) return;
    const pcm = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) pcm[i] = muDecode(bytes[i]);
    const ab = AC.createBuffer(1, pcm.length, VOICE.rate);
    ab.copyToChannel(pcm, 0);
    const r = this.remote(pkt.s), now = AC.currentTime;
    if (r.next < now + 0.02 || r.next > now + VOICE.maxLag) r.next = now + VOICE.jitter;
    const src = AC.createBufferSource();
    src.buffer = ab;
    src.connect(r.lp);
    const L = me(), radio = !!pkt.r && radioOk(L);
    if (radio) {
      if (r.radioUntil < now) squelch(r.rgain);        // щелчок в начале передачи
      src.connect(r.bp);
      r.radioUntil = r.next + ab.duration + 0.15;
      this.stats.rxRadio[pkt.s] = (this.stats.rxRadio[pkt.s] || 0) + 1;
    }
    src.start(r.next);
    r.next += ab.duration;
    r.talkUntil = r.next + 0.1;
    this.stats.rx[pkt.s] = (this.stats.rx[pkt.s] || 0) + 1;
  },

  // Громкость ближнего голоса говорящего S для слушателя L (0..1) и срез фильтра
  proximity(L, S) {
    if (!L || !S || S.dead) return { g: 0, cut: 8000, pan: 0 };
    const d = Math.hypot(S.x - L.x, S.y - L.y);
    let g = Math.pow(clamp(1 - d / VOICE.range, 0, 1), 1.5), cut = 8000;
    if (!los(L.x, L.y, S.x, S.y)) { g *= VOICE.wallK; cut = VOICE.wallCut; }
    return { g, cut, pan: clamp((S.x - L.x) / M(15), -1, 1) };
  },

  // Каждый кадр: громкость и фильтры по положению говорящего относительно слушателя
  update() {
    if (!AC) return;
    const t = AC.currentTime, L = viewer ? viewer() : me();
    for (const [slot, r] of this.remotes) {
      const S = G.players.find((q) => q.slot === slot && !q.ai);
      let pr = { g: 0, cut: 8000, pan: 0 };
      if (G.state === 'lobby') pr = { g: 1, cut: 8000, pan: 0 };          // в лобби слышно всех
      else if (map && L && S) pr = this.proximity(L, S);
      r.gain.gain.setTargetAtTime(pr.g, t, 0.05);
      r.lp.frequency.setTargetAtTime(pr.cut, t, 0.05);
      if (r.pan.pan) r.pan.pan.setTargetAtTime(pr.pan, t, 0.05);
      r.rgain.gain.setTargetAtTime(r.radioUntil > t && radioOk(me()) ? 0.9 : 0, t, 0.03);
    }
  },

  // Кто говорит: { talk, radio } — для значков над бойцами и в составе отряда
  talking(slot) {
    if (!AC) return { talk: false, radio: false };
    const t = AC.currentTime;
    if (slot === G.mySlot) return { talk: this.sending, radio: this.sending && this.onAir };
    const r = this.remotes.get(slot);
    return r ? { talk: r.talkUntil > t, radio: r.radioUntil > t } : { talk: false, radio: false };
  },

  reset() {
    for (const r of this.remotes.values()) { try { r.pan.disconnect(); r.rgain.disconnect(); } catch (e) { /* ignore */ } }
    this.remotes.clear();
  },
};

// Щелчок рации: короткий шум через радийную цепочку
function squelch(dest) {
  if (!AC || !noiseBuf) return;
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const g = AC.createGain(); g.gain.value = 0.25;
  s.connect(g); g.connect(dest);
  s.start(AC.currentTime, Math.random() * 0.5, 0.06);
}

// G.711 μ-law: 8 бит на отсчёт, речь звучит прилично
function muEncode(v) {
  let x = Math.max(-1, Math.min(1, v)) * 32635;
  const sign = x < 0 ? 0x80 : 0;
  if (sign) x = -x;
  x += 0x84;
  let exp = 7;
  for (let m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--;
  const mant = (x >> (exp + 3)) & 0x0F;
  return ~(sign | (exp << 4) | mant) & 0xFF;
}
function muDecode(u) {
  u = ~u & 0xFF;
  const sign = u & 0x80, exp = (u >> 4) & 7, mant = u & 0x0F;
  let x = ((mant << 3) + 0x84) << exp;
  x -= 0x84;
  return (sign ? -x : x) / 32768;
}
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  try {
    const s = atob(str), out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch (e) { return new Uint8Array(0); }
}

// M — микрофон вкл/выкл (в игре и лобби)
addEventListener('keydown', (e) => { if (e.code === 'KeyM' && G.state !== 'menu') Voice.toggleMute(); });
