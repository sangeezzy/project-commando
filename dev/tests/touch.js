// Сенсорное управление (?touch=1): стики (движение, бег, взгляд, огонь у кольца), кнопки (огонь, прицел, перезарядка, присед,
// выглянуть, оружие, дверь по месту), меню ≡, ползком раненым. Касания — прямо через touchStart/touchMove/touchEnd (координаты холста).
window.__result = (() => {
  const { check, run, at, step } = T_;
  const p = me();
  const pool = G.enemies.slice();
  G.enemies = [];
  const R = touchR(), RS = R * TOUCH.stickK;
  const btn = (id) => touchButtons().find((b) => b.id === id);
  const tap = (id) => { const b = btn(id); if (!b) return false; touchStart(90, b.x, b.y); step(1); touchEnd(90); step(1); return true; };
  const reset = () => { touchReset(); for (const k in keys) keys[k] = false; Object.assign(p, { dead: false, down: false, hp: 100, crouchToggle: false, lean: 0, leanWant: 0, ads: 0 }); G.state = 'play'; TouchUI.ads = false; TouchUI.aim = { x: 0, y: -1 }; };
  const open = (tx, ty) => { for (let r = 0; r < 10; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (walkable(tx + dx, ty + dy) && walkable(tx + dx, ty + dy - 4)) return [tx + dx, ty + dy]; return [tx, ty]; };

  check('сенсорный режим включён (?touch=1)', TouchUI.on && document.documentElement.classList.contains('touch'));
  check('подсказки клавиатуры в меню скрыты, сенсорные — видны',
    getComputedStyle(document.querySelector('.help.kbd')).display === 'none' && getComputedStyle(document.querySelector('.help.tonly')).display !== 'none');

  run('левый стик: шаг, медленно, бег', () => {
    reset();
    const [tx, ty] = open(36, 40); at(p, tx, ty);
    const go = (k, n = 60) => { const y0 = p.y; touchStart(1, 200, VH - 150); touchMove(1, 200, VH - 150 - RS * k); step(n); touchEnd(1); step(1); return (y0 - p.y) / PX_M / (n / 60); };
    const full = go(0.95);
    check('стик вверх — идёт вперёд (шагом)', full > SPEED.walk * 0.7 && full < SPEED.walk * 1.15 && !p.sprint, full.toFixed(2));
    at(p, tx, ty);
    const half = go(0.35);
    check('отклонил чуть — медленнее', half > 0.2 && half < full * 0.6, half.toFixed(2));
    at(p, tx, ty);
    let sprinted = false;
    touchStart(1, 200, VH - 150); touchMove(1, 200, VH - 150 - RS * (TOUCH.sprintAt + 0.1));
    for (let i = 0; i < 30; i++) { step(1); if (p.sprint) sprinted = true; }
    const m0 = TouchUI.sticks.move, mo = [m0.ox, m0.oy];
    touchMove(1, 200 + RS * 3, VH - 150 - RS * 3); step(1);
    check('левый стик за пальцем не тянется', m0.ox === mo[0] && m0.oy === mo[1]);
    touchMove(1, 200, VH - 150 - RS * (TOUCH.sprintAt - 0.2)); step(5);
    check('за кольцом, но ближе порога — шагом', !p.sprint);
    touchEnd(1); step(1);
    check('палец далеко за кольцом — бег', sprinted);
    check('отпустил — стоит', !TouchUI.mv && !p.sprint);
  });

  run('правый стик: взгляд и огонь у кольца', () => {
    reset();
    const g = p.gun; g.mag = 20; g.chamber = 1; g.mode = 'auto';
    touchStart(2, VW - 400, VH - 150); touchMove(2, VW - 400 + RS * 0.5, VH - 150);
    step(10);
    check('стик вправо — смотрит вправо', Math.abs(angDiff(p.a, 0)) < 0.05, p.a.toFixed(3));
    check('внутри кольца — не стреляет', g.mag === 20);
    touchMove(2, VW - 400 + RS * (TOUCH.fireAt - 0.1), VH - 150); step(10);
    check('у самого кольца — ещё не стреляет', g.mag === 20);
    touchMove(2, VW - 400 + RS * (TOUCH.fireAt + 0.1), VH - 150); step(20);
    check('палец за кольцом — стреляет', g.mag < 18, g.mag);
    const s = TouchUI.sticks.aim, ox = s.ox, oy = s.oy;
    touchMove(2, VW - 400 + RS * 4, VH - 150); step(1);
    check('далеко за край — стик на месте', s.ox === ox && s.oy === oy);
    touchEnd(2); step(1);
    const m = g.mag; step(10);
    check('отпустил — огонь прекратился, взгляд остался', g.mag === m && Math.abs(angDiff(p.a, 0)) < 0.05);
  });

  run('мягкий аим ассист', () => {
    reset();
    const [tx, ty] = open(36, 40); at(p, tx, ty);
    const e = pool[0];
    G.enemies = [e];
    Object.assign(e, { dead: false, down: false, hp: 1e9, st: 0, notice: 0, lean: 0, va: 1, _dummy: true });
    G.noFog = true;                                       // «видим» без расчёта видимости в тесте
    const d = M(12), off = 0.06;                          // 12 м, 0,72 м вбок от линии стика
    e.x = e.px = p.x + Math.cos(off) * d; e.y = e.py = p.y + Math.sin(off) * d;
    const aimAt = (k) => { touchStart(2, VW - 400, VH - 150); touchMove(2, VW - 400 + RS * k, VH - 150); step(2); };
    aimAt(0.6);
    check('противник у линии стика — взгляд подтянут к нему, но не до конца', p.a > 0.02 && p.a < off - 0.01, p.a.toFixed(3));
    check('направление стика не изменилось', TouchUI.aim.x > 0.999);
    touchEnd(2); step(2);
    check('стик отпущен — взгляд снова ровно по стику', Math.abs(p.a) < 1e-6, p.a.toFixed(4));
    e.x = p.x + Math.cos(0.4) * d; e.y = p.y + Math.sin(0.4) * d;
    aimAt(0.6);
    check('противник далеко от линии — ассиста нет', Math.abs(p.a) < 1e-6, p.a.toFixed(4));
    touchEnd(2); step(1);
    e.x = p.x + Math.cos(off) * d; e.y = p.y + Math.sin(off) * d;
    G.noFog = false; e.va = 0;
    aimAt(0.6);
    check('противника не видно — ассиста нет', Math.abs(p.a) < 1e-6, p.a.toFixed(4));
    touchEnd(2); step(1);
    G.enemies = [];
  });

  run('кнопки: огонь, прицел, перезарядка, присед, выглянуть, оружие', () => {
    reset();
    const g = p.gun; g.mag = 20; g.chamber = 1; g.mode = 'auto';
    const f = btn('fire');
    touchStart(3, f.x, f.y); step(15); touchEnd(3); step(1);
    check('ОГОНЬ — стреляет', g.mag < 19, g.mag);
    tap('ads'); step(20);
    check('ПРИЦЕЛ — прицеливается', p.ads > 0.9, p.ads.toFixed(2));
    tap('ads'); step(20);
    check('ПРИЦЕЛ ещё раз — опустил', p.ads < 0.1);
    tap('reload');
    check('ПЕРЕЗ. — перезаряжает', g.reloadT > 0);
    step(200);
    tap('crouch'); step(2);
    check('ПРИСЕД — присел', p.crouch);
    tap('crouch'); step(2);
    check('ВСТАТЬ — встал', !p.crouch);
    const b = btn('leanR');
    touchStart(4, b.x, b.y); step(20);
    const leaned = p.leanWant === 1;
    touchEnd(4); step(2);
    check('▶ (держать) — выглядывает вправо, отпустил — нет', leaned && p.leanWant === 0);
    const cur = p.cur;
    check('кнопка оружия есть', !!btn('weapon'));
    tap('weapon'); step(120);
    check('ОРУЖ. — сменил оружие', p.cur !== cur, [cur, p.cur]);
  });

  run('по месту: дверь', () => {
    reset();
    const d = map.doors.find((q) => !q.locked && !q.broken);
    const spots = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [Math.floor(d.cx / TILE) + dx, Math.floor(d.cy / TILE) + dy]).filter(([x, y]) => walkable(x, y));
    at(p, spots[0][0], spots[0][1]);
    check('у двери — кнопки ДВЕРЬ и ВЫБИТЬ', btn('use') && btn('use').label === 'ДВЕРЬ' && !!btn('kick'));
    const was = d.open;
    tap('use'); step(40);
    check('ДВЕРЬ — открыл/закрыл', d.open !== was, [was, d.open]);
    at(p, 2, 2);
    check('без двери — кнопок нет', !btn('use') && !btn('kick'));
  });

  run('меню ≡', () => {
    reset();
    tap('menu');
    check('≡ — меню открыто, управление стоит', touchMenuOpen() && uiOpen());
    const v = G.viewT;
    document.getElementById('tmuOut').click();
    check('масштаб: «−» — видно больше', G.viewT > v);
    document.getElementById('tmuIn').click();
    document.getElementById('tmuResume').click();
    check('ПРОДОЛЖИТЬ — закрыто', !touchMenuOpen());
  });

  run('ранен — ползёт стиком', () => {
    reset();
    const [tx, ty] = open(36, 40); at(p, tx, ty);
    damagePerson(p, 150, p.x + 100, p.y, Math.PI, null);
    check('ранен', p.down);
    check('ранен — кнопок действий нет', !btn('fire') && !btn('reload'));
    const y0 = p.y;
    touchStart(1, 200, VH - 150); touchMove(1, 200, VH - 150 - RS); step(60); touchEnd(1);
    const v = (y0 - p.y) / PX_M;
    check('ползёт (~0,5 м/с)', v > 0.3 && v < 0.65, v.toFixed(2));
    reviveUp(p);
  });

  run('камера: приблизить / отдалить', () => {
    reset();
    check('кнопки камеры есть (со значками)', btn('zoomIn') && btn('zoomOut') && btn('zoomIn').icon === 'in' && btn('zoomOut').icon === 'out');
    G.viewT = 24;
    tap('zoomIn');
    check('▲ — ближе (видно меньше метров)', Math.abs(G.viewT - 24 / CAM.wheelStep) < 1e-6, G.viewT.toFixed(2));
    tap('zoomOut');
    check('▼ — обратно', Math.abs(G.viewT - 24) < 1e-6, G.viewT.toFixed(2));
    const b = btn('zoomOut');
    touchStart(5, b.x, b.y); step(60); touchEnd(5); step(1);
    check('держать ▼ — отдаляет дальше, по шагам', G.viewT > 24 * Math.pow(CAM.wheelStep, 3), G.viewT.toFixed(2));
    G.viewT = 24;
  });

  run('настройка кнопок', () => {
    reset();
    TouchUI.layout = {}; saveLayout();
    const fire0 = { x: btn('fire').x, y: btn('fire').y };
    openTouchMenu();
    document.getElementById('tmuLayout').click();
    check('«Настроить кнопки» — режим настройки, меню закрыто, управление стоит', TouchUI.edit && !touchMenuOpen() && uiOpen());
    const all = touchButtons().map((b) => b.id);
    check('видны все кнопки, и те, что по месту (дверь, выбить)', all.includes('use') && all.includes('kick') && all.includes('mode') && all.includes('zoomIn'), all);
    const g = p.gun; g.mag = 20; g.chamber = 1;
    const f = btn('fire');
    touchStart(6, f.x, f.y); touchMove(6, 300, 200); step(5); touchEnd(6); step(1);
    check('кнопку перетащили — она на новом месте и не стреляла', Math.abs(btn('fire').x - 300) < 1 && Math.abs(btn('fire').y - 200) < 1 && g.mag === 20,
      [btn('fire').x, btn('fire').y, g.mag]);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('pcr-touch-layout') || '{}'); } catch (e) { /* ignore */ }
    check('положение запомнено (доли экрана)', saved.fire && Math.abs(saved.fire[0] - 300 / VW) < 1e-6 && Math.abs(saved.fire[1] - 200 / VH) < 1e-6, saved.fire);
    // пауза одиночной игры, пока настраивают
    G.role = 'solo';
    check('одиночка: пока настраивают — пауза', touchPaused());
    const done = editControls().find((c) => c.id === 'editDone');
    touchStart(7, done.x, done.y); touchEnd(7); step(1);
    check('«Готово» — обычный режим, кнопка осталась на новом месте', !TouchUI.edit && Math.abs(btn('fire').x - 300) < 1 && !touchPaused());
    check('вне настройки «по месту» снова прячутся', !btn('kick') || !!doorNear(p));
    startLayoutEdit();
    const rs = editControls().find((c) => c.id === 'editReset');
    touchStart(8, rs.x, rs.y); touchEnd(8);
    TouchUI.edit = false;
    check('«Сброс» — стандартная раскладка', Math.abs(btn('fire').x - fire0.x) < 1 && Math.abs(btn('fire').y - fire0.y) < 1);
    startLayoutEdit();
    check('«Назад» в настройке — выйти из неё', appBack() === true && !TouchUI.edit);
  });

  run('убрать / вернуть кнопку', () => {
    reset();
    TouchUI.layout = {}; TouchUI.hidden.clear(); saveLayout();
    startLayoutEdit();
    const tapBadge = (id, tid) => { const b = touchButtons(true).find((q) => q.id === id), h = hideBadge(b); touchStart(tid, h.x, h.y); touchEnd(tid); };
    const k0 = btn('reload');
    tapBadge('reload', 11);
    check('✕ — кнопка помечена убранной, но в настройке видна', TouchUI.hidden.has('reload') && btn('reload') && btn('reload').off);
    check('значок не сдвинул кнопку', Math.abs(btn('reload').x - k0.x) < 1 && Math.abs(btn('reload').y - k0.y) < 1);
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem('pcr-touch-hidden') || '[]'); } catch (e) { /* ignore */ }
    check('запомнено', saved.includes('reload'), saved);
    let err = null; try { render(1 / 60); } catch (e) { err = String(e); }
    check('настройка с убранной кнопкой рисуется', !err, err);
    TouchUI.edit = false;
    check('в игре убранной кнопки нет, остальные на месте', !btn('reload') && !!btn('fire') && !!btn('ads'));
    const kb = { x: k0.x, y: k0.y };
    p.gun.mag = 10; p.gun.reloadT = 0;          // перезарядка возможна — если бы кнопка сработала, началась бы
    touchStart(12, kb.x, kb.y); step(2); touchEnd(12);
    check('касание на её месте — не перезарядка (стик)', !p.gun.reloadT);
    startLayoutEdit();
    const mb = touchButtons(true).find((q) => q.id === 'menu'), mh = hideBadge(mb);
    touchStart(13, mh.x, mh.y); touchEnd(13);
    check('меню ≡ убрать нельзя', !TouchUI.hidden.has('menu'));
    tapBadge('reload', 14);
    TouchUI.edit = false;
    check('+ — кнопка вернулась', !TouchUI.hidden.has('reload') && !!btn('reload'));
    // кнопки на одном месте (НОЖ и КАМЕРА — по обстановке): значок — у верхней (нарисованной последней)
    startLayoutEdit();
    tapBadge('carcam', 18);
    check('значок верхней из двух на одном месте — её, а не нижней', TouchUI.hidden.has('carcam') && !TouchUI.hidden.has('knife'), [...TouchUI.hidden]);
    tapBadge('ads', 15); tapBadge('lamp', 16);
    const rs = editControls().find((c) => c.id === 'editReset');
    touchStart(17, rs.x, rs.y); touchEnd(17);
    TouchUI.edit = false;
    check('«Сброс» возвращает и убранные', TouchUI.hidden.size === 0 && !!btn('ads') && !!btn('lamp'));
    touchReset();
  });

  run('рисуется без ошибок', () => { reset(); touchStart(1, 200, VH - 150); touchMove(1, 230, VH - 190); render(1 / 60); touchEnd(1); check('кадр с сенсорным интерфейсом', true); });
  return T_.checks;
})();
