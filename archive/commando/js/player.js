'use strict';
// ---------- Ввод и управление своим героем ----------

const keys = {};
const mouse = { x: 0, y: 0, l: false, r: false, rPressed: false };
const pressed = {};            // нажатия за кадр (сбрасываются в controlLocal)
const DG_ROUND = 1.6, DG_WIN = [0.58, 0.86], DG_NEED = 4;

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!e.repeat) pressed[e.code] = true;
  if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
  if (e.key === 'Alt') e.preventDefault();
  if (G.role === 'none' || G.state === 'lobby') return;
  if (e.repeat) return;
  if (e.code === 'Escape') { if (G.ui) closeUi(); else leaveToMenu(''); }
  if (e.code === 'KeyR' && G.state === 'over') restartFromCheckpoint();
  if (e.code === 'KeyH' && G.state === 'over') requestHub();
  if (e.code === 'KeyM') Voice.toggleMute();
  if ((e.code === 'Enter' || e.code === 'Space') && G.brief) G.brief.t = Math.max(G.brief.t, 99);
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.key === 'Alt') e.preventDefault(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', (e) => {
  initAudio();
  if (e.button === 0) mouse.l = true;
  if (e.button === 2) { mouse.r = true; mouse.rPressed = true; }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.l = false;
  if (e.button === 2) mouse.r = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const screenToWorld = (sx, sy) => ({ x: sx - VW / 2 + G.cam.x, y: sy - VH / 2 + G.cam.y });

function requestHub() {
  if (!isAuth()) { send({ t: 'hub' }); return; }
  returnToHub(false);
}

// Действие героя: у хоста выполняется сразу, гость отправляет хосту
function act(p, a) {
  if (isAuth()) handleAction(p, a);
  else send({ t: 'a', s: G.seq, ...a });
}

// ---------- Таймеры героя (у всех) ----------
function tickPlayerTimers(p, dt) {
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.spCd = Math.max(0, p.spCd - dt);
  p.melCd = Math.max(0, p.melCd - dt);
  p.mel = Math.max(0, p.mel - dt);
  p.flashT = Math.max(0, p.flashT - dt);
  if (!p.net) p.dash = Math.max(0, p.dash - dt);
}

function controlLocal(p, dt) {
  const pr = { ...pressed };
  for (const k in pressed) delete pressed[k];
  const rPressed = mouse.rPressed; mouse.rPressed = false;
  if (G.autopilot && isAuth()) { controlBot(p, dt); return; }
  p.useId = 0;
  if (p.down || G.state !== 'play' || G.brief) { p.mv = MV.IDLE; p.rad = false; return; }
  p.rad = !!keys.KeyB;

  if (G.ui) { updateUi(p, dt, pr); p.mv = MV.IDLE; return; }

  let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  const ml = Math.hypot(mx, my);
  if (ml) { mx /= ml; my /= ml; }
  const wm = screenToWorld(mouse.x, mouse.y);
  p.a = Math.atan2(wm.y - p.y, wm.x - p.x);

  if (pr.KeyF) { p.lamp = !p.lamp; SFX.click(); }

  // взаимодействие
  const near = findInteract(p);
  p.near = near;
  if (pr.KeyE && near) interactPress(p, near);
  if (keys.KeyE && near && near.info.mode === 'hold') p.useId = near.o.id;

  // приказ клонам по рации: удерживать C
  if (keys.KeyC && canOrderClones(p)) {
    p.cmdT = (p.cmdT || 0) + dt;
    if (p.cmdT >= 1) { p.cmdT = 0; act(p, { k: 'cmd' }); }
  } else p.cmdT = 0;

  if (p.ride >= 0) {
    const s = G.speeders.find((q) => q.id === p.ride);
    if (s && s.seats[0] === p.idx) driveSpeeder(s, mx, my, dt);
    p.mv = MV.IDLE;
  } else {
    // Alt/X — крадёмся (бесшумно), Shift — спринт (громко, тратит выносливость)
    const wantSlow = keys.AltLeft || keys.AltRight || keys.KeyX;
    const wantSprint = keys.ShiftLeft || keys.ShiftRight;
    let mode = MV.IDLE;
    if (ml) mode = wantSlow ? MV.SLOW : wantSprint && !p.exh && p.stam > 0 ? MV.SPRINT : MV.WALK;
    stamina(p, mode, dt);
    if (pr.Space && p.dashCd <= 0) {
      const da = ml ? Math.atan2(my, mx) : p.a;
      p.dvx = Math.cos(da) * 620; p.dvy = Math.sin(da) * 620;
      p.dash = 0.16; p.dashCd = 0.9;
      SFX.dash();
    }
    if (p.dash > 0) {
      moveCircle(p, p.dvx * dt, p.dvy * dt, PR);
      addPart(p.x + rand(-4, 4), p.y + rand(-4, 4), 0, 0, 0.25, charColor(p.ch), 3);
    } else {
      const mul = mode === MV.SPRINT ? SPRINT_MUL : mode === MV.SLOW ? SLOW_MUL : 1;
      moveCircle(p, mx * CHARS[p.ch].speed * mul * dt, my * CHARS[p.ch].speed * mul * dt, PR);
    }
    p.mv = p.dash > 0 ? MV.SPRINT : mode;
  }
  p.rx = p.x; p.ry = p.y;

  if (mouse.l) tryFire(p);
  if (rPressed) trySpecial(p, wm);
  if (pr.KeyQ) tryMelee(p);
}

function stamina(p, mode, dt) {
  if (mode === MV.SPRINT) {
    p.stam -= dt / STAMINA_DRAIN; p.stamDelay = 0.6;
    if (p.stam <= 0) { p.stam = 0; p.exh = true; }
  } else {
    p.stamDelay -= dt;
    if (p.stamDelay <= 0) p.stam = Math.min(1, p.stam + dt / STAMINA_REGEN);
    if (p.exh && p.stam >= 0.35) p.exh = false;
  }
}

function tryFire(p) {
  if (p.atkCd > 0) return;
  const W = weaponOf(p);
  p.atkCd = W.cd;
  if (!isAuth()) {
    playFx(['shot', p.x + Math.cos(p.a) * 18, p.y + Math.sin(p.a) * 18, p.a, p.idx, W.sfx]);
    addRing(p.x, p.y, W.noise, charColor(p.ch));
  }
  act(p, { k: 'fire', a: r2(p.a) });
}

function trySpecial(p, wm) {
  if (p.spCd > 0) return;
  p.spCd = SPECIALS[CHARS[p.ch].special].cd;
  if (!isAuth() && CHARS[p.ch].special !== 'mark') SFX.throw(1);
  act(p, { k: 'sp', a: r2(p.a), tx: r1(wm.x), ty: r1(wm.y) });
}

function tryMelee(p) {
  if (p.melCd > 0 || p.ride >= 0) return;
  p.melCd = 0.6; p.mel = 0.2;
  if (!isAuth()) SFX.melee(1);
  act(p, { k: 'mel', a: r2(p.a) });
}

// ---------- Спидер ----------
function seatPos(s, seat) {
  const off = seat === 0 ? 6 : -12;
  return { x: s.x + Math.cos(s.a) * off, y: s.y + Math.sin(s.a) * off };
}

function driveSpeeder(s, mx, my, dt, maxV = RIDE_SPEED) {
  const accel = 760;
  if (mx || my) { s.vx += mx * accel * dt; s.vy += my * accel * dt; }
  const drag = Math.exp(-(mx || my ? 0.9 : 2.2) * dt);
  s.vx *= drag; s.vy *= drag;
  const sp = Math.hypot(s.vx, s.vy);
  if (sp > maxV) { s.vx *= maxV / sp; s.vy *= maxV / sp; }
  if (moveCircle(s, s.vx * dt, s.vy * dt, 15)) { s.vx *= 0.4; s.vy *= 0.4; }
  if (sp > 30) s.a = turnTo(s.a, Math.atan2(s.vy, s.vx), 6 * dt);
  s.rx = s.x; s.ry = s.y;
  s.local = true;
}

// у всех: седоки едут вместе со спидером
function syncRiders() {
  for (const s of G.speeders) {
    for (let seat = 0; seat < 2; seat++) {
      const idx = s.seats[seat];
      if (idx < 0) continue;
      const p = pById(idx);
      if (!p || p.ride !== s.id) { if (isAuth()) s.seats[seat] = -1; continue; }
      const sp = seatPos(s, seat);
      p.x = sp.x; p.y = sp.y;
      if (p.idx === G.myIdx || isAuth()) { p.rx = (s.rx !== undefined ? s.rx : s.x) + (sp.x - s.x); p.ry = (s.ry !== undefined ? s.ry : s.y) + (sp.y - s.y); }
    }
  }
}

// хост: сесть на ближайший спидер или сойти
function toggleRide(p) {
  if (p.ride >= 0) { dismount(p); return; }
  let best = null, bd = 56;
  for (const s of G.speeders) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < bd && s.seats.includes(-1)) { bd = d; best = s; }
  }
  if (!best) return;
  seatPlayer(p, best, best.seats[0] === -1 ? 0 : 1);
  emit(['ride']);
}

