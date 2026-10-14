'use strict';
// ---------- Стационарные пулемёты (M2 Browning, ПКМ, ДШК) ----------
// map.mgs: { id, t — тип (WEAPONS, MG_IDS), x, y — станок, a — направление установки, arc — сектор (± рад), gun — лента и короба
// (как у оружия: mag, chamber, pouch), user — id бойца за пулемётом (0 — свободен), claim — id ИИ, который идёт его занять, yaw — куда смотрит ствол }.
// Боец за пулемётом: o.mg — пулемёт, o.gun — его «ствол» (свои стволы ждут в kit), стоит на месте стрелка (mgSeat), смотрит и стреляет
// только в секторе станка, не ходит, не приседает, не выглядывает, не меняет оружие. F — занять / оставить (люди), ИИ — mgSeek / mgStep.
// Мир ведёт хост; гостю — снимком (mgState / applyMgState: пулемёты и кто за ними).

const mgSeat = (m) => ({ x: m.x - Math.cos(m.a) * MG.behind, y: m.y - Math.sin(m.a) * MG.behind });
const mgClamp = (m, a) => m.a + clamp(angDiff(a, m.a), -m.arc, m.arc);
const mgInArc = (m, x, y) => Math.abs(angDiff(Math.atan2(y - m.y, x - m.x), m.a)) <= m.arc;
const mgHasAmmo = (m) => !!(m.gun.chamber || m.gun.mag || m.gun.pouch.some((n) => n > 0));

function addMG(t, x, y, a) {
  map.mgs = map.mgs || [];
  const m = { id: map.mgs.length + 1, t, x, y, a, arc: WEAPONS[t].arc, gun: makeGun(t), user: 0, claim: 0, yaw: a };
  map.mgs.push(m);
  return m;
}

// Свободный пулемёт, до места стрелка которого можно дотянуться (без стены между); за пулемётом — свой
function mgNear(o) {
  if (!map || !map.mgs || !o) return null;
  if (o.mg) return o.mg;
  let best = null, bd = MG.use;
  for (const m of map.mgs) {
    if (m.user) continue;
    const s = mgSeat(m), d = Math.hypot(s.x - o.x, s.y - o.y);
    if (d < bd && los(o.x, o.y, s.x, s.y)) { bd = d; best = m; }
  }
  return best;
}

function mgMount(o, m) {
  if (!m || m.user || o.dead || o.down || o.mg) return false;
  m.user = o.id; m.claim = 0;
  o.mg = m; o.gun = m.gun;
  Object.assign(o, { sw: null, melee: null, act: null, crouch: false, crouchToggle: false, sprint: false, leanWant: 0, kneel: false,
    peek: null, flank: null, fm: null, doorFire: null, burst: 0, mgOut: 0 });
  const s = mgSeat(m);
  o.x = o.px = s.x; o.y = o.py = s.y;
  o.a = mgClamp(m, o.a);
  emit(['mg', m.x, m.y, 1]);
  return true;
}

function mgLeave(o) {
  const m = o.mg;
  if (!m) return;
  if (m.user === o.id) m.user = 0;
  m.gun.reloadT = 0;                     // бросил перезарядку ленты — заново
  o.mg = null; o.burst = 0;
  o.gun = o.kit[o.cur] || o.kit[2];
  emit(['mg', m.x, m.y, 0]);
}

// F: за пулемётом — оставить, рядом свободный — занять
function mgToggle(o) {
  if (o.mg) mgLeave(o);
  else { const m = mgNear(o); if (m) mgMount(o, m); }
}

// Каждый кадр (хост): стрелок погиб / ранен / ушёл — пулемёт свободен; стрелок — на месте, ствол — в секторе
function updateMGs() {
  if (!map || !map.mgs) return;
  for (const m of map.mgs) {
    if (m.user) {
      const u = allPeople().find((q) => q.id === m.user);
      if (!u || u.dead || u.down || u.evac || u.mg !== m) { if (u && u.mg === m) mgLeave(u); else m.user = 0; continue; }
      const s = mgSeat(m);
      u.x = s.x; u.y = s.y;
      u.a = mgClamp(m, u.a);
      u.gun = m.gun;
      m.yaw = u.a;
    }
    if (m.claim) {
      const c = aiList().find((q) => q.id === m.claim);
      if (!c || c.dead || c.down || c.mg || c.mgClaim !== m.id) m.claim = 0;
    }
  }
}

