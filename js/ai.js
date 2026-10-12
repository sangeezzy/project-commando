'use strict';
// ---------- ИИ бойцов: противников и союзных ботов (правила одни и те же) ----------
// Цели — живые бойцы другой стороны, свои — своей (foesOf / teamOf). Противники без угрозы стоят на посту или патрулируют,
// союзные боты — держатся у ведущего человека (followLeader). Остальное поведение общее.
// Состояния: 0 спокоен, 1 насторожен (что-то слышал или мельком видел), 2 бой.
// Замечают не мгновенно: шкала notice растёт тем быстрее, чем ближе цель, чем она заметнее
// (стоит в полный рост, двигается, стреляет) и чем внимательнее наблюдатель.

// Шум. kind: 'shot' — выстрел (слышат все в радиусе, сразу бой); 'bang' — удар в дверь (сквозь стены);
// 'step' — шаги, перезарядка, двери (по пути вокруг стен, закрытые двери глушат).
function makeNoise(x, y, r, kind, src) {
  if (r <= 0) return;
  if (kind === 'shot') {
    for (const e of aiList()) {
      if (e.dead || e === src || Math.hypot(e.x - x, e.y - y) > r) continue;
      if (src && src.side === e.side) {
        // стреляет свой — на помощь: туда, куда он стреляет (человек — к нему)
        if (e.st < 2 && !e.seeing) alertEnemy(e, src.ai ? src.lastX : x, src.ai ? src.lastY : y, true);
      } else {
        // стреляют из-за закрытой двери, а он в тревоге и стрелка не видит — отвечает сквозь дверь
        if (e.st === 2 && !e.seeing && Math.hypot(e.x - x, e.y - y) < ENEMY.doorFire.range + M(10)) {
          src._sf = src._sf && src._sf.t === G.time ? src._sf : { t: G.time, f: soundField(x, y, 45) };
          const di = src._sf.f.door[tileIndex(e.x, e.y)];
          if (di >= 0 && startDoorFire(e, map.doors[di], x, y)) continue;
        }
        // выстрел слышно, но место определяют на слух с ошибкой (тем больше, чем дальше)
        const err = Math.hypot(e.x - x, e.y - y) * 0.08;
        alertEnemy(e, x + gauss() * err, y + gauss() * err, true);
      }
    }
    return;
  }
  if (kind === 'bang') {
    // удар в дверь слышно сквозь стены: спокойные идут проверить; настороженные рядом — сразу бой
    if (!src) return;
    for (const e of aiList()) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (e.dead || e.side === src.side || d > r) continue;
      alertEnemy(e, x, y, e.st > 0 && d < M(NOISE.kickNear));
    }
    return;
  }
  if (!src) return;
  const maxD = Math.ceil(r / TILE);
  let field = null;
  for (const e of aiList()) {
    if (e.dead || e.side === src.side || e.seeing || Math.hypot(e.x - x, e.y - y) > r + TILE) continue;
    field = field || soundField(x, y, maxD);
    const i = tileIndex(e.x, e.y);
    if (field.f[i] > maxD) continue;
    // в тревоге услышал шум за закрытой дверью — стреляет сквозь неё
    const d = field.door[i] >= 0 ? map.doors[field.door[i]] : null;
    if (d && e.st === 2 && startDoorFire(e, d, x, y)) continue;
    alertEnemy(e, x, y, false);
  }
}

// Видит ли наблюдатель v бойца o: поле зрения (у ИИ — по его состоянию) и прямая видимость, включая высунувшуюся голову
function sees(v, o) {
  if (!v.ai) return playerSees(v, o);
  const eye = eyeOf(v), d = Math.hypot(o.x - eye.x, o.y - eye.y);
  if (d > NEAR_SENSE && Math.abs(angDiff(Math.atan2(o.y - eye.y, o.x - eye.x), v.a)) > ENEMY.fov[v.st]) return false;
  if (sightLine(eye, o)) return true;
  return Math.abs(o.lean || 0) > 0.25 && sightLine(eye, { x: o.lx, y: o.ly, crouch: o.crouch });
}
const fovOf = (t) => (t.ai ? ENEMY.fov[t.st] : PLAYER_FOV);

// ---------- Выглядывание из-за угла ----------
// Цель «смотрит на него»: он в узком конусе её взгляда и она его видит (вблизи — просто видит)
function watching(t, o) {
  const a = eyeOf(t), b = eyeOf(o);
  if (!sightLine(a, b)) return false;
  if (Math.hypot(b.x - a.x, b.y - a.y) < M(3)) return true;
  return Math.abs(angDiff(Math.atan2(b.y - a.y, b.x - a.x), t.a)) < ENEMY.peek.watchCone;
}

// Идёт к опасности, а следующий шаг выводит из-за угла на линию видимости — остановиться и выглянуть
function tryCornerPeek(e, step) {
  const P = ENEMY.peek;
  if (e.peekCd > 0) return false;
  const dx = e.lastX, dy = e.lastY, dist = Math.hypot(dx - e.x, dy - e.y);
  if (dist > P.range || dist < M(2.5)) return false;
  if (los(e.x, e.y, dx, dy)) return false;                    // место и так на виду — угла нет
  const qx = e.x + Math.cos(step) * P.probe, qy = e.y + Math.sin(step) * P.probe;
  if (opaqueAt(qx, qy) || !los(qx, qy, dx, dy)) return false;  // шаг ещё не выводит на линию
  const face = Math.atan2(dy - e.y, dx - e.x);
  const side = angDiff(step, face) >= 0 ? 1 : -1;               // высовываться туда, куда шёл
  e.peek = { phase: 'look', side, face, t: 0, dur: rand(P.look[0], P.look[1]), target: null };
  e.goal = null;
  return true;
}

