'use strict';
// ---------- Интерфейс ----------

const FONT = "'Russo One', Consolas, sans-serif";
const HUD_COL = '#e8e4d8', HUD_DIM = '#a09c90', HUD_WARN = '#ffb030', HUD_RED = '#ff5040';

function txt(text, x, y, size, color = HUD_COL, align = 'left', font = FONT) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
const mono = (text, x, y, color = HUD_DIM, align = 'left', size = 12) => txt(text, x, y, size, color, align, 'Consolas, monospace');

function box(x, y, w, h, a = 0.55) {
  ctx.fillStyle = `rgba(15,16,17,${a})`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(232,228,216,0.18)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawHUD() {
  const p = me();
  if (!p) return;
  drawHurt();
  if (p.down && !p.dead) {
    drawDownedHud(p);
  } else if (!p.dead) {
    drawHealth(p);
    drawWeapon(p);
    drawCrosshair(p);
    drawRevivePrompt(p);
  } else if (G.state === 'play') {
    const v = viewer();
    txt('ВЫ ПОГИБЛИ', VW / 2, 60, 24, HUD_RED, 'center');
    if (v && v !== p) mono(`наблюдение: ${v.name}`, VW / 2, 82, HUD_DIM, 'center', 13);
  }
  drawOffscreen(viewer());
  drawTeam();
  drawVoice(p);
  // задача
  const left = alive(G.enemies).length;
  box(14, 14, 330, 52);
  txt(map.name || 'ПОЛИГОН', 26, 36, 15);
  if (G.surv) drawSurvHud(p);
  else if (G.mapId === 'hub') mono('стол (F) — оружие · проход — на карту (хост стоит 2 с)', 26, 56, HUD_DIM);
  else if (!G.enemies.length) mono('противников нет — пристрелка' + (isAuth() ? ' · Backspace — в хаб' : ''), 26, 56, HUD_DIM);
  else mono(`противников осталось: ${left} из ${G.enemies.length}` + (isAuth() && G.mapId !== 'range' ? ' · Backspace — в хаб' : ''), 26, 56, left ? HUD_DIM : '#9fe870');
  if (G.mapId === 'hub' && tableNear(p) && !p.dead && !loadoutOpen()) txt('F — оружейный стол', VW / 2, VH - 120, 15, HUD_WARN, 'center');
  if (!TouchUI.on) mono('TAB — характеристики оружия · 1, 2, 3 — оружие · X — нож · H — управление', 14, 84, 'rgba(232,228,216,0.45)', 'left', 11);
  if (p.keys && p.keys.size) {
    const names = [...p.keys].map((id) => keyName(id));
    mono('Ключи: ' + names.join(', '), 14, 102, '#d8c890', 'left', 12);
  }
  if (!p.dead && G.state === 'play') drawDoorPrompt(p);
  if (!p.dead && !p.down && G.state === 'play') drawVehPrompt(p);
  if (!p.dead && !p.down && G.state === 'play') {
    // станковый пулемёт: рядом — занять, за ним — оставить
    const m = mgNear(p);
    if (m) mono(p.mg ? `ПУЛЕМЁТ ${WEAPONS[m.t].name} · сектор ±${Math.round(m.arc * 180 / Math.PI)}° · F — оставить` : `F — занять пулемёт ${WEAPONS[m.t].name}`,
      VW / 2, VH - 100, HUD_WARN, 'center', 13);
  }
  if (keys.KeyH) drawControls();
  if (keys.Tab || keys.KeyI) drawSpecs();
  if (G.toast) txt(G.toast.text, VW / 2, VH - 150, 16, HUD_WARN, 'center');
  if (G.radioMsg) {
    ctx.globalAlpha = Math.min(1, G.radioMsg.t);
    box(VW / 2 - 300, VH - 260, 600, 26, 0.6);
    mono('РАЦИЯ: «' + G.radioMsg.text + '»', VW / 2, VH - 242, '#e8c060', 'center', 13);
    ctx.globalAlpha = 1;
  }
  if (G.banner) {
    ctx.globalAlpha = Math.min(1, G.banner.t);
    txt(G.banner.text, VW / 2, VH * 0.2, 26, '#f0d890', 'center');
    if (G.banner.sub) mono(G.banner.sub, VW / 2, VH * 0.2 + 24, HUD_COL, 'center', 13);
    ctx.globalAlpha = 1;
  }
  // реплики (слышно): противников и своих ботов
  if (G.barks) {
    // над видимым противником реплика уже написана (drawBarksOver) — внизу только остальные слышимые, последние три
    const low = G.barks.filter((b) => !b.over).slice(-3);
    low.forEach((b, i) => { ctx.globalAlpha = Math.min(1, b.t); mono(`${b.foe ? 'Противник' : 'Свой'}: «${b.text}»`, VW / 2, VH - 200 - (low.length - 1 - i) * 18, b.foe ? '#e8a080' : '#a0c8e8', 'center', 13); ctx.globalAlpha = 1; });
  }
  if (G.state === 'dead' || G.state === 'win') drawEnd();
  else if (G.runResult && G.mapId === 'hub') drawRunResult(G.runResult);
}

// Итоги забега: в хабе после возвращения («покинуть боевую зону» — успех, Backspace или гибель отряда — поражение)
function runLines(r, assault) {
  return [assault ? `зачищено локаций: ${r.cleared}` : `пережито волн: ${r.cleared}`, `убито противников: ${r.kills}`, `потери отряда: ${r.losses}`];
}
function drawRunResult(r) {
  ctx.globalAlpha = Math.min(1, r.t);
  const x = VW / 2, y = 70;
  box(x - 190, y - 34, 380, 128, 0.7);
  txt(r.win ? 'ЗАБЕГ ЗАВЕРШЁН — ЭВАКУАЦИЯ' : 'ЗАБЕГ ПРОВАЛЕН', x, y - 6, 20, r.win ? '#9fe870' : HUD_RED, 'center');
  mono(r.assault ? '«Штурм»' : '«Выживание»', x, y + 14, HUD_COL, 'center', 12);
  runLines(r, r.assault).forEach((l, i) => mono(l, x, y + 38 + i * 18, '#f0d890', 'center', 14));
  ctx.globalAlpha = 1;
}

function drawHealth(p) {
  const x = TouchUI.on ? Math.round(VW / 2 - 112) : 20, y = TouchUI.on ? 36 : VH - 66;   // телефон: вверху посередине
  box(x - 6, y - 22, 236, 64);
  txt(`${Math.ceil(p.hp)}`, x + 4, y + 18, 28, p.hp < 35 ? HUD_RED : HUD_COL);
  const k = p.hp / HP;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 64, y + 2, 150, 8);
  ctx.fillStyle = p.hp < 35 ? HUD_RED : '#c8c4b0'; ctx.fillRect(x + 64, y + 2, 150 * k, 8);
  mono('ЗДОРОВЬЕ', x + 64, y - 6);
  // броня: полоска прочности под здоровьем, класс справа; разбита — красным
  if (p.armor) {
    const ak = clamp(p.armor.hp / 100, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 64, y + 13, 150, 5);
    ctx.fillStyle = '#8fb4d8'; ctx.fillRect(x + 64, y + 13, 150 * ak, 5);
    const slow = Math.round((1 - armorSpeedK(p)) * 100);
    mono(`БРОНЯ ${p.armor.cls}` + (ak <= 0 ? ' — РАЗБИТА' : slow ? ` −${slow}%` : ''), x + 214, y - 6, ak <= 0 ? HUD_RED : '#8fb4d8', 'right', 11);
  }
  const stance = p.sprint ? 'БЕГ' : p.crouch ? 'ПРИСЕД' : 'СТОЯ';
  const lean = p.lean < -0.3 ? ' · ВЫГЛЯДЫВАЕТ ВЛЕВО' : p.lean > 0.3 ? ' · ВЫГЛЯДЫВАЕТ ВПРАВО' : '';
  mono(stance + lean + (p.ads > 0.5 ? ' · ПРИЦЕЛ' : '') + (p.lamp ? ' · ФОНАРЬ' : ''), x + 64, y + 28, HUD_COL);
  // отладка — над рамкой здоровья, чтобы не забыть, что включено
  const dbg = [p.god && 'БЕССМЕРТИЕ [', G.noFog && 'БЕЗ ТУМАНА ]'].filter(Boolean);
  if (dbg.length) mono('ОТЛАДКА: ' + dbg.join(' · '), x - 6, y - 30, HUD_WARN, 'left', 11);
  if (p.supp > 0.3) {
    // подавление: края экрана темнеют
    const a = (p.supp - 0.3) * 0.5;
    const gr = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.3, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${a})`);
    ctx.fillStyle = gr; ctx.fillRect(0, 0, VW, VH);
  }
}

function drawWeapon(p) {
  const g = p.gun, W = WEAPONS[g.t];
  const x = VW - 270, y = TouchUI.on ? 58 : VH - 96;     // телефон: вверху справа (внизу — стики)
  box(x, y, 256, 84);
  txt(W.name, x + 12, y + 22, 16);
  mono(W.cal, x + 12, y + 38, HUD_DIM, 'left', 11);
  txt(g.mode === 'auto' ? 'АВТО' : g.mode === 'pump' ? 'ПОМПА' : 'ОДИН.', x + 244, y + 22, 13, HUD_WARN, 'right');
  drawSlots(p, x, y - 30);
  // патроны: в магазине + в патроннике
  const low = g.mag + g.chamber <= 5;
  txt(String(g.mag), x + 12, y + 72, 28, g.mag === 0 ? HUD_RED : low ? HUD_WARN : HUD_COL);
  ctx.font = `28px ${FONT}`;
  const mw = ctx.measureText(String(g.mag)).width;
  txt(g.chamber ? '+1' : '+0', x + 16 + mw, y + 72, 14, g.chamber ? HUD_DIM : HUD_RED);
  // ружьё: патроны россыпью — числом
  if (W.cls === 'shotgun') {
    txt(String(g.pouch[0]), x + 244, y + 72, 22, g.pouch[0] ? HUD_COL : HUD_RED, 'right');
    mono('в запасе', x + 244 - 40, y + 50, HUD_DIM, 'right', 11);
  } else for (let i = 0; i < g.pouch.length; i++) {
    // запасные магазины: полоски по наполненности
    const bx = x + 110 + i * 18, by = y + 48, h = 26, k = g.pouch[i] / W.mag;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, by, 11, h);
    ctx.fillStyle = k > 0.99 ? '#c8c4b0' : HUD_WARN; ctx.fillRect(bx, by + h * (1 - k), 11, h * k);
  }
  if (!g.pouch.length) mono('нет магазинов', x + 110, y + 66, HUD_RED);
  if (g.reloadT > 0) {
    const k = 1 - g.reloadT / g.reloadDur;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y - 10, 256, 4);
    ctx.fillStyle = HUD_WARN; ctx.fillRect(x, y - 10, 256 * k, 4);
    mono(W.cls === 'shotgun' ? 'ЗАРЯЖАЕТ ПО ПАТРОНУ (ОГОНЬ — ПРЕРВАТЬ)' : W.belt ? 'СМЕНА КОРОБА С ЛЕНТОЙ' : g.quick ? 'БЫСТРАЯ ПЕРЕЗАРЯДКА — МАГАЗИН СБРОШЕН' : g.reloadEmpty ? 'ПЕРЕЗАРЯДКА (ЗАТВОР НА ЗАДЕРЖКЕ) · RR — быстрая' : 'ПЕРЕЗАРЯДКА · RR — быстрая', x, y - 16, HUD_WARN, 'left', 11);
  } else if (p.sw) {
    const k = clamp(p.sw.t / p.sw.dur, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y - 10, 256, 4);
    ctx.fillStyle = HUD_COL; ctx.fillRect(x, y - 10, 256 * k, 4);
    mono('СМЕНА ОРУЖИЯ: ' + WEAPONS[p.kit[p.sw.to].t].name, x, y - 16, HUD_COL, 'left', 11);
  } else if (!g.chamber && !g.mag) mono(canReload(g) ? 'ПУСТО — R' : 'ПАТРОНОВ НЕТ — СМЕНИТЕ ОРУЖИЕ (1, 2, 3)', x, y - 10, HUD_RED, 'left', 12);
}

// Слоты снаряжения над панелью оружия: 1, 2 — полноразмерные, 3 — пистолет; в руках — подсвечен, патронов всего
// «Выживание»: волна и что сейчас (волна — сколько осталось, перерыв — сколько ждать, грузовик — что делать), погода; подсказки у грузовика
function drawSurvHud(p) {
  const s = G.surv;
  const line = s.mode === 'assault'
    ? (s.phase === 'fight' ? `противников осталось: ${G.enemies.filter((e) => !e.dead).length}`
      : s.phase === 'exit' ? 'локация зачищена — переход открыт (хост стоит в нём 2 с)'
      : `ГРУЗОВИК · броня ${ARMOR_ORDER[Math.min(s.trucks, 4)]} · пополнение — задний борт (F), лечение — медик`)
    : s.phase === 'wave' ? `ВОЛНА ${s.wave} · противников осталось: ${survLeft()}`
    : s.phase === 'break' ? `перерыв · волна ${s.wave + 1} через ${Math.ceil(Math.max(0, s.t))} с`
    : `ГРУЗОВИК · броня ${ARMOR_ORDER[Math.min(s.trucks, 4)]} · пополнение — задний борт (F), лечение — медик`;
  mono(line, 26, 56, s.phase === 'wave' ? HUD_DIM : '#f0d890');
  if (G.weather) mono(`погода: ${WEATHER[G.weather.kind].name}` + (isAuth() ? ' · Backspace — в хаб' : ''), 14, 102, '#a8c0d8', 'left', 11);
  if (p.dead || uiOpen()) return;
  if (nearRear(p)) txt('F — грузовик: пополнить или покинуть боевую зону', VW / 2, VH - 120, 15, HUD_WARN, 'center');
  else if (nearMedic(p)) txt(p.hp < HP ? (s.medic.heal && s.medic.heal !== p.id ? 'медик занят — подождите' : 'F — лечиться у медика') : 'здоровье полное', VW / 2, VH - 120, 15, HUD_WARN, 'center');
  if (p.act && (p.act.kind === 'supply' || p.act.kind === 'heal')) {
    const k = clamp(p.act.t / p.act.dur, 0, 1), x = VW / 2 - 120, y = VH - 100;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y, 240, 6);
    ctx.fillStyle = HUD_WARN; ctx.fillRect(x, y, 240 * k, 6);
    mono(p.act.kind === 'supply' ? 'ПОПОЛНЕНИЕ…' : 'ЛЕЧЕНИЕ…', VW / 2, y - 6, HUD_WARN, 'center', 12);
  }
}

function drawSlots(p, x, y) {
  if (!p.kit) return;
  for (let i = 0; i < 3; i++) {
    const k = p.kit[i], bx = x + i * 86, cur = i === p.cur, next = p.sw && p.sw.to === i;
    box(bx, y - 14, 82, 20, cur ? 0.75 : 0.45);
    if (cur) { ctx.fillStyle = HUD_WARN; ctx.fillRect(bx, y + 4, 82, 2); }
    mono(String(i + 1), bx + 6, y, cur || next ? HUD_WARN : HUD_DIM, 'left', 11);
    if (!k) { mono('—', bx + 18, y, HUD_DIM, 'left', 11); continue; }
    mono(WEAPONS[k.t].short + (i === p.off ? '·Л' : ''), bx + 18, y, cur ? HUD_COL : HUD_DIM, 'left', 10);   // ·Л — в левой руке
    mono(String(ammoTotal(k)), bx + 78, y, ammoTotal(k) ? HUD_DIM : HUD_RED, 'right', 10);
  }
}

// Перекрестие: зазор = реальный разброс (2σ) на дистанции до курсора
function drawCrosshair(p) {
  const w = screenToWorld(mouse.x, mouse.y);
  const d = Math.max(M(2), Math.hypot(w.x - p.x, w.y - p.y));
  const canFire = canShoot(p);
  const gap = clamp(2 * playerSpread(p) * MRAD * d * G.zoom, 3, 200);
  const x = mouse.x, y = mouse.y;
  ctx.strokeStyle = canFire ? 'rgba(240,240,230,0.9)' : 'rgba(240,240,230,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - gap - 7, y); ctx.lineTo(x - gap, y);
  ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + 7, y);
  ctx.moveTo(x, y - gap - 7); ctx.lineTo(x, y - gap);
  ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + 7);
  ctx.stroke();
  ctx.fillStyle = 'rgba(240,240,230,0.9)';
  ctx.fillRect(x - 1, y - 1, 2, 2);
  if (G.hitmark) {
    ctx.strokeStyle = G.hitmark.kill ? HUD_RED : G.hitmark.armor ? '#8fb4d8' : '#fff';     // по броне (удержала) — голубая
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.moveTo(x + sx * 5, y + sy * 5); ctx.lineTo(x + sx * 11, y + sy * 11); }
    ctx.stroke();
  }
}

// Откуда прилетело: красные дуги вокруг центра
function drawHurt() {
  const p = me();
  if (!p) return;
  const { x: cx, y: cy } = worldToScreen(p.x, p.y, CAMM), r = G.camRot || 0;
  for (const h of G.hurt) {
    ctx.strokeStyle = `rgba(255,60,40,${Math.min(1, h.t) * 0.8})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, 70, h.a + r - 0.3, h.a + r + 0.3); ctx.stroke();
  }
  if (p.hurtT < 0.25) { ctx.fillStyle = `rgba(160,0,0,${(0.25 - p.hurtT) * 1.2})`; ctx.fillRect(0, 0, VW, VH); }
}

