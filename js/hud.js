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
  drawTeam();
  drawVoice(p);
  // задача
  const left = alive(G.enemies).length;
  box(14, 14, 330, 52);
  txt(map.name || 'ПОЛИГОН', 26, 36, 15);
  if (G.mapId === 'hub') mono('стол (F) — оружие · проход — на карту (хост стоит 2 с)', 26, 56, HUD_DIM);
  else if (!G.enemies.length) mono('противников нет — пристрелка' + (isAuth() ? ' · Backspace — в хаб' : ''), 26, 56, HUD_DIM);
  else mono(`противников осталось: ${left} из ${G.enemies.length}` + (isAuth() && G.mapId !== 'range' ? ' · Backspace — в хаб' : ''), 26, 56, left ? HUD_DIM : '#9fe870');
  if (G.mapId === 'hub' && tableNear(p) && !p.dead && !loadoutOpen()) txt('F — оружейный стол', VW / 2, VH - 120, 15, HUD_WARN, 'center');
  mono('TAB — характеристики оружия · 1, 2, 3 — оружие · X — нож · H — управление', 14, 84, 'rgba(232,228,216,0.45)', 'left', 11);
  if (p.keys && p.keys.size) {
    const names = [...p.keys].map((id) => keyName(id));
    mono('Ключи: ' + names.join(', '), 14, 102, '#d8c890', 'left', 12);
  }
  if (!p.dead && G.state === 'play') drawDoorPrompt(p);
  if (keys.KeyH) drawControls();
  if (keys.Tab || keys.KeyI) drawSpecs();
  if (G.toast) txt(G.toast.text, VW / 2, VH - 150, 16, HUD_WARN, 'center');
  // реплики (слышно): противников и своих ботов
  if (G.barks) G.barks.forEach((b, i) => { ctx.globalAlpha = Math.min(1, b.t); mono(`${b.foe ? 'Противник' : 'Свой'}: «${b.text}»`, VW / 2, VH - 200 - (G.barks.length - 1 - i) * 18, b.foe ? '#e8a080' : '#a0c8e8', 'center', 13); ctx.globalAlpha = 1; });
  if (G.state === 'dead' || G.state === 'win') drawEnd();
}

function drawHealth(p) {
  const x = 20, y = VH - 66;
  box(x - 6, y - 22, 236, 64);
  txt(`${Math.ceil(p.hp)}`, x + 4, y + 18, 28, p.hp < 35 ? HUD_RED : HUD_COL);
  const k = p.hp / HP;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 64, y + 2, 150, 8);
  ctx.fillStyle = p.hp < 35 ? HUD_RED : '#c8c4b0'; ctx.fillRect(x + 64, y + 2, 150 * k, 8);
  mono('ЗДОРОВЬЕ', x + 64, y - 6);
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
  const x = VW - 270, y = VH - 96;
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
    mono(W.cls === 'shotgun' ? 'ЗАРЯЖАЕТ ПО ПАТРОНУ (ОГОНЬ — ПРЕРВАТЬ)' : g.reloadEmpty ? 'ПЕРЕЗАРЯДКА (ЗАТВОР НА ЗАДЕРЖКЕ)' : 'ПЕРЕЗАРЯДКА', x, y - 16, HUD_WARN, 'left', 11);
  } else if (p.sw) {
    const k = clamp(p.sw.t / p.sw.dur, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(x, y - 10, 256, 4);
    ctx.fillStyle = HUD_COL; ctx.fillRect(x, y - 10, 256 * k, 4);
    mono('СМЕНА ОРУЖИЯ: ' + WEAPONS[p.kit[p.sw.to].t].name, x, y - 16, HUD_COL, 'left', 11);
  } else if (!g.chamber && !g.mag) mono(canReload(g) ? 'ПУСТО — R' : 'ПАТРОНОВ НЕТ — СМЕНИТЕ ОРУЖИЕ (1, 2, 3)', x, y - 10, HUD_RED, 'left', 12);
}