function peekStep(e, dt, seen) {
  const P = ENEMY.peek, k = e.peek, g = e.gun;
  e.sprint = false;
  k.t += dt;
  if (seen && e.seeing) k.target = seen.t;
  // за углом его самого видно — прятаться бесполезно, обычный бой
  if ((k.phase === 'hide' || k.phase === 'back') && e.seeing && sightLine({ x: e.x, y: e.y, crouch: e.crouch }, seen.t)) { e.peek = null; return; }

  if (k.phase === 'look' || k.phase === 'shoot') {
    e.crouch = false;
    e.leanWant = k.side;
    if (e.seeing && seen) {
      const t = seen.t;
      // на него смотрят — назад за угол
      if (watching(t, e)) { k.phase = 'back'; k.t = 0; return; }
      // смотрят в другую сторону — стрелять первым
      k.phase = 'shoot';
      e.react -= dt;
      if (!g.chamber && !g.reloadT) startReload(e);
      if (g.reloadT > 0) { k.phase = 'back'; k.t = 0; k.reload = true; return; }
      const aim = seen.partial ? { x: seen.px, y: seen.py, speed: t.speed, crouch: t.crouch } : t;
      const eye = eyeOf(e);
      e.want = Math.atan2(aim.y - eye.y, aim.x - eye.x);
      if (kneelFor(e, aim, dt)) return;      // из-за угла — с колена, если так видно
      shootAt(e, aim, seen.d, dt, false);
      return;
    }
    e.want = k.face;
    if (k.phase === 'shoot') { k.phase = 'look'; k.t = 0; k.dur = rand(P.look[0], P.look[1]); }   // цель пропала — присмотреться
    if (k.t >= k.dur) {
      // никого — дальше
      e.peek = null; e.leanWant = 0; e.peekCd = P.cd;
    }
    return;
  }

  if (k.phase === 'back') {
    e.leanWant = 0; e.burst = 0;
    e.want = k.face;
    if (Math.abs(e.lean) > 0.1) return;
    // спрятался: перезарядиться и пересидеть, либо обойти
    if (!k.reload && k.target && Math.random() < P.flankChance) {
      const f = planFlank(e, k.target);
      if (f) { e.peek = null; e.flank = f; return; }
    }
    k.phase = 'hide'; k.t = 0; k.dur = rand(P.hide[0], P.hide[1]); k.reload = false;
    return;
  }

  if (k.phase === 'hide') {
    e.leanWant = 0; e.burst = 0; e.crouch = true;
    e.want = k.face;
    if (!g.chamber && !g.reloadT) startReload(e);
    if (k.t >= k.dur && !g.reloadT) { k.phase = 'look'; k.t = 0; k.dur = rand(P.look[0], P.look[1]); }
  }
}

// Обход: путь, избегающий клеток, которые цель сейчас видит, к точке в 4–10 м от неё вне её поля зрения
function planFlank(e, t) {
  const P = ENEMY.peek, { w, h } = map;
  const te = eyeOf(t);
  const vis = new Uint8Array(w * h);
  const R = Math.ceil(P.range / TILE);
  const tx = Math.floor(te.x / TILE), ty = Math.floor(te.y / TILE);
  for (let y = Math.max(0, ty - R); y <= Math.min(h - 1, ty + R); y++) for (let x = Math.max(0, tx - R); x <= Math.min(w - 1, tx + R); x++) {
    if (!walkable(x, y, true)) continue;
    const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE, d = Math.hypot(cx - te.x, cy - te.y);
    if (d > NEAR_SENSE && Math.abs(angDiff(Math.atan2(cy - te.y, cx - te.x), t.a)) > fovOf(t) + 0.15) continue;
    if (los(te.x, te.y, cx, cy)) vis[y * w + x] = 1;
  }
  const cost = (i) => (vis[i] ? P.seenCost : 1);
  const from = weightedField(e.x, e.y, cost, P.maxFlank * 3);
  let best = null, bc = 1e9;
  const r1 = Math.ceil(P.flankR[1] / TILE);
  for (let y = Math.max(0, ty - r1); y <= Math.min(h - 1, ty + r1); y++) for (let x = Math.max(0, tx - r1); x <= Math.min(w - 1, tx + r1); x++) {
    const i = y * w + x;
    if (vis[i] || !walkable(x, y, false) || from.f[i] >= bc) continue;
    const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE, d = Math.hypot(cx - te.x, cy - te.y);
    if (d < P.flankR[0] || d > P.flankR[1] || !los(cx, cy, te.x, te.y)) continue;
    bc = from.f[i]; best = { x: cx, y: cy };
  }
  if (!best || bc > P.maxFlank) return null;
  // who — настоящая цель (для догадки о её месте в поиске — та, с кем дрался)
  return { field: weightedField(best.x, best.y, cost, P.maxFlank * 3), x: best.x, y: best.y, t: 0, tx: t.x, ty: t.y, who: t.gun ? t : e.target };
}

// Обход. Сначала бегом выйти из поля зрения цели, дальше тихо к точке обхода.
// Цель снова его увидела — бой; дошёл — бой (если видит цель — стреляет первым).
function flankStep(e, dt, seen) {
  const F = e.flank;
  F.t += dt;
  const who = F.who && !F.who.dead ? F.who : null;
  const spotted = who ? sees(who, e) : false;
  if (!spotted) F.broke = true;
  const done = () => { e.flank = null; if (e.role === 'flank') e.role = null; };
  if (F.broke && spotted) { done(); if (e.seeing) fight(e, dt, seen); return; }
  e.crouch = false; e.burst = 0;
  const step = fieldStep(e, F.field);
  if (step === null || F.t > 25 || Math.hypot(F.x - e.x, F.y - e.y) < M(0.6)) {
    // пришёл (или не вышло) — дальше как обычно: к месту, где видел цель
    done(); e.goal = null; e.peekCd = 0; e.sprint = false;
    if (e.seeing) { fight(e, dt, seen); return; }
    e.lastX = F.tx; e.lastY = F.ty;
    return;
  }
  e.sprint = !F.broke;
  moveDir(e, step, F.broke ? ENEMY.speed.walk * 1.2 : ENEMY.speed.run, dt);
  e.want = step;
}