// Противники в поле зрения, но за краем экрана (обзор дальше экрана: туман войны открыт до VIS_BASE): маленькая красная стрелка у края
// в их сторону и расстояние. Видимость — как на экране (playerSees + различим по свету), проверяется раз в OFFSCREEN.dt с.
const OFFSCREEN = { dt: 0.12, pad: 26, size: 8 };
function offscreenContacts(v) {
  const out = [];
  if (!v || !G.enemies.length) return out;
  const m = CAMM || camMatrix(), M0 = OFFSCREEN.pad;
  for (const e of G.enemies) {
    if (e.dead) { e.offSeen = false; continue; }
    const s = worldToScreen(e.x, e.y, m);
    if (s.x > -4 && s.x < VW + 4 && s.y > -4 && s.y < VH + 4) { e.offSeen = false; continue; }   // на экране — видно и так
    if (!(G.time < (e.offT || 0))) {
      e.offT = G.time + OFFSCREEN.dt * (0.8 + 0.4 * Math.random());
      e.offSeen = G.noFog || (!v.dead && playerSees(v, e) && perceivedAt(e.x, e.y) > LIGHT.seeMin);
    }
    if (!e.offSeen) continue;
    // точка на краю экрана (с отступом) по лучу от центра к противнику
    const cx = VW / 2, cy = VH / 2, dx = s.x - cx, dy = s.y - cy;
    const k = Math.min(dx ? (VW / 2 - M0) / Math.abs(dx) : 1e9, dy ? (VH / 2 - M0) / Math.abs(dy) : 1e9);
    out.push({ e, x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx), d: Math.hypot(e.x - v.x, e.y - v.y) / PX_M });
  }
  return out;
}
function drawOffscreen(v) {
  const list = offscreenContacts(v);
  if (!list.length) return;
  const S = OFFSCREEN.size;
  ctx.save();
  ctx.font = '10px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const q of list) {
    ctx.save();
    ctx.translate(q.x, q.y); ctx.rotate(q.a);
    ctx.fillStyle = 'rgba(255,70,55,0.9)'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(S, 0); ctx.lineTo(-S * 0.7, -S * 0.75); ctx.lineTo(-S * 0.35, 0); ctx.lineTo(-S * 0.7, S * 0.75); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,120,100,0.85)';
    ctx.fillText(`${Math.round(q.d)} м`, q.x - Math.cos(q.a) * 17, q.y - Math.sin(q.a) * 15);
  }
  ctx.restore();
}

