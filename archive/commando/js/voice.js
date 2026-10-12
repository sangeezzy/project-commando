'use strict';
// ---------- Голосовой чат: пространственный голос + рация ----------
// Каждый игрок-человек звонит каждому через PeerJS (медиа-звонки, сетка «все со всеми»).
// Обычный голос слышно рядом: громкость падает с расстоянием, за стенами — глуше, есть стерео-панорама.
// Рация (держать B): голос слышат все, у кого есть связь. В пещерах и тоннелях рация не работает.

const Voice = {
  stream: null,        // свой микрофон (null — микрофон не включён, отправляем тишину)
  silent: null,
  muted: false,
  wanted: false,       // игрок включил голосовой чат в лобби
  calls: new Map(),    // peerId -> call
  remotes: new Map(),  // idx -> { stream, el, src, an, lp, gain, pan, rgain, level }
  localAn: null, localLevel: 0,
  peerOf: new Map(),   // idx -> peerId (из ростера)
  error: '',

  async enable() {
    this.wanted = true;
    initAudio();
    if (this.stream) return true;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.error = '';
      if (AC) {
        const src = AC.createMediaStreamSource(this.stream);
        this.localAn = AC.createAnalyser(); this.localAn.fftSize = 256;
        src.connect(this.localAn);
      }
      // уже идущие звонки получают настоящий микрофон вместо тишины
      const track = this.stream.getAudioTracks()[0];
      for (const call of this.calls.values()) {
        const pc = call.peerConnection;
        if (!pc) continue;
        for (const s of pc.getSenders()) if (s.track && s.track.kind === 'audio') s.replaceTrack(track);
      }
      this.applyMute();
      return true;
    } catch (e) {
      this.error = 'Микрофон недоступен: ' + (e.name || e);
      return false;
    }
  },

  disable() {
    this.wanted = false;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.localAn = null;
    const silent = this.silentStream();
    const track = silent && silent.getAudioTracks()[0];
    for (const call of this.calls.values()) {
      const pc = call.peerConnection;
      if (!pc || !track) continue;
      for (const s of pc.getSenders()) if (s.track && s.track.kind === 'audio') s.replaceTrack(track);
    }
  },

  toggleMute() {
    if (!this.stream) return;
    this.muted = !this.muted;
    this.applyMute();
    G.toast = { text: this.muted ? 'МИКРОФОН ВЫКЛЮЧЕН (M)' : 'МИКРОФОН ВКЛЮЧЁН (M)', t: 2 };
  },
  applyMute() { if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = !this.muted; },

  silentStream() {
    if (this.silent) return this.silent;
    initAudio();
    if (!AC) return null;
    const dst = AC.createMediaStreamDestination();
    const o = AC.createOscillator(), g = AC.createGain();
    g.gain.value = 0; o.connect(g).connect(dst); o.start();
    this.silent = dst.stream;
    return this.silent;
  },
  outStream() { return this.stream || this.silentStream(); },

  // Ростер от хоста: [{idx, peer}] — звоним тем, у кого idx больше нашего
  setRoster(list) {
    this.peerOf.clear();
    for (const r of list) this.peerOf.set(r.idx, r.peer);
    if (!Net.peer || G.role === 'solo') return;
    for (const r of list) {
      if (r.idx === G.myIdx || r.idx < G.myIdx || this.calls.has(r.peer)) continue;
      const out = this.outStream();
      if (!out) continue;
      try {
        const call = Net.peer.call(r.peer, out, { metadata: { idx: G.myIdx } });
        if (call) this.handleCall(call, r.idx);
      } catch (e) { /* ignore */ }
    }
    // звонки тем, кого больше нет в ростере, закрываем
    const alive = new Set(list.map((r) => r.peer));
    for (const [pid, call] of this.calls) if (!alive.has(pid)) { try { call.close(); } catch (e) { /* ignore */ } this.calls.delete(pid); }
  },

  onIncoming(call) {
    const out = this.outStream();
    try { call.answer(out || undefined); } catch (e) { return; }
    const idx = call.metadata && typeof call.metadata.idx === 'number' ? call.metadata.idx : -1;
    this.handleCall(call, idx);
  },

  handleCall(call, idx) {
    this.calls.set(call.peer, call);
    call.on('stream', (st) => this.attach(idx, st));
    call.on('close', () => { this.calls.delete(call.peer); this.detach(idx); });
    call.on('error', () => { this.calls.delete(call.peer); this.detach(idx); });
  },

  attach(idx, stream) {
    initAudio();
    if (!AC) return;
    this.detach(idx);
    // Chrome не отдаёт звук удалённого потока в WebAudio, пока поток не привязан к <audio>
    const el = new Audio();
    el.muted = true; el.srcObject = stream;
    el.play().catch(() => {});
    const src = AC.createMediaStreamSource(stream);
    const an = AC.createAnalyser(); an.fftSize = 256;
    const lp = AC.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8000;
    const gain = AC.createGain(); gain.gain.value = 0;
    const pan = AC.createStereoPanner();
    // рация: узкая полоса + лёгкий перегруз
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.9;
    const ws = AC.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.5); }
    ws.curve = curve;
    const rgain = AC.createGain(); rgain.gain.value = 0;
    src.connect(an);
    src.connect(lp).connect(gain).connect(pan).connect(AC.destination);
    src.connect(bp).connect(ws).connect(rgain).connect(AC.destination);
    this.remotes.set(idx, { stream, el, src, an, lp, gain, pan, rgain, level: 0, buf: new Uint8Array(an.fftSize) });
  },

  detach(idx) {
    const r = this.remotes.get(idx);
    if (!r) return;
    try { r.src.disconnect(); r.el.srcObject = null; } catch (e) { /* ignore */ }
    this.remotes.delete(idx);
  },

  // Каждый кадр: громкость и фильтры по положению говорящего относительно слушателя
  update() {
    if (!AC) return;
    const t = AC.currentTime;
    const L = me();
    for (const [idx, r] of this.remotes) {
      r.level = level(r.an, r.buf);
      const S = pById(idx);
      let g = 0, rg = 0, cut = 8000, pan = 0;
      if (L && S && G.state === 'play' && map) {
        const d = Math.hypot(S.x - L.x, S.y - L.y);
        g = Math.pow(clamp(1 - d / 750, 0, 1), 1.5);
        if (!los(L.x, L.y, S.x, S.y)) { g *= 0.5; cut = 700; }
        pan = clamp((S.x - L.x) / 500, -1, 1);
        if (S.rad && radioAt(S.x, S.y) && radioAt(L.x, L.y)) rg = 0.9;
      } else if (G.state === 'lobby' || G.state === 'menu') g = 1;     // в лобби слышно всех
      r.gain.gain.setTargetAtTime(g, t, 0.05);
      r.rgain.gain.setTargetAtTime(rg, t, 0.05);
      r.lp.frequency.setTargetAtTime(cut, t, 0.05);
      r.pan.pan.setTargetAtTime(pan, t, 0.05);
      if (S) S.talk = r.level > 0.03 ? 0.3 : Math.max(0, (S.talk || 0) - 0.016);
    }
    if (this.localAn) {
      this.localLevel = this.muted ? 0 : level(this.localAn, this.localBuf || (this.localBuf = new Uint8Array(this.localAn.fftSize)));
      const p = me();
      if (p) p.talk = this.localLevel > 0.03 ? 0.3 : Math.max(0, (p.talk || 0) - 0.016);
    }
  },

  cleanup() {
    for (const call of this.calls.values()) { try { call.close(); } catch (e) { /* ignore */ } }
    this.calls.clear();
    for (const idx of [...this.remotes.keys()]) this.detach(idx);
    this.peerOf.clear();
  },
};

function level(an, buf) {
  an.getByteTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}