// ---------- ИИ ----------
// За пулемётом: цель в секторе — очереди (прицел со станка точнее: MG.aimK); нет цели — ведёт ствол туда, где её видели (или по сектору).
// Оставляет: патронов нет совсем, цель вплотную (MG.close), цель вне сектора дольше MG.outArcT, союзный бот — ведущий ушёл далеко.
function mgStep(e, dt, seen) {
  const m = e.mg, g = m.gun;
  Object.assign(e, { sprint: false, crouch: false, kneel: false, leanWant: 0, peek: null, flank: null, fm: null, doorFire: null });
  const t = seen && seen.t;
  if (!mgHasAmmo(m) || (t && seen.d < MG.close) || (e.side === 'p' && !nearLeader(e, e.x, e.y, ENEMY.guard.tether * 1.5))) { mgLeave(e); return false; }
  const inArc = t ? mgInArc(m, seen.px, seen.py) : e.st < 2 || mgInArc(m, e.lastX, e.lastY);
  e.mgOut = inArc ? 0 : (e.mgOut || 0) + dt;
  if (e.mgOut > MG.outArcT || (e.st === 2 && !t && G.time - e.lastSeen > MG.lostT && e.side === 'e' && !inArc)) { mgLeave(e); return false; }
  if (!g.chamber && !g.reloadT && canReload(g)) { startReload(e); return true; }
  if (t && inArc) {
    e.want = mgClamp(m, Math.atan2(seen.py - e.y, seen.px - e.x));
    e.react -= dt;
    if (!(g.reloadT > 0)) shootAt(e, seen.partial ? { x: seen.px, y: seen.py, speed: t.speed, crouch: t.crouch } : t, seen.d, dt, false);
  } else {
    const look = e.st >= 1 && mgInArc(m, e.lastX, e.lastY) ? Math.atan2(e.lastY - e.y, e.lastX - e.x)
      : m.a + Math.sin(G.time * 0.35 + m.id * 1.7) * m.arc * 0.7;      // спокоен — медленно водит стволом по сектору
    e.want = mgClamp(m, look);
  }
  return true;
}

// Не за пулемётом: в бою свободный пулемёт рядом (≤ MG.ai), цель (или место, где её видели) — в его секторе и не у самого станка → идти и занять
function mgSeek(e, dt) {
  if (!map.mgs || !map.mgs.length || e.down || e.mg) return false;
  let m = e.mgClaim ? map.mgs.find((q) => q.id === e.mgClaim) : null;
  if (m && (m.user || !mgHasAmmo(m) || (m.claim && m.claim !== e.id))) { if (m.claim === e.id) m.claim = 0; e.mgClaim = 0; m = null; }
  if (!m) {
    if (e.st < 2 || (e.mgSeekT || 0) > G.time) return false;
    e.mgSeekT = G.time + 1;
    const tx = e.seeing && e.target ? e.target.x : e.lastX, ty = e.seeing && e.target ? e.target.y : e.lastY;
    for (const q of map.mgs) {
      if (q.user || q.claim || !mgHasAmmo(q)) continue;
      const s = mgSeat(q);
      if (Math.hypot(s.x - e.x, s.y - e.y) > MG.ai || !mgInArc(q, tx, ty) || Math.hypot(tx - q.x, ty - q.y) < MG.close * 2) continue;
      if (e.side === 'p' && !nearLeader(e, s.x, s.y, ENEMY.guard.tether)) continue;
      m = q; break;
    }
    if (!m) return false;
    m.claim = e.id; e.mgClaim = m.id;
    if (e.ai) bark(e, 'Беру пулемёт!');
  }
  const s = mgSeat(m), d = Math.hypot(s.x - e.x, s.y - e.y);
  if (d < M(0.45)) { e.mgClaim = 0; mgMount(e, m); return true; }
  const step = fieldStep(e, fieldTo(s.x, s.y));
  if (step === null && d > TILE) { m.claim = 0; e.mgClaim = 0; e.mgSeekT = G.time + 5; return false; }
  e.sprint = d > M(4); e.crouch = false; e.peek = null; e.leanWant = 0;
  moveDir(e, step ?? Math.atan2(s.y - e.y, s.x - e.x), e.sprint ? ENEMY.speed.run : ENEMY.speed.walk, dt);
  e.want = e.seeing && e.target ? Math.atan2(e.target.y - e.y, e.target.x - e.x) : step ?? e.want;
  return true;
}