// Машина: рядом — сесть; в машине — скорость, двигатель, клавиши (водитель / пассажир)
function drawVehPrompt(p) {
  const c = vehNear(p);
  if (!c) return;
  const V = VEHICLES[c.model];
  if (!p.veh) {
    const free = c.seats.filter((s) => !s).length;
    mono(`F — сесть: ${V.name}, ${DRIVE_NAMES[V.drive]}, резина ${TIRES[tiresOf(c)].name} (свободно мест: ${free} из ${c.seats.length})${c.seats[0] ? '' : ' · за руль'}`, VW / 2, VH - 100, HUD_WARN, 'center', 13);
    return;
  }
  const kmh = Math.round(carSpeed(c) / PX_M * 3.6), eng = c.hp / V.engineHp;
  const x = VW / 2, y = VH - 64;
  box(x - 230, y - 30, 460, 44, 0.6);
  txt(`${kmh} км/ч`, x - 210, y, 22, HUD_COL);
  mono((p.seat === 0 ? 'ЗА РУЛЁМ' : `ПАССАЖИР · место ${p.seat + 1}`) + ` · ${V.name.toLowerCase()}, ${DRIVE_NAMES[V.drive]}, резина ${TIRES[tiresOf(c)].name}`, x + 210, y - 14, HUD_DIM, 'right', 11);
  const nfl = [0, 1, 2, 3].filter((i) => (c.flats || 0) & (1 << i)).length;
  mono((c.hp <= 0 ? 'ДВИГАТЕЛЬ ЗАГЛОХ' : `двигатель ${Math.round(eng * 100)}%`) + (nfl ? ` · пробито колёс: ${nfl}` : ''), x + 210, y + 2,
    c.hp <= 0 ? HUD_RED : nfl || eng < 0.35 ? HUD_WARN : HUD_DIM, 'right', 11);
  if (!TouchUI.on) mono(p.seat === 0 ? 'W/S — газ/тормоз · A/D — руль · Space — ручник · C — камера · F — выйти · стреляет только пистолет'
    : 'C — камера · F — выйти · стрелять — из любого оружия', x, y + 30, 'rgba(232,228,216,0.55)', 'center', 11);
}

