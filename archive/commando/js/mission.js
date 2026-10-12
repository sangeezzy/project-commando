'use strict';
// ---------- Сценарий миссии 1: цели, события, реплики (логика — у хоста) ----------

const CAM_RANGE = 270, CAM_HALF = 0.42;
const who = (ch) => `${CHARS[ch].letter} · ${CHARS[ch].role}`;

// Сколько врагов района осталось
const zoneLeft = (zone) => G.enemies.filter((e) => !e.dead && e.zone === zone && ETYPES[e.t].fac === 'sep' && !ETYPES[e.t].boss).length;

function inCave(p) { return darkAt(p.x, p.y) && zoneAt(p.x, p.y) === 'cave'; }

// ---------- Цели (у всех: считаются по флагам и миру) ----------
function objectives(p) {
  const m = G.m;
  const res = { main: '', sub: [], target: null, markers: [] };
  if (!m || !map || map.hub) return res;
  const rv = G.objs.find((o) => o.k === 'rv');
  if (G.stage === 1) {
    if (!m.rvAll) {
      if (p && inCave(p)) {
        res.main = 'Выберитесь из пещеры';
        res.target = markerPos('exit' + CHARS[p.ch].squad);
        res.sub.push('Завалы разбирайте вдвоём · F — фонарь');
      } else {
        res.main = 'Доберитесь до точки рандеву';
        res.target = rv && { x: rv.x, y: rv.y };
      }
      const other = p ? 1 - CHARS[p.ch].squad : 0;
      res.sub.push(p && radioAt(p.x, p.y) ? (m['sq' + other] ? 'Второй отряд снаружи, идёт к рандеву' : 'Второй отряд ещё в пещерах')
        : 'Связи со вторым отрядом нет');
      if (rv) res.markers.push({ x: rv.x, y: rv.y, label: 'РАНДЕВУ', color: '#3dff8a' });
    } else {
      res.main = 'По спидерам! (E у спидера)';
      const s = p && G.speeders.filter((q) => q.seats.includes(-1)).sort((a, b) => dist(a, p) - dist(b, p))[0];
      if (s && p && p.ride < 0) res.target = s;
      res.sub.push(`На спидерах: ${G.players.filter((q) => q.ride >= 0).length}/${G.players.length}`);
    }
    return res;
  }
  // этап 2
  const mk = (name, label, color) => { const q = markerPos(name); if (q) res.markers.push({ ...q, label, color }); };
  if (!m.met) {
    res.main = 'Доберитесь до лагеря клонов';
    res.target = markerPos('cloneCamp');
    mk('cloneCamp', 'КЛОНЫ', '#4da6ff');
    return res;
  }
  if (!m.outCleared) {
    res.main = `Зачистите окраины — осталось ${zoneLeft('out')}`;
    if (!m.ordered) res.sub.push('Удерживайте C — приказ клонам о штурме (по рации)');
    else res.sub.push(`Клоны штурмуют окраины (${G.allies.filter((a) => a.t === 'clone' && !a.tech && !a.dead).length})`);
    if (!m.scanned && !m.ordered) { res.sub.push('Обход: сканер тоннелей — в лагере на юго-востоке'); mk('techCamp', 'СКАНЕР', '#4da6ff'); }
    const hatch = objByName('hatch');
    if (m.scanned && hatch && !hatch.open) { res.markers.push({ x: hatch.x, y: hatch.y, label: 'ЛЮК', color: '#3dff8a' }); res.sub.push('Тоннель выведет к люку в южных окраинах'); }
    if (p && zoneAt(p.x, p.y) === 'tun' && hatch && !hatch.open) res.target = hatch;
    if (m.info && !m.stationOff) {
      const st = objByName('station');
      if (st) res.markers.push({ x: st.x, y: st.y, label: 'СТАНЦИЯ', color: '#ff3344' });
      res.sub.push('Отключите станцию наблюдения — камеры ослепнут');
    }
    if (m.art >= 0) res.sub.push(`Артефакт у ${who(pById(m.art) ? pById(m.art).ch : 0)}`);
    if (!m.alarm && !m.ordered) res.sub.push('Скрытно: камеры и долгая тревога поднимут весь район');
    if (m.camsAlarm) res.sub.push('Камеры засекли отряд — скрытность потеряна');
    return res;
  }
  if (!m.cenCleared) {
    res.main = `Захватите центральный район — осталось ${zoneLeft('cen')}`;
    if (p && zoneAt(p.x, p.y) !== 'cen') res.target = markerPos('innerGateIn');
    res.sub.push(m.centerAlert ? 'Центр поднят по тревоге' : 'Центр ни о чём не подозревает');
    return res;
  }
  if (m.boss <= 1) {
    res.main = m.boss === 1 ? 'Уничтожьте супер-B2: спереди броня, бейте в спину' : 'Объект связи захвачен…';
    if (m.boss === 1) res.sub.push(`Опытный образец разрядится через ${fmtTime(m.bossT)}`);
    return res;
  }
  res.main = 'Задание выполнено';
  res.sub.push(`Возвращение на корабль через ${Math.max(0, Math.ceil(m.endT))} с`);
  return res;
}