// ---------- Расстановка ----------
// «Штурм» с локации MG.fromStage — с шансом MG.chance: пулемёт (случайный тип) и стрелок за ним. Место — логичное: обзор вперёд
// (луч по направлению установки, чем длиннее — тем лучше), перед станком — низкое укрытие (мешки, бетонный блок) — плюс,
// смотрит в сторону подхода отряда; не ближе MG.minStart к старту, его не видно со старта, и никого из отряда нет в его секторе с прямой видимостью.
function placeAssaultMG(rnd, cand, team) {
  let best = null, bs = -1;
  for (let i = 0; i < 260 && cand.length; i++) {
    const [tx, ty] = cand[Math.floor(rnd() * cand.length)];
    const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
    if (team.some((q) => Math.hypot(q.x - x, q.y - y) < MG.minStart)) continue;
    const cx = team.reduce((s, q) => s + q.x, 0) / team.length, cy = team.reduce((s, q) => s + q.y, 0) / team.length;
    const a = Math.atan2(cy - y, cx - x) + (rnd() - 0.5) * 0.8;
    const m = { x, y, a, arc: 1 };
    const s = mgSeat(m);
    if (!walkable(Math.floor(s.x / TILE), Math.floor(s.y / TILE))) continue;
    if (team.some((q) => los(q.x, q.y, x, y) || los(q.x, q.y, s.x, s.y))) continue;                 // не видно со старта
    if (team.some((q) => mgInArc(m, q.x, q.y) && sightLine({ x, y }, q))) continue;                // отряд не в его секторе
    const lane = castRay(x, y, Math.cos(a), Math.sin(a), M(40), (cx2, cy2) => opaqueT(tileAt(cx2, cy2)));
    if (lane < M(12)) continue;                                                                    // упёрся в стену — не позиция
    const fx = Math.floor((x + Math.cos(a) * TILE) / TILE), fy = Math.floor((y + Math.sin(a) * TILE) / TILE);
    const low = tileAt(fx, fy) === T.LOW;
    const sc = lane / PX_M + (low ? 15 : 0) + rnd() * 5;
    if (sc > bs) { bs = sc; best = { x, y, a }; }
  }
  return best;
}

// Полигон ×1.5: все три пулемёта у старта (стволом на север) — пристрелять
function placeRangeMGs() {
  const st = map.start;
  if (!st) return;
  MG_IDS.forEach((t, i) => {
    const sp = freeSpotNear((st.x + (i - 1) * 4 + 0.5) * TILE, (st.y - 4 + 0.5) * TILE);
    addMG(t, sp.x, sp.y, -Math.PI / 2);
  });
}

// ---------- Отрисовка ----------
// Станок (тренога / колёсный), ствол по yaw, короб с лентой; за пулемётом стрелок рисуется сам (руки на рукоятках)
function drawMGs() {
  if (!map || !map.mgs) return;
  for (const m of map.mgs) {
    if (!onScreen(m.x, m.y)) continue;
    const W = WEAPONS[m.t], yaw = m.yaw ?? m.a;
    ctx.save();
    ctx.translate(m.x, m.y);
    // станок: ноги / колёса — по направлению установки
    ctx.save(); ctx.rotate(m.a);
    ctx.strokeStyle = '#2a2a26'; ctx.lineWidth = 2;
    if (m.t === 'dshk') {
      ctx.fillStyle = '#2c2e28'; ctx.fillRect(-10, -9, 6, 4); ctx.fillRect(-10, 5, 6, 4);       // колёса
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(-20, 0); ctx.stroke();                     // хобот
    } else {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, -7); ctx.moveTo(0, 0); ctx.lineTo(8, 7); ctx.moveTo(0, 0); ctx.lineTo(-14, 0); ctx.stroke();
    }
    ctx.restore();
    // ствол и короб — куда смотрит
    ctx.rotate(yaw);
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-8, -2.4, W.len * 0.55, 4.8);      // короб пулемёта
    ctx.fillStyle = '#222'; ctx.fillRect(-8 + W.len * 0.55, -1.2, W.len * 0.45, 2.4);   // ствол
    if (m.t !== 'pkm') { ctx.fillStyle = '#111'; ctx.fillRect(W.len - 11, -2, 3, 4); }  // дульный тормоз (12,7)
    ctx.fillStyle = '#4a5038'; ctx.fillRect(-3, 2.4, 7, 5);                      // короб с лентой
    ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-12, -2.8, 3, 5.6);                  // рукоятки
    ctx.restore();
  }
}

// ---------- Сеть ----------
const mgState = (m) => [m.id, MG_IDS.indexOf(m.t), r1(m.x), r1(m.y), r2(m.a), m.user || 0, r2(m.yaw ?? m.a), m.gun.mag, m.gun.chamber, m.gun.pouch,
  r2(m.gun.reloadT), r2(m.gun.reloadDur)];
// Гость: пулемёты из снимка (те же объекты по id), потом — кто за каким (o.mg, o.gun)
function applyMgState(list) {
  if (!map) return;
  const old = new Map((map.mgs || []).map((m) => [m.id, m]));
  map.mgs = (list || []).map(([id, ti, x, y, a, user, yaw, mag, chamber, pouch, reloadT, reloadDur]) => {
    const t = MG_IDS[ti];
    const m = old.get(id) && old.get(id).t === t ? old.get(id) : { id, t, arc: WEAPONS[t].arc, gun: makeGun(t), claim: 0 };
    Object.assign(m, { x, y, a, user, yaw });
    Object.assign(m.gun, { mag, chamber, pouch, reloadT, reloadDur });
    return m;
  });
  for (const o of allPeople()) {
    o.mg = map.mgs.find((m) => m.user && m.user === o.id) || null;
    if (o.mg) o.gun = o.mg.gun;
  }
}