// ---------- Группа: один подавляет, другой обходит ----------
function updateSquads(dt) {
  const S = G.squad || (G.squad = { t: 0, flankCd: 0 });
  const Q = ENEMY.squad;
  S.flankCd = Math.max(0, S.flankCd - dt);
  S.t -= dt;
  if (S.t > 0) return;
  S.t = 0.5;
  const ais = aiList();
  for (const t of allPeople()) {
    const eng = t.dead || t.down ? [] : ais.filter((e) => !e.dead && e.side !== t.side && e.st === 2 && e.target === t &&
      G.time - e.lastSeen < Q.memory && Math.hypot(e.x - e.lastX, e.y - e.lastY) < Q.range);
    if (eng.length < 2) { for (const e of ais) if (e.target === t && e.role === 'suppress') e.role = null; continue; }
    const dT = (e) => Math.hypot(e.x - t.x, e.y - t.y);
    let sup = eng.find((e) => e.role === 'suppress' && !e.flank);
    if (!sup) {
      sup = eng.filter((e) => !e.flank && !e.peek).sort((a, b) => (b.seeing - a.seeing) || dT(a) - dT(b))[0];
      if (sup) sup.role = 'suppress';
    }
    if (S.flankCd > 0 || eng.some((e) => e.flank)) continue;
    for (const f of eng.filter((e) => e !== sup && !e.peek).sort((a, b) => dT(a) - dT(b))) {
      const pl = planFlank(f, t);
      if (!pl) continue;
      f.flank = pl; f.role = 'flank';
      if (sup) bark(sup, 'Прикрываю!');
      bark(f, 'Обхожу!');
      S.flankCd = Q.flankCd;
      break;
    }
  }
}

// Подавляющий: цель скрылась — держать её место под огнём, пока напарники заходят (не дольше suppressFor)
function suppressing(e) {
  return e.role === 'suppress' && G.time - e.lastSeen < ENEMY.squad.suppressFor;
}

function suppressStep(e, dt) {
  const g = e.gun, Q = ENEMY.squad;
  e.sprint = false;
  if (!e.supAim) e.supAim = { x: e.lastX, y: e.lastY };
  e.want = Math.atan2(e.supAim.y - e.y, e.supAim.x - e.x);
  if (!g.chamber && !g.reloadT) startReload(e);
  const inCover = e.cover && Math.hypot(e.cover.x - e.x, e.cover.y - e.y) <= 6;
  e.supPause = Math.max(0, (e.supPause || 0) - dt);
  if (inCover && (g.reloadT > 0 || (e.burst <= 0 && e.supPause > 0.3))) { e.crouch = true; return; }   // пригнуться между очередями
  e.crouch = false;
  if (g.reloadT > 0) return;
  if (kneelFor(e, { x: e.supAim.x, y: e.supAim.y, crouch: false }, dt)) return;
  if (e.burst <= 0) {
    if (e.supPause > 0) return;
    // новая очередь: точка прицела гуляет вокруг последнего места цели
    e.burst = randi(Q.burst[0], Q.burst[1]);
    e.supPause = rand(Q.pause[0], Q.pause[1]);
    e.supAim = { x: e.lastX + gauss() * M(Q.spreadM), y: e.lastY + gauss() * M(Q.spreadM) };
    return;
  }
  if (Math.abs(angDiff(e.want, e.a)) > 0.05 || friendlyInLine(e, e.supAim)) return;
  if (pullTrigger(e, true, true, WEAPONS[g.t].mech + ENEMY.aim + g.bloom)) e.burst--;
}

// ---------- Тела убитых ----------
function checkBodies(e) {
  if (e.seeing) return;
  const B = ENEMY.body, eye = eyeOf(e);
  const team = teamOf(e.side);
  for (const b of team) {
    if (!b.dead || b === e || e.bodies.has(b.id)) continue;
    const d = Math.hypot(b.x - eye.x, b.y - eye.y);
    if (d > B.range) continue;
    if (d > NEAR_SENSE && Math.abs(angDiff(Math.atan2(b.y - eye.y, b.x - eye.x), e.a)) > ENEMY.fov[e.st]) continue;
    if (!los(eye.x, eye.y, b.x, b.y)) continue;
    if (d > NEAR_SENSE && lightAt(b.x, b.y) * gainFor(lightAt(e.x, e.y)) < LIGHT.seeMin) continue;
    e.bodies.add(b.id);
    // нашёл тело: тревога, зовёт ближних, идёт к телу (уже известное тело — просто запомнил)
    if (b.bodyFound) continue;
    b.bodyFound = true;
    bark(e, 'Тут труп! Тревога!');
    alertEnemy(e, b.x, b.y, true);
    for (const o of team) {
      if (o === e || !o.ai || o.dead || o.seeing || Math.hypot(o.x - e.x, o.y - e.y) > B.shout) continue;
      alertEnemy(o, b.x, b.y, true);
      o.bodies.add(b.id);
    }
    return;
  }
}

// Короткая реплика (слышно игрокам поблизости)
function bark(e, text) {
  if (e.barkT > 0) return;
  e.barkT = ENEMY.barkCd;
  emit(['bark', e.x, e.y, text, e.side]);
}

// ---------- Стрельба через закрытую дверь ----------
// Точка перед дверью со стороны стрелка: дверь непрозрачна, видеть нужно её лицевую сторону
function doorFront(d, e) {
  if (d.horiz) return { x: d.cx, y: d.cy + Math.sign(e.y - d.cy || 1) * TILE * 0.6 };
  return { x: d.cx + Math.sign(e.x - d.cx || 1) * TILE * 0.6, y: d.cy };
}

// Начать (или продлить) обстрел двери. Только если дверь закрыта, её пробивает пуля и стрелок видит её.
function startDoorFire(e, d, nx, ny) {
  const F = ENEMY.doorFire;
  e.lastX = nx; e.lastY = ny; e.calmT = 0;
  if (doorPassable(d) || MAT[DOOR_TYPES[d.type].wm].pen < F.minPen) return false;
  const fr = doorFront(d, e);
  if (Math.hypot(fr.x - e.x, fr.y - e.y) > F.range || !los(e.x, e.y, fr.x, fr.y)) return false;
  if (e.doorFire || (e.doorFireCd || 0) > 0) return true;     // уже стреляет или только что отстрелялся
  // веер по ширине двери и чуть шире, слева направо или справа налево — случайно
  const half = TILE / 2 + F.over;
  const a = d.horiz ? { x: d.cx - half, y: d.cy } : { x: d.cx, y: d.cy - half };
  const b = d.horiz ? { x: d.cx + half, y: d.cy } : { x: d.cx, y: d.cy + half };
  const rev = Math.random() < 0.5;
  e.doorFire = { d, from: rev ? b : a, to: rev ? a : b, shots: randi(F.shots[0], F.shots[1]), fired: 0, delay: rand(F.delay[0], F.delay[1]) };
  e.goal = null; e.searchT = 0;
  return true;
}