function dismount(p) {
  const s = G.speeders.find((q) => q.id === p.ride);
  p.ride = -1;
  if (!s) return;
  const seat = s.seats.indexOf(p.idx);
  if (seat >= 0) s.seats[seat] = -1;
  // пассажир пересаживается за руль
  if (s.seats[0] === -1 && s.seats[1] >= 0) { s.seats[0] = s.seats[1]; s.seats[1] = -1; }
  const side = seat === 0 ? 1 : -1;
  const spot = freeSpotNear(s.x + Math.cos(s.a + Math.PI / 2 * side) * 26, s.y + Math.sin(s.a + Math.PI / 2 * side) * 26);
  p.x = p.rx = spot.x; p.y = p.ry = spot.y;
  p.tp = (p.tp | 0) + 1;     // гость примет позицию от хоста
}

// ---------- Взаимодействия ----------
// Что можно сделать с объектом: mode — hold (держать E), press (нажать E), debris (мини-игра завала)
function interactInfo(o, p) {
  const tech = p && isTech(p);
  const m = G.m || {};
  switch (o.k) {
    case 'debris': return o.done ? null : { mode: 'debris', r: 140, label: 'разбирать завал (нужны двое)' };
    case 'gate': return o.name === 'hatch' && !o.open ? { mode: 'hold', r: 80, dur: tech ? 0.8 : 1.6, label: 'открыть люк' } : null;
    case 'console': return o.done ? null : { mode: 'hold', r: 52, dur: tech ? 1.5 : 3, label: 'отключить станцию наблюдения' };
    case 'table': return o.done ? null : { mode: 'hold', r: 52, dur: tech ? 0.8 : 1.6, label: 'изучить карту патрулей' };
    case 'item': return o.done || m.art !== -1 ? null : { mode: 'hold', r: 46, dur: 1, label: 'подобрать артефакт' };
    case 'npc': return { mode: 'press', r: 58, label: 'поговорить' };
    case 'crate': return o.done ? null : { mode: 'press', r: 58, label: 'настроить сканер тоннелей' };
    default: return null;
  }
}