// ---------- События (хост) ----------
function completeHold(o, p) {
  const m = G.m;
  switch (o.k) {
    case 'gate':
      if (o.name === 'hatch') {
        openGate(o);
        m.hatchOpen = true;
        say(who(p.ch), 'Люк открыт. Выходим в южные окраины — тихо.', 4);
      }
      break;
    case 'console':
      o.done = true; m.stationOff = true;
      for (const c of G.objs) if (c.k === 'camera') { c.on = false; c.seen = 0; }
      emit(['obj', 'СТАНЦИЯ НАБЛЮДЕНИЯ ОТКЛЮЧЕНА']);
      say(who(p.ch), 'Станция отключена. Камеры ослепли.', 4);
      break;
    case 'table':
      o.done = true; m.patrolMap = true;
      emit(['obj', 'КАРТА ПАТРУЛЕЙ: МАРШРУТЫ НАНЕСЕНЫ']);
      say(who(p.ch), 'Карта патрулей окраин. Теперь видим их маршруты.', 4);
      break;
    case 'item':
      if (m.art !== -1) return;
      o.done = true; m.art = p.idx;
      emit(['pick', o.x, o.y]);
      say(who(p.ch), 'Что это? Старинная вещица… Местные за такое многое отдадут.', 5);
      break;
  }
}

function completeScan(o, p) {
  const m = G.m;
  if (m.scanned) return;
  o.done = true; m.scanned = true;
  openGate(objByName('tunnelIn'));
  emit(['obj', 'МАРШРУТ ПО ТОННЕЛЯМ ПОСТРОЕН']);
  say('ТЕХНИК-КЛОН', 'Маршрут построен: тоннель ведёт к люку в южных окраинах. Там живность — она боится света.', 6);
}

function giveArtifact(o, p) {
  const m = G.m;
  if (m.art !== p.idx || o.done) return;
  o.done = true; m.art = -2;
  if (o.role === 'glasses') {
    m.info = true;
    say('МЕСТНЫЙ В ОЧКАХ', 'Станция наблюдения — на востоке окраин, у стены центра. Пока она работает, камеры видят всё.', 6);
    emit(['obj', 'СТАНЦИЯ НАБЛЮДЕНИЯ ОТМЕЧЕНА']);
  } else {
    m.bribed = true; m.centerAlert = true;
    spawnMercs();
    // половина врагов окраин уходит в центр на перестрелку
    const pool = shuffle(G.enemies.filter((e) => !e.dead && e.zone === 'out' && ETYPES[e.t].fac === 'sep' && e.st < 2));
    pool.slice(0, Math.round(pool.length / 2)).forEach((e) => { e.leave = true; e.st = 1; e.patrol = null; e.goal = null; });
    say('НАЁМНИК С БЛАСТЕРОМ', 'Договорились. Скоро в центре будет жарко!', 5);
    emit(['obj', 'НАЁМНИКИ ОТВЛЕКАЮТ ВРАГА В ЦЕНТРЕ']);
  }
}