function doorFireStep(e, dt) {
  const F = e.doorFire, g = e.gun;
  e.sprint = false; e.crouch = false;
  if (doorPassable(F.d)) { e.doorFire = null; return; }       // дверь открыли — дальше обычный бой
  if (!g.chamber && !g.reloadT) startReload(e);
  if (g.reloadT > 0) return;
  const fr = doorFront(F.d, e);
  if (kneelFor(e, { x: fr.x, y: fr.y, crouch: false }, dt)) return;
  const k = F.shots > 1 ? F.fired / (F.shots - 1) : 0.5;
  const px = F.from.x + (F.to.x - F.from.x) * k, py = F.from.y + (F.to.y - F.from.y) * k;
  const aim = Math.atan2(py - e.y, px - e.x);
  e.want = aim;
  F.delay -= dt;
  if (F.delay > 0 || Math.abs(angDiff(aim, e.a)) > 0.12) return;
  if (friendlyInLine(e, { x: px, y: py })) return;
  e.a = aim;                                                    // ведёт стволом по двери
  if (pullTrigger(e, true, true, WEAPONS[g.t].mech + ENEMY.aim * 0.5 + g.bloom * 0.3)) {
    F.fired++;
    if (F.fired >= F.shots) {
      e.doorFire = null;
      e.doorFireCd = rand(ENEMY.doorFire.cd[0], ENEMY.doorFire.cd[1]);
    }
  }
}

// Враг узнал о чём-то в точке (x, y). combat — сразу бой (выстрелы, ранение), иначе — проверить.
function alertEnemy(e, x, y, combat) {
  if (e.dead) return;
  if (combat && e.st < 2) { e.st = 2; e.react = rand(ENEMY.react[0], ENEMY.react[1]); }
  else if (!combat && e.st === 0) e.st = 1;
  e.calmT = 0;
  if (!e.seeing) {
    e.lastX = x; e.lastY = y;
    if (!combat) e.lastSeen = Math.min(e.lastSeen, G.time - 10);
    e.goal = null; e.searchT = 0; e.investigate = true;
    e.look = Math.atan2(y - e.y, x - e.x);
  }
}

// Шаг ИИ. Закрытая незапертая дверь на пути — сначала открыть.
function moveDir(e, ang, mps, dt) {
  if (aiDoorAhead(e, ang, dt)) return false;
  return moveCircle(e, Math.cos(ang) * M(mps) * dt, Math.sin(ang) * M(mps) * dt, PR);
}

// Кого из бойцов другой стороны видит прямо сейчас (и под каким углом от взгляда)
function perceive(e) {
  let best = null, bd = 1e9;
  // присевший в бою за укрытием «помнит» цель, как если бы выглянул
  const base = eyeOf(e);   // при выглядывании — из-за угла
  const eye = e.crouch && e.st === 2 ? { x: base.x, y: base.y, crouch: false } : base;
  for (const t of foesOf(e)) {
    if (t.dead || t.down) continue;          // лежачий раненый — не угроза, патроны на него не тратят
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    if (d > ENEMY.sight || d >= bd) continue;
    const off = Math.abs(angDiff(Math.atan2(t.y - e.y, t.x - e.x), e.a));
    if (off > ENEMY.fov[e.st] && d > NEAR_SENSE) continue;
    // тело за укрытием — может быть видна высунувшаяся голова (выглядывание)
    let px = t.x, py = t.y, partial = false;
    if (!sightLine(eye, t)) {
      if (!(Math.abs(t.lean || 0) > 0.25 && sightLine(eye, { x: t.lx, y: t.ly, crouch: t.crouch }))) continue;
      px = t.lx; py = t.ly; partial = true;
    }
    // в темноте не разглядеть (вблизи всё равно заметит)
    if (d > NEAR_SENSE && seenBrightness(e, t) < LIGHT.seeMin) continue;
    best = { t, d, off, px, py, partial }; bd = d;
  }
  return best;
}

// Сколько секунд нужно, чтобы заметить цель
function noticeTime(e, t, d, off, partial = false) {
  let T = 0.15 + d / PX_M / 25;           // 5 м — 0,35 с, 30 м — 1,35 с, 60 м — 2,55 с
  if (partial) T *= LEAN.notice;          // видна только высунувшаяся голова
  if (t.crouch) T *= 1.7;
  const vis = Math.min(1, seenBrightness(e, t));
  T *= 1 + 3 * (1 - vis) * (1 - vis);    // в полумраке замечают дольше
  if (t.speed < M(0.5)) T *= 1.4;
  if (off > 0.6) T *= 1.6;                // боковое зрение
  if (G.time - t.gun.lastShot < 0.6) T *= 0.25;   // вспышка выстрела
  if (e.st === 1) T *= 0.5;
  if (e.st === 2) T *= 0.2;
  return T;
}

