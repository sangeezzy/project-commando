// Сенсорное управление (?touch=1): стики (движение, бег, взгляд, огонь у кольца), кнопки (огонь, прицел, перезарядка, присед,
// выглянуть, оружие, дверь по месту), меню ≡, ползком раненым. Касания — прямо через touchStart/touchMove/touchEnd (координаты холста).
window.__result = (() => {
  const { check, run, at, step } = T_;
  const p = me();
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
    touchStart(1, 200, VH - 150); touchMove(1, 200, VH - 150 - RS * 1.4);
    for (let i = 0; i < 30; i++) { step(1); if (p.sprint) sprinted = true; }
    touchEnd(1); step(1);
    check('палец за кольцом — бег', sprinted);
    check('отпустил — стоит', !TouchUI.mv && !p.sprint);
  });

  run('правый стик: взгляд и огонь у кольца', () => {
    reset();
    const g = p.gun; g.mag = 20; g.chamber = 1; g.mode = 'auto';
    touchStart(2, VW - 400, VH - 150); touchMove(2, VW - 400 + RS * 0.5, VH - 150);
    step(10);
    check('стик вправо — смотрит вправо', Math.abs(angDiff(p.a, 0)) < 0.05, p.a.toFixed(3));
    check('внутри кольца — не стреляет', g.mag === 20);
    touchMove(2, VW - 400 + RS * 1.0, VH - 150); step(20);
    check('у внешнего кольца — стреляет', g.mag < 18, g.mag);
    touchEnd(2); step(1);
    const m = g.mag; step(10);
    check('отпустил — огонь прекратился, взгляд остался', g.mag === m && Math.abs(angDiff(p.a, 0)) < 0.05);
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

  run('рисуется без ошибок', () => { reset(); touchStart(1, 200, VH - 150); touchMove(1, 230, VH - 190); render(1 / 60); touchEnd(1); check('кадр с сенсорным интерфейсом', true); });
  return T_.checks;
})();