function orderClones(p, inPerson) {
  const m = G.m;
  if (!m || m.ordered || !m.met) return;
  m.ordered = true; m.centerAlert = true;
  for (const a of G.allies) if (a.t === 'clone' && !a.tech) a.mode = m.outCleared ? 'follow' : 'assault';
  say(who(p.ch), inPerson ? 'Капитан, начинайте штурм!' : '«Омега» — капитану: начинайте штурм!', 3);
  say('КАПИТАН ТРАКС', 'Принято! Клоны, вперёд! За Республику!', 4);
  emit(['obj', 'КЛОНЫ ИДУТ НА ШТУРМ']);
}

// ---------- Объекты (хост) ----------
function updateObjects(dt) {
  const m = G.m;
  for (const o of G.objs) {
    if (o.k === 'debris') updateDebris(o, dt);
    else if (o.k === 'camera') updateCamera(o, dt, m);
  }
  updateHolds(dt);
}

function updateCamera(o, dt, m) {
  o.ang = o.a0 + Math.sin(G.time * 0.7 + o.id) * o.sweep;
  if (!o.on || !m || m.stationOff) { o.seen = 0; return; }
  let sees = false;
  for (const p of G.players) {
    if (p.down) continue;
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d > CAM_RANGE) continue;
    if (Math.abs(angDiff(Math.atan2(p.y - o.y, p.x - o.x), o.ang)) > CAM_HALF) continue;
    if (los(o.x, o.y, p.x, p.y)) { sees = true; break; }
  }
  if (sees) {
    o.seen += dt * 1.6;
    if (o.seen >= 1 && !o.tripped) {
      o.tripped = true;
      m.camsAlarm = true;
      emit(['cam', o.x, o.y]);
      say('ПЕРЕХВАТ', `Камера «${o.label || 'сектор ' + o.id}» засекла отряд!`, 4);
      raiseAlarm(o.label === 'вход в центр' ? 'cen' : 'out', o.x, o.y);
    }
  } else { o.seen = Math.max(0, o.seen - dt * 0.6); if (o.seen === 0) o.tripped = false; }
}

// ---------- Ход миссии (хост) ----------
function updateMission(dt) {
  const m = G.m;
  if (!m || map.hub) return;
  if (G.stage === 1) updateCavesStage(m, dt);
  else updateTownStage(m, dt);
}

function updateCavesStage(m, dt) {
  // отряд выбрался из пещеры — появилась связь
  for (const sq of [0, 1]) {
    if (m['sq' + sq]) continue;
    const out = G.players.find((p) => CHARS[p.ch].squad === sq && !p.down && zoneAt(p.x, p.y) === 'valley');
    if (out) {
      m['sq' + sq] = true;
      const other = m['sq' + (1 - sq)];
      say(who(out.ch), other ? '«Омега» на связи! Мы тоже снаружи, идём к костру.' : 'Говорит «Омега»: мы снаружи! Второй отряд, ответьте… Тишина. Идём к точке рандеву.', 5);
    }
  }
  const rv = G.objs.find((o) => o.k === 'rv');
  if (!m.rvAll) {
    const all = G.players.length && G.players.every((p) => !p.down && Math.hypot(p.x - rv.x, p.y - rv.y) < rv.r * TILE);
    if (all) {
      m.rvAll = true;
      checkpointHere('rv');
      say(who(0), 'Все в сборе. Спидеры в кустах — по машинам, клоны ждут подкрепления.', 5);
    }
    return;
  }
  if (G.players.every((p) => p.ride >= 0)) {
    m.rideT += dt;
    G.fadeT = m.rideT;
    if (m.rideT >= 1.6) {
      m.rideT = 0;
      startStage(G.lv, 2, 'start');
      say(who(0), 'Держим курс на лагерь клонов — на восток, вдоль скал.', 5);
      emit(['obj', 'В ПУТИ К ЛАГЕРЮ КЛОНОВ']);
    }
  } else m.rideT = 0;
}