// Все бойцы под ИИ: противники и союзные боты
function updateAI(dt) {
  updateSquads(dt);
  const ais = aiList();
  for (const e of ais) {
    if (e.dead) continue;
    e.reviveWant = false;
    if (e.down) { downedAI(e, dt); continue; }
    e.flankCd = Math.max(0, (e.flankCd || 0) - dt);
    e.stillT = e.speed < M(0.3) ? (e.stillT || 0) + dt : 0;
    e.barkT = Math.max(0, (e.barkT || 0) - dt);
    updateGun(e, dt);
    e.supp = Math.max(0, e.supp - dt * 0.45);
    // ослепление фонарём (только в темноте): быстро наступает, проходит за ~1 с
    const gl = Math.min(1, glareAt(e) * 2.5);
    e.blind = gl > (e.blind || 0) ? gl : Math.max(gl, (e.blind || 0) - dt);
    e.duckT = Math.max(0, (e.duckT || 0) - dt);
    const seen = perceive(e);
    if (seen) {
      e.notice = Math.min(1, e.notice + dt / noticeTime(e, seen.t, seen.d, seen.off, seen.partial));
      if (e.notice >= 1) {
        if (e.st < 2) { e.st = 2; e.react = rand(ENEMY.react[0], ENEMY.react[1]); }
        else if (!e.seeing) e.react = Math.max(e.react, rand(0.1, 0.3));
        e.seeing = true; e.target = seen.t; e.huntFlank = false;
        e.lastX = seen.px; e.lastY = seen.py; e.lastSeen = G.time;
        e.goal = null; e.investigate = false; e.searchT = 0;
      } else {
        e.seeing = false;
        if (e.notice > 0.4) {
          // что-то мелькнуло — повернуться и присмотреться
          if (e.st === 0) e.st = 1;
          e.look = Math.atan2(seen.t.y - e.y, seen.t.x - e.x);
          e.lastX = seen.t.x; e.lastY = seen.t.y; e.investigate = true; e.calmT = 0;
        }
      }
    } else {
      e.seeing = false;
      if (e.st < 2) e.notice = Math.max(0, e.notice - dt * 0.2);
    }

    checkBodies(e);
    e.doorFireCd = Math.max(0, (e.doorFireCd || 0) - dt);
    e.peekCd = Math.max(0, (e.peekCd || 0) - dt);
    if (e.seeing) e.doorFire = null;
    if (!e.peek) e.leanWant = 0;
    if (e.side === 'p') checkLeash(e);
    const hurt = e.side === 'p' && !e.seeing ? downedToHelp(e) : null;
    if (hurt) reviveStep(e, hurt, dt);
    else if (e.regroup && !e.seeing) followLeader(e, dt);
    else if (e.peek) peekStep(e, dt, seen);
    else if (e.flank) flankStep(e, dt, seen);
    else if (e.st === 2 && e.seeing) fight(e, dt, seen);
    else if (e.doorFire) doorFireStep(e, dt);
    else if (e.st === 2 && suppressing(e)) suppressStep(e, dt);
    else if (e.st === 2) hunt(e, dt);
    else idle(e, dt);
    if (!e.kneelSet) e.kneel = false;      // колено держат только режимы прицельного огня
    e.kneelSet = false;
    e.a = turnTo(e.a, e.want === undefined ? e.a : e.want, ENEMY.turn * dt);
    updateLean(e, dt);
    updateEnemyLamp(e, dt);
  }
  separate(ais.filter((e) => !e.dead), PR * 2);
  // люди не толкаются (у гостя позицию ведёт его компьютер) — боты сами отходят от них
  for (const h of G.players) {
    if (h.ai || h.dead) continue;
    for (const e of ais) {
      if (e.dead) continue;
      const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy);
      if (d < PR * 2 && d > 0.01) moveCircle(e, (dx / d) * (PR * 2 - d), (dy / d) * (PR * 2 - d), PR);
    }
  }
}

// ---------- Бой: видит цель ----------
function fight(e, dt, seen) {
  // видна только высунувшаяся голова — целится в неё
  const t = seen.partial ? { x: seen.px, y: seen.py, speed: seen.t.speed, crouch: seen.t.crouch } : seen.t;
  const d = seen.d, g = e.gun;
  const ta = Math.atan2(t.y - e.y, t.x - e.x);
  e.want = ta;
  e.react -= dt;
  // затянувшийся бой, цель за укрытием — пойти во фланг (подавляющий в группе держит позицию)
  e.fightT = (e.fightT || 0) + dt;
  const F = ENEMY.flank;
  if (e.role !== 'suppress' && e.flankCd <= 0 && e.fightT > F.after && coverToward(t.x, t.y, e.x, e.y) && Math.random() < dt * F.rate) {
    e.flankCd = F.cd;
    const pl = planFlank(e, seen.t);
    if (pl) { e.flank = pl; bark(e, 'Обхожу!'); return; }
  }

  // огонь на ходу: отход с огнём или продвижение с подавлением
  if (fireMoveCheck(e, seen.t, d, dt)) { fireMoveStep(e, t, d, dt); return; }

  // укрытие: искать, если нет или оно больше не закрывает от цели
  e.coverT -= dt;
  if (e.coverT <= 0) {
    e.coverT = 0.8;
    if (!e.cover || !coverToward(e.cover.x, e.cover.y, t.x, t.y)) e.cover = findCover(e, t);
  }
  const toCover = e.cover ? Math.hypot(e.cover.x - e.x, e.cover.y - e.y) : 0;
  const moving = e.cover && toCover > 6 && d > M(5);
  if (moving) {
    // перебежка в укрытие: оружие не стреляет на бегу
    e.crouch = false;
    const step = fieldStep(e, fieldTo(e.cover.x, e.cover.y));
    if (step !== null) { moveDir(e, step, ENEMY.speed.run, dt); e.sprint = true; }
    else e.cover = null;
    if (toCover > M(3)) e.want = step === null ? ta : step;
    e.burst = 0;
    e.aimT = 0;
    return;
  }
  e.sprint = false;

  // в укрытии: перезарядка и «нырок» после очереди под огнём — присев (спрятаться)
  const inCover = e.cover && toCover <= 6;
  if (!g.chamber && !g.reloadT) startReload(e);
  if (inCover && (g.reloadT > 0 || e.duckT > 0)) { e.crouch = true; e.aimT = 0; return; }
  e.crouch = false;
  if (g.reloadT > 0) { e.aimT = 0; return; }
  if (kneelFor(e, t, dt)) return;

  shootAt(e, t, d, dt, inCover);
}

// ---------- Огонь на ходу ----------
// Решение раз в decide с; режим держится заданное время (без дёрганья). Возвращает true, пока режим идёт.
function fireMoveCheck(e, t, d, dt) {
  const F = ENEMY.fireMove;
  e.fmCd = Math.max(0, (e.fmCd || 0) - dt);
  if (e.fm) {
    e.fm.t += dt;
    const over = e.fm.t >= e.fm.dur || (e.fm.kind === 'advance' && d < F.advanceMin) || e.gun.reloadT > 0;
    if (!over) return true;
    e.fm = null; e.fmCd = F.cd;
    return false;
  }
  if (e.fmCd > 0 || e.gun.reloadT > 0) return false;
  e.fmDecide = (e.fmDecide || 0) - dt;
  if (e.fmDecide > 0) return false;
  e.fmDecide = F.decide;
  const inCover = e.cover && Math.hypot(e.cover.x - e.x, e.cover.y - e.y) <= 6 && coverToward(e.x, e.y, t.x, t.y);
  // отход с огнём: ранен и стоит открыто, или цель вплотную
  if ((e.hp < F.retreatHp && !inCover) || d < F.tooClose) {
    e.fm = { kind: 'retreat', t: 0, dur: rand(F.retreatDur[0], F.retreatDur[1]) };
    bark(e, 'Отхожу!');
    return true;
  }
  // продвижение с подавлением: цель перезаряжается или её держит наш подавляющий; без укрытия — и просто прижатую огнём
  // (из хорошего укрытия в одиночку на прижатую цель не лезут)
  const covered = teamOf(e.side).some((o) => o !== e && o.ai && !o.dead && o.role === 'suppress' && o.target === t);
  const pinned = covered || (t.gun && t.gun.reloadT > 0) || (!inCover && (t.supp || 0) > 0.5);
  if (e.role !== 'suppress' && d > F.advanceMin && pinned && Math.random() < F.advanceChance) {
    e.fm = { kind: 'advance', t: 0, dur: rand(F.advanceDur[0], F.advanceDur[1]) };
    bark(e, 'Вперёд, давлю!');
    return true;
  }
  return false;
}