// Подсказка у двери и полоса действия (отпирание)
function drawDoorPrompt(p) {
  const d = doorNear(p);
  const x = VW / 2, y = VH - 120;
  if (p.act && p.act.kind === 'unlock') {
    const k = p.act.t / p.act.dur;
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x - 90, y + 8, 180, 5);
    ctx.fillStyle = HUD_WARN; ctx.fillRect(x - 90, y + 8, 180 * k, 5);
    mono('ОТПИРАЮ', x, y, HUD_WARN, 'center', 13);
    return;
  }
  if (!d) return;
  const pr = doorPrompt(p, d);
  mono(pr.title, x, y - 18, HUD_COL, 'center', 13);
  pr.lines.forEach((l, i) => mono(l, x, y + i * 16, l.startsWith('Заперто') || l.startsWith('выбить нельзя') ? HUD_RED : HUD_WARN, 'center', 12));
}

function drawSpecs() {
  const p = me(), W = WEAPONS[p && p.gun ? p.gun.t : 'm4a1'];
  const n = (v) => String(v).replace('.', ',');
  const rows = [
    ['Патрон', W.cal], ['Ствол', W.barrel], ['Масса', W.weight], ['Автоматика', W.action],
    ['Темп стрельбы', W.cls === 'shotgun' ? `≈${W.rpm} выстр/мин (цевьё ≈${n((60 / W.rpm).toFixed(2))} с)` : `${W.rpm} выстр/мин (${Math.round(60000 / W.rpm)} мс)`],
    ['Режимы', W.modes.length > 1 ? (W.modes[0] === 'semi' ? 'одиночный (основной), автоматический (V)' : 'одиночный, автоматический (V)')
      : W.cls === 'shotgun' ? 'помповый: каждый выстрел — новое нажатие' : W.modes[0] === 'auto' ? 'только автоматический' : 'одиночный'],
    W.cls === 'shotgun' ? ['Магазин', `подствольный на ${W.mag} (+1), с собой ${W.shells} россыпью`]
      : W.belt ? ['Питание', `лента в коробе на ${W.mag}, с собой ${W.mags} короба (${W.mag * W.mags})`]
        : ['Магазин', `${W.mag} патронов, с собой ${W.mags} шт. (${W.mag * W.mags})`],
    ['Начальная скорость', `${W.v0} м/с`], ['Эффективная дальность', `${W.effRange} м`],
    W.cls === 'shotgun' ? ['Заряжание', `по патрону ${n(W.shellT)} с, пустое — первый в патронник ${n(W.shellFirst)} с`]
      : W.belt ? ['Перезарядка', `смена короба и ленты ${n(W.reloadTac)} с, пустой ${n(W.reloadEmpty)} с; быстрой нет`]
        : ['Перезарядка', `${n(W.reloadTac)} с, с задержки затвора ${n(W.reloadEmpty)} с`],
    W.pellets ? ['Осыпь', `${W.pellets} дробин, σ ${W.pelletSpread} мрад (≈${n((W.pelletSpread * 2 * 40 / 1000).toFixed(1))} м на 40 м)`]
      : ['Кучность', `≈${n(W.mech)} мрад (≈${n((W.mech * 3.44).toFixed(1))} MOA)`],
    ['Разброс стрелка', `прицел ${n(W.aimStill)} мрад, присев ${n(W.aimCrouch)}, от бедра ${n(W.hip)}`],
    ['Урон', W.pellets ? `${W.dmg[0]}–${W.dmg[1]} за дробину из ${HP} (в упор — смертельно)`
      : `${W.dmg[0]}–${W.dmg[1]} из ${HP}; ${Math.round(W.vital * 100)}% — смертельное`],
    ['Пробитие укрытий', W.penExp <= 0.75 ? 'сильное (лучше всех)' : W.penExp < 1 ? 'лучше 5,56' : W.penExp > 1.5 ? 'слабое' : W.penExp > 1.1 ? 'ниже 5,56' : 'как у 5,56'],
    ['Нож (X)', `до ${n(KNIFE.range / PX_M)} м, ${KNIFE.dmg[0]}–${KNIFE.dmg[1]}, ${Math.round(KNIFE.vital * 100)}% — смертельно`],
  ];
  const w = 520, h = 60 + rows.length * 22, x = (VW - w) / 2, y = (VH - h) / 2;
  box(x, y, w, h, 0.88);
  txt(W.full, x + 20, y + 34, 20);
  rows.forEach(([k, v], i) => { mono(k, x + 20, y + 64 + i * 22); mono(v, x + 200, y + 64 + i * 22, HUD_COL); });
}

