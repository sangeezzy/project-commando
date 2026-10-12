// Анимация: переходы между позами плавные — не за один кадр и не дольше ~0,5 с.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  G.enemies = [];
  const adv = (o, sec) => { for (let i = 0; i < Math.round(sec * 60); i++) { G.time += 1 / 60; updateAnim(o, 1 / 60); } };
  run('позы', () => {
    at(p, 36, 27); p.crouch = false; p.sprint = false; p.an = null;
    updateAnim(p, 0);
    check('старт без перехода: поза сразу целевая', p.an.crouch === 0 && p.an.low === 0);
    p.crouch = true; adv(p, 1 / 60);
    check('присед: за один кадр не прыгает', p.an.crouch > 0 && p.an.crouch < 0.3, p.an.crouch.toFixed(2));
    adv(p, 0.5);
    check('присед: за 0,5 с завершён', p.an.crouch > 0.95, p.an.crouch.toFixed(3));
    p.crouch = false; adv(p, 0.1);
    check('встаёт тоже плавно', p.an.crouch > 0.2 && p.an.crouch < 0.8, p.an.crouch.toFixed(2));
    p.sprint = true; adv(p, 1 / 60);
    const l1 = p.an.low; adv(p, 0.05);
    check('бег: оружие опускается постепенно', l1 > 0 && l1 < 0.3 && p.an.low > l1, [l1.toFixed(2), p.an.low.toFixed(2)]);
    adv(p, 0.5);
    check('бег: оружие опущено к 0,5 с', p.an.low > 0.95, p.an.low.toFixed(3));
    p.sprint = false; adv(p, 0.25);
    check('после бега вскинуто к моменту, когда можно стрелять (0,25 с)', p.an.low < 0.1, p.an.low.toFixed(3));
  });
  run('перезарядка', () => {
    p.gun = makeGun('m4a1', 7); p.gun.mag = 0; p.gun.chamber = 0; p.an = null; updateAnim(p, 0);
    startReload(p);
    const mags = [];
    for (let i = 0; i < Math.round(p.gun.reloadDur * 60); i++) {
      G.time += 1 / 60; updateGun(p, 1 / 60); updateAnim(p, 1 / 60); mags.push(magOut(p.gun));
    }
    let maxJump = 0;
    for (let i = 1; i < mags.length; i++) maxJump = Math.max(maxJump, Math.abs(mags[i] - mags[i - 1]));
    check('магазин выходит и входит плавно (без скачков за кадр)', Math.max(...mags) === 1 && maxJump < 0.15, maxJump.toFixed(3));
    check('к концу перезарядки магазин на месте', mags[mags.length - 1] === 0);
  });
  run('противник вскидывает оружие', () => {
    const e = makeEnemy(M(30), M(20), 0, null);
    updateAnim(e, 0);
    check('спокойный — оружие не у плеча', e.an.ads === 0);
    e.st = 2; e.seeing = true;
    updateAnim(e, 1 / 60);
    check('заметив — вскидывает не мгновенно', e.an.ads > 0 && e.an.ads < 0.4, e.an.ads.toFixed(2));
    adv(e, 0.4);
    check('и через 0,4 с прицеливается', e.an.ads > 0.95, e.an.ads.toFixed(3));
  });
  run('падение', () => {
    const e = makeEnemy(M(36.5), M(29.5), 0, null);
    G.enemies = [e];
    e.deadA = 0; e.dead = true; e.deadT = G.time;
    check('сразу после смерти — начало падения', deathK(e) < 0.05);
    G.time += 0.2;
    const mid = deathK(e);
    check('падение идёт (0,2 с)', mid > 0.2 && mid < 0.9, mid.toFixed(2));
    G.time += 0.4;
    check('за ~0,5 с лежит', deathK(e) === 1);
    G.cam.x = e.x; G.cam.y = e.y;
    e.deadT = G.time - 0.2;
    render(1 / 60);
    check('кадр с падающим бойцом рисуется', true);
  });
  return T_.checks;
})();