// Шагом (не бегом) отходит от цели или идёт на неё, держа её на прицеле и стреляя (с поправкой на движение)
function fireMoveStep(e, t, d, dt) {
  const g = e.gun, ta = Math.atan2(t.y - e.y, t.x - e.x);
  e.sprint = false; e.crouch = false; e.cover = null;
  e.want = ta;
  if (!g.chamber && !g.reloadT) startReload(e);
  if (e.fm.kind === 'retreat') {
    // пятится: назад медленнее, стены — обходить скольжением; упёрся — в сторону
    const back = ta + Math.PI + (e.fm.side || 0);
    const before = { x: e.x, y: e.y };
    moveDir(e, back, ENEMY.speed.walk * MOVE_DIR.back, dt);
    if (Math.hypot(e.x - before.x, e.y - before.y) < M(ENEMY.speed.walk * MOVE_DIR.back) * dt * 0.3) e.fm.side = (e.fm.side ? -e.fm.side : (Math.random() < 0.5 ? 0.8 : -0.8));
  } else {
    const step = fieldStep(e, fieldTo(t.x, t.y));
    if (step !== null) moveDir(e, step, ENEMY.speed.walk, dt);
  }
  if (g.reloadT > 0) return;
  shootAt(e, t, d, dt, false);
}

// Прицельный огонь по цели t (очереди вблизи, одиночные вдали). Целится от глаз — при выглядывании из-за угла.
function shootAt(e, t, d, dt, inCover) {
  const g = e.gun, eye = eyeOf(e);
  const ta = Math.atan2(t.y - eye.y, t.x - eye.x);
  const off = Math.abs(angDiff(ta, e.a));
  if (off < 0.08) e.aimT += dt; else e.aimT = Math.max(0, e.aimT - dt * 2);
  if (e.react > 0 || off > 0.05) return;
  if (friendlyInLine(e, t)) return;

  const spread = WEAPONS[g.t].mech + ENEMY.aim * (e.kneel ? ENEMY.kneel.aimK : 1) + ENEMY.aimFirst * Math.exp(-e.aimT / ENEMY.settle) +
    e.supp * ENEMY.suppAim + e.blind * ENEMY.blindAim + clamp(t.speed / M(3), 0, 1.5) * 6 + g.bloom +
    clamp(e.speed / M(ENEMY.speed.walk), 0, 1.5) * ENEMY.moveAim;      // на ходу — хуже
  if (e.burst > 0) {
    if (pullTrigger(e, true, true, spread)) e.burst--;
    if (!g.chamber) e.burst = 0;
    if (e.burst === 0 && inCover && e.supp > 0.45) e.duckT = rand(0.6, 1.4);
  } else {
    e.pause -= dt;
    if (e.pause <= 0 && g.chamber) {
      if (d > ENEMY.semiRange) { e.burst = 1; e.pause = rand(ENEMY.semiGap[0], ENEMY.semiGap[1]); }
      else { e.burst = randi(ENEMY.burst[0], ENEMY.burst[1]); e.pause = rand(ENEMY.burstPause[0], ENEMY.burstPause[1]); }
    }
  }
}

// Стрельба с колена: стоит на месте и ведёт прицельный огонь — присесть, если присевшему цель (точка) всё ещё видна
// (за низким укрытием присевший поверх не видит — там стреляют стоя). Возвращает true, пока меняет стойку: не стрелять.
function kneelFor(e, target, dt) {
  const K = ENEMY.kneel;
  e.kneelSet = true;
  const eye = eyeOf(e);
  const want = e.stillT > K.settle && sightLine({ x: eye.x, y: eye.y, crouch: true }, target);
  if (want !== !!e.kneel) { e.kneel = want; e.stanceT = K.lock; }
  e.crouch = e.kneel;
  e.stanceT = Math.max(0, (e.stanceT || 0) - dt);
  return e.stanceT > 0;
}

// Свой на линии огня (и бот, и человек) — не стрелять
function friendlyInLine(e, t) {
  const dx = t.x - e.x, dy = t.y - e.y, L = Math.hypot(dx, dy);
  for (const o of teamOf(e.side)) {
    if (o === e || o.dead) continue;
    const k = ((o.x - e.x) * dx + (o.y - e.y) * dy) / (L * L);
    if (k <= 0 || k >= 1) continue;
    if (Math.abs((o.x - e.x) * dy - (o.y - e.y) * dx) / L < PR + 6) return true;
  }
  return false;
}

// Первая преграда от точки в сторону цели в пределах COVER_NEAR — низкое укрытие
function coverToward(x, y, tx, ty) {
  const dx = tx - x, dy = ty - y, L = Math.hypot(dx, dy);
  if (L < M(4)) return false;
  for (let s = 8; s <= COVER_NEAR; s += 6) {
    const t = tileAt(Math.floor((x + (dx / L) * s) / TILE), Math.floor((y + (dy / L) * s) / TILE));
    if (t === T.LOW) return true;
    if (opaqueT(t)) return false;
  }
  return false;
}

// Ближайшая по пути клетка за низким укрытием, откуда, встав, видно цель
function findCover(e, t) {
  const R = 10;
  const f = bfsFrom(e.x, e.y, R + 2, true);
  const ex = Math.floor(e.x / TILE), ey = Math.floor(e.y / TILE);
  let best = null, bs = 1e9;
  for (let ty = ey - R; ty <= ey + R; ty++) for (let tx = ex - R; tx <= ex + R; tx++) {
    if (tileAt(tx, ty) !== T.FLOOR) continue;
    const pd = f.f[ty * map.w + tx];
    if (pd > R + 2) continue;
    const cx = (tx + 0.5) * TILE, cy = (ty + 0.5) * TILE;
    if (Math.hypot(t.x - cx, t.y - cy) < M(6)) continue;
    if (teamOf(e.side).some((o) => o !== e && !o.dead && ((o.cover && Math.hypot(o.cover.x - cx, o.cover.y - cy) < TILE * 1.5) ||
      Math.hypot(o.x - cx, o.y - cy) < TILE))) continue;
    if (!coverToward(cx, cy, t.x, t.y) || !los(cx, cy, t.x, t.y)) continue;
    // ближе по пути; при прочих равных — не подходить к цели слишком близко
    const s = pd + Math.max(0, 12 - Math.hypot(t.x - cx, t.y - cy) / TILE) * 0.3;
    if (s < bs) { bs = s; best = { x: cx, y: cy }; }
  }
  return best;
}