function drawControls() {
  const rows = [
    ['WASD', 'движение'], ['Мышь', 'направление взгляда и прицел'], ['ЛКМ', 'огонь'],
    ['ПКМ (держать)', 'прицелиться: точнее, медленнее'], ['R', 'перезарядка; R дважды — быстрая (магазин сбросить, −30% времени)'], ['V', 'режим огня'], ['Q / E (держать)', 'выглянуть влево / вправо из-за укрытия'], ['F', 'взаимодействие: дверь открыть / закрыть / отпереть'], ['G', 'выбить дверь ногой (громко)'], ['F (держать)', 'рядом с раненым товарищем — поднять'], ['B (держать)', 'рация (в помещении связи нет)'], ['M', 'микрофон вкл/выкл'], ['L', 'фонарь на оружии (в темноте выдаёт вас)'],
    ['C', 'присесть / встать (за низким укрытием — спрятаться)'], ['Shift', 'бег (не стреляет, громко)'],
    ['1 / 2 / 3', 'полноразмерное 1, 2 / пистолет (быстро; полноразмерное — в левой руке)'], ['X', 'удар ножом'],
    ['Колёсико мыши', 'приблизить / отдалить камеру'],
    ['Enter', 'заново (в сети — у хоста)'], ['Esc', 'выйти в меню'],
    ['[  /  ]', 'отладка: бессмертие / без тумана войны (только у себя)'],
  ];
  const w = 520, h = 50 + rows.length * 22, x = (VW - w) / 2, y = (VH - h) / 2;
  box(x, y, w, h, 0.88);
  txt('Управление', x + 20, y + 32, 18);
  rows.forEach(([k, v], i) => { mono(k, x + 20, y + 58 + i * 22, HUD_WARN); mono(v, x + 160, y + 58 + i * 22, HUD_COL); });
}

