'use strict';
// ---------- Голосовой чат: ближний голос + рация ----------
// Перенесено из прототипа Commando (archive/commando/js/voice.js) с другим транспортом: там голос шёл звонками WebRTC,
// здесь — кусочками звука через тот же канал, что и игра (PeerJS или server.py), хост раздаёт их остальным.
// Ближний голос: слышно рядом, громкость падает с расстоянием, за стеной — глуше, стерео-панорама.
// Рация (держать B): слышат все свои с любого расстояния — если связь есть и у говорящего, и у слушающего.
// В помещениях (пол здания) связи нет. Мёртвые не говорят. M — микрофон вкл/выкл.

// Сжатие: Opus (WebCodecs, ~24 Кбит/с — в 7 раз меньше μ-law с base64), если его умеют все в комнате (хост проверяет
// при входе: hello.op → lobby.vop), иначе μ-law (16 кГц, 8 бит). Захват — AudioWorklet кусками по 20 мс
// (нет — ScriptProcessor). В сообщении — 100 мс голоса: сообщений столько же, сколько раньше, а данных меньше.
const VOICE = {
  rate: 16000,                 // Гц: частота передачи (речь)
  block: 0.02,                 // с: кусок захвата и кадр Opus
  batch: 0.1,                  // с: голоса в одном сообщении
  bitrate: 24000,              // бит/с: Opus
  range: M(25),                // ближний голос слышно до 25 м
  wallK: 0.5, wallCut: 700,    // за стеной: тише и глуше
  vad: 0.012,                  // порог голоса (RMS): тишину не отправляем
  hang: 0.35,                  // с: продолжать передачу после конца фразы
  jitter: 0.12,                // с: буфер на неровную доставку
  maxLag: 0.6,                 // с: копится больше — сбросить отставание
};

// Связь по рации: в зданиях (пол помещения) сигнала нет
const radioOk = (o) => !!o && !o.dead && !!map && map.fl[tileIndex(o.x, o.y)] !== FM.INDOOR;

const OPUS_CFG = { codec: 'opus', sampleRate: VOICE.rate, numberOfChannels: 1, bitrate: VOICE.bitrate };
const OPUS_DEC = { codec: 'opus', sampleRate: VOICE.rate, numberOfChannels: 1 };