function findInteract(p) {
  if (p.down) return null;
  if (p.ride >= 0) return { o: null, info: { mode: 'ride', label: 'сойти со спидера' } };
  let best = null, bd = 1e9;
  for (const o of G.objs) {
    const info = interactInfo(o, p);
    if (!info) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d > info.r || d >= bd) continue;
    // видимость проверяем до точки чуть ближе к герою: центр люка/ворот лежит в непрозрачной клетке
    if (o.k !== 'debris' && d > 1) {
      const k = Math.min(1, 20 / d);
      if (!los(p.x, p.y, o.x + (p.x - o.x) * k, o.y + (p.y - o.y) * k)) continue;
    }
    bd = d; best = { o, info };
  }
  for (const s of G.speeders) {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d < 50 && d < bd && s.seats.includes(-1)) {
      bd = d; best = { o: s, info: { mode: 'ride', label: s.seats[0] === -1 ? 'сесть за руль спидера' : 'сесть пассажиром' } };
    }
  }
  const cap = G.allies.find((a) => a.captain && !a.dead);
  if (cap) {
    const d = Math.hypot(cap.x - p.x, cap.y - p.y);
    if (d < 60 && d < bd) best = { o: cap, info: { mode: 'talk', label: 'поговорить с капитаном' } };
  }
  return best;
}