function drawEnd() {
  const win = G.state === 'win';
  ctx.fillStyle = `rgba(0,0,0,${Math.min(0.55, G.stateT * 0.5)})`;
  ctx.fillRect(0, 0, VW, VH);
  if (G.stateT < 0.6) return;
  const solo = G.players.filter((q) => !q.ai).length < 2;
  if (G.surv) {
    // забег («Выживание», «Штурм»): отряд погиб — итоги, через RUN_DEAD_T с — в хаб
    const s = G.surv, r = G.run || { cleared: 0, kills: 0, losses: 0 };
    txt(solo ? 'ВЫ ПОГИБЛИ' : 'ОТРЯД ПОГИБ', VW / 2, VH / 2 - 10, 40, HUD_RED, 'center');
    runLines(r, s.mode === 'assault').forEach((l, i) => mono(l, VW / 2, VH / 2 + 26 + i * 20, '#f0d890', 'center', 15));
    mono(`возвращение в хаб через ${Math.max(0, Math.ceil(RUN_DEAD_T - G.stateT))} с · Esc — в меню`, VW / 2, VH / 2 + 96, HUD_COL, 'center', 13);
    return;
  } else txt(win ? 'ПОЛИГОН ЗАЧИЩЕН' : solo ? 'ВЫ ПОГИБЛИ' : 'ОТРЯД ПОГИБ', VW / 2, VH / 2 - 10, 40, win ? '#9fe870' : HUD_RED, 'center');
  mono(isAuth() ? 'Enter — заново (та же расстановка)' + (G.mapId !== 'range' ? ' · Backspace — в хаб' : '') + ' · Esc — в меню'
    : 'Enter — попросить хоста начать заново · Esc — в меню', VW / 2, VH / 2 + 26, HUD_COL, 'center', 14);
}