const Voice = {
  wanted: false, stream: null, muted: false, error: '',
  src: null, proc: null, sink: null, seq: 0, vadUntil: 0, level: 0, sending: false, onAir: false,
  opusOk: false,               // этот браузер умеет Opus (кодировать и раскодировать)
  useOpus: false,              // договорились в комнате: все умеют — шлём Opus
  enc: null, encTs: 0, out: [], outMu: [], outN: 0,     // кодер и накопленное до отправки (кадры Opus / отсчёты μ-law)
  remotes: new Map(),          // slot → цепочка воспроизведения и состояние говорящего
  stats: { tx: 0, txOpus: 0, txBytes: 0, rx: {}, rxRadio: {}, rxFrames: {} },

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
    this.sink = AC.createGain(); this.sink.gain.value = 0;      // чтобы узел захвата работал, он должен быть подключён к выходу
    this.sink.connect(AC.destination);
    try {
      // AudioWorklet: отдельный звуковой поток, куски по 20 мс — без щелчков и задержки ScriptProcessor
      const n = Math.round(AC.sampleRate * VOICE.block);
      const code = `registerProcessor('vcap', class extends AudioWorkletProcessor {
        constructor() { super(); this.b = new Float32Array(${n}); this.n = 0; }
        process(inp) {
          const x = inp[0] && inp[0][0];
          if (x) for (let i = 0; i < x.length; i++) { this.b[this.n++] = x[i]; if (this.n === this.b.length) { this.port.postMessage(this.b.slice(0)); this.n = 0; } }
          return true;
        }
      });`;
      if (!AC.__vcap) AC.__vcap = AC.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      // модуль не загрузился за 3 с — не ждать вечно, а взять ScriptProcessor
      await Promise.race([AC.__vcap, new Promise((_, no) => setTimeout(() => no(new Error('worklet timeout')), 3000))]);
      if (!this.stream) return false;         // выключили, пока загружался модуль
      this.proc = new AudioWorkletNode(AC, 'vcap');
      this.proc.port.onmessage = (ev) => this.capture(ev.data, AC.sampleRate);
    } catch (e) {
      // нет AudioWorklet — ScriptProcessor (устаревший, но есть везде)
      this.proc = AC.createScriptProcessor(4096, 1, 1);
      this.proc.onaudioprocess = (ev) => this.capture(ev.inputBuffer.getChannelData(0), ev.inputBuffer.sampleRate);
    }
    this.src.connect(this.proc); this.proc.connect(this.sink);
    return true;
  },

  disable() {
    this.wanted = false;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    try { if (this.proc) this.proc.disconnect(); if (this.src) this.src.disconnect(); } catch (e) { /* ignore */ }
    try { if (this.enc && this.enc.state !== 'closed') this.enc.close(); } catch (e) { /* ignore */ }
    this.stream = null; this.proc = null; this.src = null; this.enc = null;
    this.out = []; this.outMu = []; this.outN = 0;
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

  // Кусок с микрофона (x — отсчёты с частотой rate): порог голоса, перевод в 16 кГц, сжатие, отправка пачками по 100 мс
  capture(x, rate) {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    this.level = Math.sqrt(s / x.length);
    const now = AC.currentTime;
    if (this.level > VOICE.vad) this.vadUntil = now + VOICE.hang;
    this.onAir = this.radioWanted();
    const was = this.sending;
    this.sending = this.canTalk() && now < this.vadUntil;
    if (!this.sending) { if (was) this.flush(); return; }
    const ratio = rate / VOICE.rate, n = Math.floor(x.length / ratio);
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * ratio, k = Math.floor(p), f = p - k;
      pcm[i] = x[k] + ((x[k + 1] ?? x[k]) - x[k]) * f;
    }
    if (this.useOpus && this.encoder()) {
      // кодер отдаёт кадры асинхронно — в Voice.out (onOpus)
      this.enc.encode(new AudioData({ format: 'f32', sampleRate: VOICE.rate, numberOfFrames: n, numberOfChannels: 1, timestamp: this.encTs, data: pcm }));
      this.encTs += Math.round((n / VOICE.rate) * 1e6);
      return;
    }
    const mu = new Uint8Array(n);
    for (let i = 0; i < n; i++) mu[i] = muEncode(pcm[i]);
    this.outMu.push(mu); this.outN += n;
    if (this.outN >= VOICE.rate * VOICE.batch) this.flush();
  },

  // Кодер Opus (создаётся при первой нужде; ошибка — дальше μ-law)
  encoder() {
    if (this.enc && this.enc.state === 'configured') return this.enc;
    if (!this.opusOk) return null;
    try {
      this.enc = new AudioEncoder({ output: (c) => this.onOpus(c), error: () => { this.enc = null; this.opusOk = false; } });
      this.enc.configure(OPUS_CFG);
      return this.enc;
    } catch (e) { this.enc = null; this.opusOk = false; return null; }
  },
  onOpus(chunk) {
    const b = new Uint8Array(chunk.byteLength);
    chunk.copyTo(b);
    this.out.push(b);
    if (this.out.length * VOICE.block >= VOICE.batch - 1e-6 || !this.sending) this.flush();
  },

  // Отправить накопленное: Opus — массив кадров, μ-law — один кусок
  flush() {
    let d, f;
    if (this.out.length) { d = this.out.map(b64); f = 'o'; this.stats.txOpus++; this.stats.txBytes += this.out.reduce((s, b) => s + b.length, 0); this.out = []; }
    else if (this.outN) {
      const all = new Uint8Array(this.outN);
      let o = 0;
      for (const m of this.outMu) { all.set(m, o); o += m.length; }
      d = b64(all); this.stats.txBytes += all.length;
      this.outMu = []; this.outN = 0;
    } else return;
    this.stats.tx++;
    const pkt = { t: 'vo', s: G.mySlot, r: this.onAir ? 1 : 0, q: this.seq++, d };
    if (f) pkt.f = f;
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
    r = { lp, gain, pan, bp, rgain, next: 0, talkUntil: 0, radioUntil: 0, radioOn: false, dec: null, decTs: 0, radioQ: [] };
    this.remotes.set(slot, r);
    return r;
  },

  // Кусок голоса от другого игрока: μ-law (d — строка) или Opus (f: 'o', d — кадры)
  receive(pkt) {
    if (!pkt || pkt.s === G.mySlot) return;
    initAudio();
    if (!AC) return;
    const radio = !!pkt.r && radioOk(me());
    if (pkt.f === 'o') {
      if (!Array.isArray(pkt.d) || !pkt.d.length) return;
      const r = this.remote(pkt.s), dec = this.decoder(r, pkt.s);
      if (!dec) return;
      for (const s of pkt.d) {
        const data = unb64(s);
        if (!data.length) continue;
        r.radioQ.push(radio);
        dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: r.decTs, data }));
        r.decTs += VOICE.block * 1e6;
      }
    } else {
      if (typeof pkt.d !== 'string') return;
      const bytes = unb64(pkt.d);
      if (!bytes.length) return;
      const pcm = new Float32Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) pcm[i] = muDecode(bytes[i]);
      this.play(pkt.s, pcm, radio);
    }
    if (radio) this.stats.rxRadio[pkt.s] = (this.stats.rxRadio[pkt.s] || 0) + 1;
    this.stats.rx[pkt.s] = (this.stats.rx[pkt.s] || 0) + 1;
    // значок «говорит» — сразу, не дожидаясь раскодирования
    const r = this.remote(pkt.s), t = AC.currentTime;
    r.talkUntil = Math.max(r.talkUntil, t + VOICE.jitter + VOICE.batch);
    if (radio) r.radioUntil = Math.max(r.radioUntil, t + VOICE.jitter + VOICE.batch + 0.15);
  },

  // Раскодировщик Opus говорящего (свой у каждого; сломался — заново)
  decoder(r, slot) {
    if (r.dec && r.dec.state === 'configured') return r.dec;
    if (!this.opusOk) return null;
    try {
      r.radioQ = []; r.decTs = 0;
      r.dec = new AudioDecoder({
        output: (a) => {
          const pcm = new Float32Array(a.numberOfFrames);
          a.copyTo(pcm, { planeIndex: 0, format: 'f32-planar' });
          a.close();
          this.play(slot, pcm, r.radioQ.shift());
        },
        error: () => { r.dec = null; },
      });
      r.dec.configure(OPUS_DEC);
      return r.dec;
    } catch (e) { r.dec = null; return null; }
  },

  // В очередь воспроизведения говорящего (буфер на неровную доставку; рация — через свою цепочку со щелчком)
  play(slot, pcm, radio) {
    if (!pcm.length) return;
    const ab = AC.createBuffer(1, pcm.length, VOICE.rate);
    ab.copyToChannel(pcm, 0);
    const r = this.remote(slot), now = AC.currentTime;
    if (r.next < now + 0.02 || r.next > now + VOICE.maxLag) r.next = now + VOICE.jitter;
    const src = AC.createBufferSource();
    src.buffer = ab;
    src.connect(r.lp);
    if (radio) {
      if (r.radioUntil < now || !r.radioOn) squelch(r.rgain);        // щелчок в начале передачи
      src.connect(r.bp);
      r.radioUntil = Math.max(r.radioUntil, r.next + ab.duration + 0.15);
    }
    r.radioOn = radio;
    src.start(r.next);
    r.next += ab.duration;
    r.talkUntil = Math.max(r.talkUntil, r.next + 0.1);
    this.stats.rxFrames[slot] = (this.stats.rxFrames[slot] || 0) + 1;
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
    for (const r of this.remotes.values()) {
      try { r.pan.disconnect(); r.rgain.disconnect(); } catch (e) { /* ignore */ }
      try { if (r.dec && r.dec.state !== 'closed') r.dec.close(); } catch (e) { /* ignore */ }
    }
    this.remotes.clear();
    this.useOpus = false;
  },
};

// Умеет ли браузер Opus (кодировать и раскодировать): проверка асинхронная, при загрузке
(async () => {
  try {
    Voice.opusOk = typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined' &&
      !!(await AudioEncoder.isConfigSupported(OPUS_CFG)).supported && !!(await AudioDecoder.isConfigSupported(OPUS_DEC)).supported;
  } catch (e) { Voice.opusOk = false; }
})();

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