// ---------- Бой: цель пропала из виду ----------
function hunt(e, dt) {
  const g = e.gun;
  e.crouch = false; e.sprint = false; e.burst = 0; e.fightT = 0;
  const lost = G.time - e.lastSeen;
  // цель только что скрылась — иногда не лезть в лоб, а зайти сбоку (откуда она, скорее всего, не ждёт)
  if (e.target && !e.huntFlank && !e.role && lost > 1.2 && lost < 4) {
    e.huntFlank = true;
    if (Math.random() < ENEMY.flank.huntChance) {
      const guess = { x: e.lastX, y: e.lastY, a: Math.atan2(e.y - e.lastY, e.x - e.lastX) };   // смотрит, вероятно, на него
      const pl = planFlank(e, guess);
      if (pl) { e.flank = pl; bark(e, 'Захожу сбоку!'); return; }
    }
  }
  if (g.mag < 12 && !g.reloadT && g.pouch.some((n) => n > g.mag)) startReload(e);
  // только что видел и сидит в укрытии — ждём, пока цель высунется
  if (lost < 2.5 && e.cover && Math.hypot(e.cover.x - e.x, e.cover.y - e.y) < 8) {
    e.want = Math.atan2(e.lastY - e.y, e.lastX - e.x);
    if (g.reloadT > 0) e.crouch = true;
    return;
  }
  if (lost < 1.2) { e.want = Math.atan2(e.lastY - e.y, e.lastX - e.x); return; }
  if (g.reloadT > 0) { e.crouch = !!e.cover; return; }
  // идём проверить последнее известное место
  if (e.searchT <= 0) {
    e.goal = e.goal || bfsFrom(e.lastX, e.lastY, 1e9, true);
    const step = fieldStep(e, e.goal);
    if (step !== null && Math.hypot(e.lastX - e.x, e.lastY - e.y) > M(1.5)) {
      if (tryCornerPeek(e, step)) return;
      moveDir(e, step, ENEMY.speed.walk, dt);
      e.want = step;
      return;
    }
    e.goal = null; e.cover = null;
    e.searchT = rand(5, 8);
  }
  e.searchT -= dt;
  lookAround(e, dt, 2.4);
  if (e.searchT <= 0) { e.st = 1; e.calmT = 0; e.investigate = false; e.notice = 0.3; }
}

function lookAround(e, dt, spread) {
  e.lookT -= dt;
  if (e.lookT <= 0) { e.look = e.a + rand(-spread, spread); e.lookT = rand(0.7, 1.5); }
  e.want = e.look;
}

// ---------- Спокоен / насторожен ----------
function idle(e, dt) {
  e.crouch = false; e.sprint = false; e.burst = 0; e.fightT = 0;
  const g = e.gun;
  if (g.mag < WEAPONS[g.t].mag - 5 && !g.reloadT && g.pouch.some((n) => n > g.mag)) startReload(e);
  if (e.st === 1) {
    e.calmT += dt;
    if (e.investigate) {
      // идём проверить, что там было
      if (e.notice > 0.4) { e.want = e.look; return; }   // ещё присматривается
      e.goal = e.goal || bfsFrom(e.lastX, e.lastY, 1e9, true);
      const step = fieldStep(e, e.goal);
      if (step !== null && Math.hypot(e.lastX - e.x, e.lastY - e.y) > M(1.5)) {
        if (tryCornerPeek(e, step)) return;
        moveDir(e, step, ENEMY.speed.patrol * 1.4, dt);
        e.want = step;
        return;
      }
      e.goal = null; e.investigate = false; e.searchT = rand(4, 6);
    }
    if (e.searchT > 0) { e.searchT -= dt; lookAround(e, dt, 2.2); return; }
    if (e.calmT > 25) { e.st = 0; e.notice = 0; }
  }
  if (e.side === 'p') { followLeader(e, dt); return; }      // союзный бот — к ведущему
  if (e.patrol) {
    const pt = e.patrol[e.pi];
    if (Math.hypot(pt.x - e.x, pt.y - e.y) < 10) {
      e.waitT = (e.waitT || 0) + dt;
      lookAround(e, dt, 1.2);
      if (e.waitT > 2.5) { e.waitT = 0; e.pi = (e.pi + 1) % e.patrol.length; }
      return;
    }
    const step = fieldStep(e, fieldTo(pt.x, pt.y));
    if (step === null) { e.pi = (e.pi + 1) % e.patrol.length; return; }
    moveDir(e, step, ENEMY.speed.patrol, dt);
    e.want = step;
    return;
  }
  // пост: вернуться на место и осматривать свой сектор
  if (Math.hypot(e.home.x - e.x, e.home.y - e.y) > 12) {
    const step = fieldStep(e, fieldTo(e.home.x, e.home.y));
    if (step !== null) { moveDir(e, step, ENEMY.speed.patrol, dt); e.want = step; return; }
  }
  e.lookT -= dt;
  if (e.lookT <= 0) { e.look = e.home.a + rand(-0.9, 0.9); e.lookT = rand(2, 4); }
  e.want = e.look;
}

// Фонарь противника: включён в темноте (на посту, в поиске и в бою, и стреляя с колена), выключен,
// когда прячется за укрытием, чтобы не выдать себя. При ENEMY.lamps = false не включается.
function wantsLamp(e) {
  if (!ENEMY.lamps || !e.hasLamp || e.dead) return false;
  if (e.crouch && !e.kneel) return false;   // прячется — гасит; с колена стреляет — с фонарём
  const ahead = ambientAt(e.x + Math.cos(e.a) * M(3), e.y + Math.sin(e.a) * M(3));
  return Math.min(ambientAt(e.x, e.y), ahead) < ENEMY.lampDark;
}