function interactPress(p, near) {
  const { o, info } = near;
  if (info.mode === 'ride') { act(p, { k: 'ride' }); return; }
  if (info.mode === 'debris') { act(p, { k: 'dg', id: o.id, ph: r2(debrisPhase(o)) }); return; }
  if (info.mode === 'talk') { openDialog(p, 'captain', o); return; }
  if (o.k === 'npc') { openDialog(p, o.role, o); return; }
  if (o.k === 'crate') { openScanner(p, o); }
}

// Фаза маркера в мини-игре завала (0..1 за раунд). У гостя — с поправкой на время с последнего снимка.
function debrisPhase(o) {
  if (!o.eng || o.eng.length < 2) return 0;
  let rt = o.rt;
  if (!isAuth() && o.rtAt !== undefined) rt += G.time - o.rtAt;
  return (rt % DG_ROUND) / DG_ROUND;
}

const canOrderClones = (p) => G.m && G.stage === 2 && G.m.met && !G.m.ordered && radioAt(p.x, p.y);

// ---------- Локальный интерфейс: диалоги и сканер ----------
function closeUi() { G.ui = null; }

function openDialog(p, role, o) {
  const m = G.m;
  const mine = m.art === p.idx;
  const d = { kind: 'dialog', o, role, who: '', lines: [], opts: [] };
  if (role === 'captain') {
    d.who = 'КАПИТАН ТРАКС';
    if (m.ordered) d.lines = ['Мы уже в бою, коммандос! Прикройте нас и пробивайтесь к центру.'];
    else {
      d.lines = ['Поселение держат дроиды и жуки. Основные силы — у главных ворот.',
        'Можем ударить в лоб вместе. Или зайдите в тыл: под городом сеть тоннелей.',
        'Сканер для тоннелей — у наших техников в лагере на юго-востоке.'];
      d.opts = [{ text: 'Приказ: штурм окраин!', a: { k: 'talk', opt: 'order' } },
        { text: 'Мы пойдём в обход. Ждите команды по рации (C).', a: null }];
    }
  } else if (role === 'glasses') {
    d.who = 'МЕСТНЫЙ В ОЧКАХ';
    if (o.done) d.lines = ['Я своё слово держу. Станция наблюдения — на востоке окраин, у стены центра. Отключите её — и камеры ослепнут.'];
    else if (mine) {
      d.lines = ['О-о… Это то, о чём я думаю? За такую вещь я расскажу, где у дроидов глаза.'];
      d.opts = [{ text: 'Отдать артефакт: узнать, где станция наблюдения', a: { k: 'give', id: o.id } }, { text: 'Уйти', a: null }];
    } else {
      d.lines = ['Информация стоит дорого, коммандос. Не всем здесь нравится эта война, но и бесплатно я не работаю.'];
      if (m.art === -1) d.lines.push('Говорят, в доме справа от люка кто-то спрятал ценную вещицу…');
      else if (m.art === -2) d.lines.push('Ценную вещь вы уже отдали другому. Жаль.');
    }
  } else if (role === 'merc') {
    d.who = 'НАЁМНИК С БЛАСТЕРОМ';
    if (o.done) d.lines = ['Мои ребята уже шумят в центре. Половина дроидов с окраин побежала туда.'];
    else if (mine) {
      d.lines = ['Вот это плата. Мои ребята устроят в центре такую заварушку, что половина окраин побежит туда.'];
      d.opts = [{ text: 'Отдать артефакт: наёмники отвлекут врага', a: { k: 'give', id: o.id } }, { text: 'Уйти', a: null }];
    } else {
      d.lines = ['Мы стреляем быстро и метко. Но за плату.'];
      if (m.art === -2) d.lines.push('Плату вы уже отдали кому-то другому.');
    }
  }
  if (!d.opts.length) d.opts = [{ text: 'Уйти', a: null }];
  G.ui = d;
}

function openScanner(p, o) {
  G.ui = { kind: 'scan', o, stage: 0, target: rand(0.2, 0.8), cur: 0.5, lock: 0, t: 0 };
}