// Ранен: красный пульсирующий край, сколько осталось, поднимают ли
function drawDownedHud(p) {
  const pulse = 0.35 + 0.15 * Math.sin(G.time * 4);
  const k = 1 - clamp(p.bleed / DOWN.bleed, 0, 1);
  const gr = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.25, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
  gr.addColorStop(0, 'rgba(90,0,0,0)'); gr.addColorStop(1, `rgba(90,0,0,${pulse + k * 0.4})`);
  ctx.fillStyle = gr; ctx.fillRect(0, 0, VW, VH);
  txt('ВЫ РАНЕНЫ', VW / 2, VH - 150, 26, HUD_RED, 'center');
  if (p.reviving || (p.rev > 0 && p.lastReviver)) {
    mono(`вас поднимают… ${Math.round(p.rev * 100)}%`, VW / 2, VH - 124, '#9fe870', 'center', 14);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(VW / 2 - 100, VH - 112, 200, 5);
    ctx.fillStyle = '#9fe870'; ctx.fillRect(VW / 2 - 100, VH - 112, 200 * p.rev, 5);
  } else {
    mono(`истекаете кровью: ${Math.ceil(p.bleed)} с · ползите к своим (WASD), вас может поднять товарищ`, VW / 2, VH - 124, HUD_COL, 'center', 13);
  }
}

// Рядом раненый товарищ: подсказка и полоса подъёма
function drawRevivePrompt(p) {
  const t = G.players.find((q) => q !== p && q.down && !q.dead && Math.hypot(q.x - p.x, q.y - p.y) < DOWN.reviveR);
  if (!t) return;
  const x = VW / 2, y = VH - 170;
  if (p.reviving) {
    mono(`поднимаю: ${t.name}`, x, y, '#9fe870', 'center', 13);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x - 90, y + 8, 180, 5);
    ctx.fillStyle = '#9fe870'; ctx.fillRect(x - 90, y + 8, 180 * t.rev, 5);
  } else mono(`F (держать) — поднять: ${t.name} (осталось ${Math.ceil(t.bleed)} с)`, x, y, HUD_WARN, 'center', 13);
}