function updateEnemyLamp(e, dt) {
  const want = wantsLamp(e);
  if (want === e.lamp) { e.lampT = 0; return; }
  // спрятаться — выключить сразу; включить или выключить при смене света — с небольшой задержкой
  if (!want && e.crouch) { e.lamp = false; e.lampT = 0; return; }
  e.lampT += dt;
  if (e.lampT >= (e.lampWait || (e.lampWait = rand(ENEMY.lampDelay[0], ENEMY.lampDelay[1])))) {
    e.lamp = want; e.lampT = 0; e.lampWait = 0;
    emit(['lamp', e.x, e.y]);
  }
}

// ---------- Раненые: бот ползёт к своим; свободный бот идёт поднимать ----------
function downedAI(e, dt) {
  e.crouch = true; e.sprint = false; e.leanWant = 0; e.burst = 0; e.kneel = false;
  e.lamp = false;
  const mates = G.players.filter((q) => q !== e && !q.dead && !q.down);
  if (!mates.length) return;
  const m = mates.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0];
  e.want = Math.atan2(m.y - e.y, m.x - e.x);
  e.a = turnTo(e.a, e.want, ENEMY.turn * dt);
  if (Math.hypot(m.x - e.x, m.y - e.y) > M(1)) {          // подползти так, чтобы дотянулись
    const step = fieldStep(e, fieldTo(m.x, m.y));
    if (step !== null) moveCircle(e, Math.cos(step) * M(DOWN.crawl) * dt, Math.sin(step) * M(DOWN.crawl) * dt, PR);
  }
}

// Кого из раненых поднимать: ближайший в пределах DOWN.botRange, если его не поднимает кто-то другой
function downedToHelp(e) {
  let best = null, bd = DOWN.botRange;
  for (const t of G.players) {
    if (t === e || !t.down || t.dead) continue;
    if (t.lastReviver && t.lastReviver !== e.id) continue;
    // идёт ближайший к раненому из свободных ботов
    const d = Math.hypot(t.x - e.x, t.y - e.y);
    const closer = G.players.some((o) => o !== e && o.ai && !o.dead && !o.down && !o.seeing && Math.hypot(t.x - o.x, t.y - o.y) < d - 1 &&
      (!t.lastReviver || t.lastReviver === o.id));
    if (closer || d >= bd) continue;
    bd = d; best = t;
  }
  return best;
}

function reviveStep(e, t, dt) {
  e.sprint = false; e.burst = 0; e.peek = null; e.leanWant = 0;
  const d = Math.hypot(t.x - e.x, t.y - e.y);
  e.want = Math.atan2(t.y - e.y, t.x - e.x);
  if (d > DOWN.reviveR * 0.75) {
    e.crouch = false;
    const step = fieldStep(e, fieldTo(t.x, t.y)) ?? Math.atan2(t.y - e.y, t.x - e.x);
    const far = d > M(6);
    e.sprint = far;
    moveDir(e, step, far ? ENEMY.speed.run : ENEMY.speed.walk, dt);
    return;
  }
  e.crouch = true;          // присел рядом и поднимает
  e.reviveWant = true;
}

// ---------- Союзный бот: держаться у ведущего ----------
// Ведущий — назначенный человек (если жив), иначе ближайший живой человек отряда
function leaderOf(e) {
  const humans = G.players.filter((q) => !q.ai && !q.dead);
  return humans.find((q) => q.slot === e.leader) ||
    humans.sort((a, b) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y))[0] || null;
}

// Слишком далеко от ведущего (ушёл проверять, искать, обходить) — бросить и вернуться
function checkLeash(e) {
  const L = leaderOf(e), A = ENEMY.ally;
  if (!L) { e.regroup = false; return; }
  const d = Math.hypot(L.x - e.x, L.y - e.y);
  if (!e.seeing && d > A.leash && !e.regroup) {
    e.regroup = true;
    e.peek = null; e.flank = null; e.doorFire = null; e.investigate = false; e.goal = null; e.searchT = 0;
    if (e.role) e.role = null;
  }
  if (e.regroup && d < A.near) e.regroup = false;
}

// Место в строю — позади-сбоку от ведущего; стойка как у ведущего; смотрит в свой сектор
function followLeader(e, dt) {
  const A = ENEMY.ally, L = leaderOf(e);
  e.burst = 0; e.fightT = 0;
  const g = e.gun;
  if (g.mag < WEAPONS[g.t].mag - 5 && !g.reloadT && g.pouch.some((n) => n > g.mag)) startReload(e);
  if (!L) { e.crouch = false; e.sprint = false; lookAround(e, dt, 1.5); return; }
  const mates = G.players.filter((q) => q.ai && !q.dead && leaderOf(q) === L).sort((a, b) => a.slot - b.slot);
  const k = Math.max(0, mates.indexOf(e)), n = Math.max(1, mates.length);
  const ang = L.a + Math.PI + (k - (n - 1) / 2) * A.spread;
  let gx = L.x + Math.cos(ang) * A.dist, gy = L.y + Math.sin(ang) * A.dist;
  if (solidAt(gx, gy)) { const f = freeSpotNear(gx, gy); gx = f.x; gy = f.y; }
  const dLead = Math.hypot(L.x - e.x, L.y - e.y), dGoal = Math.hypot(gx - e.x, gy - e.y);
  e.crouch = !!L.crouch && dGoal < M(1.5);
  if (dGoal > M(0.8)) {
    const step = fieldStep(e, fieldTo(gx, gy)) ?? Math.atan2(gy - e.y, gx - e.x);
    const far = dLead > A.runDist;
    e.sprint = far;
    e.crouch = false;
    moveDir(e, step, far ? ENEMY.speed.run : L.crouch ? SPEED.crouch : ENEMY.speed.walk, dt);
    if (far) { e.want = step; return; }
  } else e.sprint = false;
  // свой сектор: куда смотрит ведущий, со смещением в сторону (каждый бот — в свою)
  e.lookT -= dt;
  if (e.lookT <= 0) { e.look = L.a + (k % 2 ? 1 : -1) * rand(0.5, 1.3); e.lookT = rand(1.5, 3); }
  e.want = e.look;
}

// Раздвинуть людей, стоящих друг в друге
function separate(list, minD) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= minD || d < 0.01) continue;
    const push = (minD - d) / 2;
    moveCircle(a, (-dx / d) * push, (-dy / d) * push, PR);
    moveCircle(b, (dx / d) * push, (dy / d) * push, PR);
  }
}