// Слоты снаряжения над панелью оружия: 1, 2 — полноразмерные, 3 — пистолет; в руках — подсвечен, патронов всего
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
    ctx.strokeStyle = G.hitmark.kill ? HUD_RED : '#fff';
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
  const cx = (p.x - G.cam.x) * G.zoom + VW / 2, cy = (p.y - G.cam.y) * G.zoom + VH / 2;
  for (const h of G.hurt) {
    ctx.strokeStyle = `rgba(255,60,40,${Math.min(1, h.t) * 0.8})`;
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(cx, cy, 70, h.a - 0.3, h.a + 0.3); ctx.stroke();
  }
  if (p.hurtT < 0.25) { ctx.fillStyle = `rgba(160,0,0,${(0.25 - p.hurtT) * 1.2})`; ctx.fillRect(0, 0, VW, VH); }
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
    ['Режимы', W.modes.length > 1 ? 'одиночный, автоматический (V)' : W.cls === 'shotgun' ? 'помповый: каждый выстрел — новое нажатие' : 'одиночный'],
    W.cls === 'shotgun' ? ['Магазин', `подствольный на ${W.mag} (+1), с собой ${W.shells} россыпью`]
      : ['Магазин', `${W.mag} патронов, с собой ${W.mags} шт. (${W.mag * W.mags})`],
    ['Начальная скорость', `${W.v0} м/с`], ['Эффективная дальность', `${W.effRange} м`],
    W.cls === 'shotgun' ? ['Заряжание', `по патрону ${n(W.shellT)} с, пустое — первый в патронник ${n(W.shellFirst)} с`]
      : ['Перезарядка', `${n(W.reloadTac)} с, с задержки затвора ${n(W.reloadEmpty)} с`],
    W.pellets ? ['Осыпь', `${W.pellets} дробин, σ ${W.pelletSpread} мрад (≈${n((W.pelletSpread * 2 * 40 / 1000).toFixed(1))} м на 40 м)`]
      : ['Кучность', `≈${n(W.mech)} мрад (≈${n((W.mech * 3.44).toFixed(1))} MOA)`],
    ['Разброс стрелка', `прицел ${n(W.aimStill)} мрад, присев ${n(W.aimCrouch)}, от бедра ${n(W.hip)}`],
    ['Урон', W.pellets ? `${W.dmg[0]}–${W.dmg[1]} за дробину из ${HP} (в упор — смертельно)`
      : `${W.dmg[0]}–${W.dmg[1]} из ${HP}; ${Math.round(W.vital * 100)}% — смертельное`],
    ['Пробитие укрытий', W.penExp < 1 ? 'лучше 5,56' : W.penExp > 1.5 ? 'слабое' : 'как у 5,56'],
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
    ['ПКМ (держать)', 'прицелиться: точнее, медленнее'], ['R', 'перезарядка'], ['V', 'режим огня'], ['Q / E (держать)', 'выглянуть влево / вправо из-за укрытия'], ['F', 'взаимодействие: дверь открыть / закрыть / отпереть'], ['G', 'выбить дверь ногой (громко)'], ['F (держать)', 'рядом с раненым товарищем — поднять'], ['B (держать)', 'рация (в помещении связи нет)'], ['M', 'микрофон вкл/выкл'], ['L', 'фонарь на оружии (в темноте выдаёт вас)'],
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
  txt(win ? 'ПОЛИГОН ЗАЧИЩЕН' : solo ? 'ВЫ ПОГИБЛИ' : 'ОТРЯД ПОГИБ', VW / 2, VH / 2 - 10, 40, win ? '#9fe870' : HUD_RED, 'center');
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
  const x = 20, y = VH - 96;
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
  const x = VW - 270, y0 = 14, guestLine = G.role === 'guest' ? 18 : 0;
  box(x, y0, 256, 14 + G.players.length * 22 + guestLine);
  [...G.players].sort((a, b) => a.slot - b.slot).forEach((o, i) => {
    const y = y0 + 22 + i * 22;
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
    const y = y0 + 22 + G.players.length * 22;
    mono(`снимки ${Net.snapHz}/с · задержка показа ${Math.round(interpDelay())} мс`, x + 246, y, HUD_DIM, 'right', 11);
  }
}