// Голос: микрофон, рация (в помещении связи нет), кто говорит
function drawVoice(p) {
  if (!Voice.stream || (G.role !== 'host' && G.role !== 'guest')) return;
  const x = TouchUI.on ? Math.round(VW / 2 - 112) : 20, y = TouchUI.on ? 96 : VH - 96;
  let line = Voice.muted ? 'МИКРОФОН ВЫКЛ (M)' : Voice.sending ? 'ГОВОРИТЕ' : 'МИКРОФОН ВКЛ (M)';
  let col = Voice.muted ? HUD_DIM : Voice.sending ? '#9fe870' : HUD_COL;
  if (keys.KeyB) {
    if (radioOk(p)) { line += ' · РАЦИЯ: В ЭФИРЕ'; col = '#a0c8e8'; }
    else { line += ' · РАЦИЯ: НЕТ СВЯЗИ (в помещении)'; col = HUD_RED; }
  } else line += radioOk(p) ? ' · B — рация' : ' · рация: нет связи';
  mono(line, x, y, col, 'left', 11);
}

// Значок голоса: волны — говорит рядом, антенна — по рации
function talkIcon(x, y, slot) {
  const t = Voice.talking(slot);
  if (!t.talk) return;
  ctx.save();
  ctx.strokeStyle = t.radio ? '#a0c8e8' : '#9fe870'; ctx.lineWidth = 1.5;
  if (t.radio) {
    ctx.beginPath(); ctx.moveTo(x, y + 5); ctx.lineTo(x, y - 4); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 4, 3, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y - 4, 6, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  } else {
    for (let k = 1; k <= 3; k++) { ctx.beginPath(); ctx.arc(x - 3, y, k * 2.6, -0.7, 0.7); ctx.stroke(); }
  }
  ctx.restore();
}

// Состав отряда: цвет места, имя, здоровье (бот — помечен)
// Цвет пинга: до 80 мс — обычный, до 150 — жёлтый, дальше — красный
const pingColor = (ms) => (ms < 80 ? HUD_DIM : ms < 150 ? '#d8b44a' : HUD_RED);

function drawTeam() {
  if (G.players.length < 2) return;
  const net = G.role === 'host' || G.role === 'guest';
  const x = TouchUI.on ? 14 : VW - 270, y0 = TouchUI.on ? 112 : 14, guestLine = G.role === 'guest' ? 18 : 0;
  const rh = G.players.length > 4 ? 17 : 22;          // больше 4 бойцов — строки плотнее
  box(x, y0, 256, 14 + G.players.length * rh + guestLine);
  [...G.players].sort((a, b) => a.slot - b.slot).forEach((o, i) => {
    const y = y0 + 22 + i * rh;
    ctx.fillStyle = SLOT_COLORS[o.slot]; ctx.fillRect(x + 10, y - 9, 8, 8);
    mono(o.name + (o.ai ? ' · бот' : '') + (o.slot === G.mySlot ? ' (вы)' : ''), x + 24, y, o.dead ? HUD_DIM : HUD_COL, 'left', 12);
    if (!o.ai) talkIcon(x + 140, y - 4, o.slot);
    // пинг (у хоста — «хост»: до него задержки нет)
    if (net && !o.ai) {
      const ms = pingOf(o.slot);
      if (o.slot === 0) mono('хост', x + 246, y, HUD_DIM, 'right', 11);
      else if (ms != null) mono(ms + ' мс', x + 246, y, pingColor(ms), 'right', 11);
    }
    if (o.dead) { mono('погиб', x + 204, y, HUD_RED, 'right', 12); return; }
    if (o.down) { mono(`ранен ${Math.ceil(o.bleed)} с`, x + 204, y, HUD_RED, 'right', 12); return; }
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 150, y - 7, 54, 5);
    ctx.fillStyle = o.hp < 35 ? HUD_RED : '#c8c4b0'; ctx.fillRect(x + 150, y - 7, 54 * clamp(o.hp / HP, 0, 1), 5);
  });
  // гость: сколько снимков приходит и на сколько позже показаны остальные (интерполяция)
  if (guestLine) {
    const y = y0 + 22 + G.players.length * rh;
    mono(`снимки ${Net.snapHz}/с · задержка показа ${Math.round(interpDelay())} мс`, x + 246, y, HUD_DIM, 'right', 11);
  }
}