function updateTownStage(m, dt) {
  const camp = markerPos('cloneCamp');
  if (!m.met && G.players.some((p) => !p.down && Math.hypot(p.x - camp.x, p.y - camp.y) < 230)) {
    m.met = true;
    say('КАПИТАН ТРАКС', 'Коммандос! Вовремя. Поселение держат дроиды и жуки, главные силы — у ворот.', 6);
    say('КАПИТАН ТРАКС', 'Ударим в лоб — дайте команду по рации (C). Или зайдите в тыл через тоннели: сканер у техников на юго-востоке.', 8);
    emit(['obj', 'ЗАЧИСТИТЕ ОКРАИНЫ — В ЛОБ ИЛИ В ОБХОД']);
  }
  if (!m.tunSaid && G.players.some((p) => zoneAt(p.x, p.y) === 'tun' && darkAt(p.x, p.y))) {
    m.tunSaid = true;
    const p = G.players.find((q) => zoneAt(q.x, q.y) === 'tun');
    say(who(p.ch), 'Связи нет. Фонари не гасить — твари боятся света, а стаей нападают, только если их больше.', 6);
  }
  if (!m.outCleared && zoneLeft('out') === 0) {
    m.outCleared = true; m.cenOpen = true;
    openGate(objByName('innerGate'));
    for (const a of G.allies) if (a.t === 'clone' && !a.tech && a.mode !== 'hold') a.mode = 'follow';
    if (m.centerAlert) {
      alertCenter();
      say(who(0), 'Окраины чисты, ворота центра открыты. Центр знает о штурме — будет жарко.', 6);
    } else say(who(1), 'Окраины чисты. Ворота центра открыты… и там нас не ждут. Тихо работаем.', 6);
    emit(['obj', 'ДВИГАЙТЕСЬ В ЦЕНТРАЛЬНЫЙ РАЙОН']);
    checkpointHere('center');
  }
  if (m.outCleared && !m.cenCleared && zoneLeft('cen') === 0) {
    m.cenCleared = true; m.bossDelay = 4;
    say(who(3), 'Объект связи наш… Стоп. Слышите? В контейнере что-то шевелится.', 4);
  }
  if (m.cenCleared && m.boss === 0) {
    m.bossDelay -= dt;
    if (m.bossDelay <= 0) {
      spawnBoss();
      emit(['boom', objByKind('container').x, objByKind('container').y]);
      say('СУПЕР-B2', 'ЭКСПЕРИМЕНТАЛЬНЫЙ ОБРАЗЕЦ АКТИВИРОВАН. ЦЕЛИ ОБНАРУЖЕНЫ.', 4);
      say(who(0), 'Спереди он непробиваем! Обходите и бейте в спину!', 5);
      checkpointHere('boss');
    }
  }
  if (m.boss === 1) {
    const b = G.enemies.find((e) => ETYPES[e.t].boss);
    m.bossT -= dt;
    if (b && b.dead) {
      m.boss = 2; m.result = 'destroyed'; m.endT = 14;
      say('КОМАНДОВАНИЕ', 'Отличная работа, «Омега». Останки дроида заберут наши инженеры.', 6);
      say('КОМАНДОВАНИЕ', 'Республика благодарит вас. Возвращайтесь на корабль.', 6);
    } else if (m.bossT <= 0) {
      m.boss = 3; m.result = 'shutdown'; m.endT = 14;
      if (b) { b.off = true; emit(['jam', b.x, b.y]); }
      say(who(3), 'Он… выключился? Батарея села — опытный образец!', 4);
      say('КОМАНДОВАНИЕ', 'Целый экземпляр! Инженеры будут счастливы. Республика благодарит вас, «Омега». Возвращайтесь на корабль.', 7);
    }
  }
  if (m.boss >= 2) {
    m.endT -= dt;
    if (m.endT <= 0) returnToHub(true, m.result === 'destroyed' ? 'Супер-B2 уничтожен' : 'Супер-B2 захвачен целым');
  }
}

const objByKind = (k) => G.objs.find((o) => o.k === k);