function updateUi(p, dt, pr) {
  const u = G.ui;
  if (u.kind === 'dialog') {
    for (let i = 0; i < u.opts.length; i++) {
      if (pr['Digit' + (i + 1)] || pr['Numpad' + (i + 1)]) {
        const o = u.opts[i];
        if (o.a) act(p, o.a);
        closeUi();
        return;
      }
    }
    if (pr.KeyE) closeUi();
    return;
  }
  if (u.kind === 'scan') {
    // мини-игра: совместить свою волну с отражённым сигналом тоннеля (мышь по горизонтали)
    const tech = isTech(p);
    u.t += dt;
    u.cur = clamp(mouse.x / VW, 0, 1);
    const target = clamp(u.target + Math.sin(u.t * 0.9 + u.stage) * 0.05, 0.05, 0.95);
    u.tgt = target;
    const tol = tech ? 0.065 : 0.04;
    if (Math.abs(u.cur - target) < tol) u.lock += dt * (tech ? 0.9 : 0.6);
    else u.lock = Math.max(0, u.lock - dt * 0.5);
    if (u.lock >= 1) {
      u.stage++; u.lock = 0; u.target = rand(0.15, 0.85);
      SFX.objective();
      if (u.stage >= 3) { act(p, { k: 'scan', id: u.o.id }); closeUi(); }
    }
  }
}

// ---------- Хост: обработка действий героя ----------
function handleAction(p, a) {
  if (G.state !== 'play') return;
  if (p.down && a.k !== 'lamp') return;
  switch (a.k) {
    case 'fire': p.a = a.a; playerFire(p); break;
    case 'sp': p.a = a.a; playerSpecial(p, a.tx, a.ty); break;
    case 'mel': p.a = a.a; if (p.ride < 0) playerMelee(p); break;
    case 'ride': toggleRide(p); break;
    case 'dg': { const o = objById(a.id); if (o && o.k === 'debris') debrisPress(o, p, a.ph); break; }
    case 'scan': { const o = objById(a.id); if (o && o.k === 'crate' && !o.done) completeScan(o, p); break; }
    case 'give': { const o = objById(a.id); if (o && o.k === 'npc') giveArtifact(o, p); break; }
    case 'talk': if (a.opt === 'order') orderClones(p, true); break;
    case 'cmd': if (canOrderClones(p)) orderClones(p, false); break;
  }
}

// Мини-игра завала: первое нажатие — взяться, дальше жать E вместе с напарником, когда маркер в зелёной зоне
function debrisPress(o, p, ph) {
  if (o.done || p.ride >= 0) return;
  if (Math.hypot(o.x - p.x, o.y - p.y) > 150) return;
  if (!o.eng.includes(p.idx)) { o.eng.push(p.idx); return; }
  if (o.eng.length < 2 || o.hits.includes(p.idx)) return;
  const ok = ph >= DG_WIN[0] && ph <= DG_WIN[1];
  emit(['dhit', p.idx, ok ? 1 : 0]);
  if (!ok) return;
  o.hits.push(p.idx);
  if (o.hits.length >= 2) {
    o.prog++; o.hits = []; o.rt = 0;
    makeNoise(o.x, o.y, NOISE.debris, false);
    if (o.prog >= DG_NEED) {
      o.done = true; o.eng = [];
      setTiles(o.tiles, T.FLOOR);
      emit(['dbr', o.x, o.y, 1]);
    } else emit(['dbr', o.x, o.y, 0]);
  }
}

function updateDebris(o, dt) {
  if (o.done) return;
  o.eng = o.eng.filter((idx) => {
    const q = pById(idx);
    return q && !q.down && q.ride < 0 && Math.hypot(q.x - o.x, q.y - o.y) < 150;
  });
  if (o.eng.length >= 2) {
    o.rt += dt;
    if (o.rt >= DG_ROUND) { o.rt -= DG_ROUND; o.hits = []; }
  } else { o.rt = 0; o.hits = []; }
}

// Удержание E: прогресс у хоста
function updateHolds(dt) {
  for (const p of G.players) {
    const o = p.useId ? objById(p.useId) : null;
    const info = o && interactInfo(o, p);
    if (!o || !info || info.mode !== 'hold' || p.down || p.ride >= 0 || Math.hypot(o.x - p.x, o.y - p.y) > info.r + 12) { p.useP = 0; continue; }
    p.useP += dt;
    if (p.useP >= info.dur) { p.useP = 0; completeHold(o, p); }
  }
}
