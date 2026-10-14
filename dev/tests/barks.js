// Реплики противников: видимый противник — реплика над ним (b.over), не видимый, но слышимый — внизу экрана, как раньше.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const [A] = G.enemies;
  G.enemies = [A];
  A.st = 0; A.notice = 0; A.hp = 1e9;
  const frame = () => { for (let i = 0; i < 20; i++) render(1 / 60); };
  const say = (text) => { G.barks = []; bark(A, text); frame(); return G.barks.find((b) => b.text === text); };
  // свободная прямая перед игроком (на север): клетка, которую видно
  let tx = 36, ty = 40;
  outer: for (ty = 40; ty < 50; ty++) for (tx = 30; tx < 44; tx++) {
    if (!walkable(tx, ty) || !walkable(tx, ty - 6)) continue;
    at(p, tx, ty); at(A, tx, ty - 6);
    if (sightLine(p, A) && perceivedAt(A.x, A.y) > LIGHT.seeMin + 0.1) break outer;
  }
  p.a = -Math.PI / 2; A.a = Math.PI / 2; G.cam.x = p.x; G.cam.y = p.y; G.noFog = false;

  run('видимый противник — реплика над ним', () => {
    const b = say('Тестовая реплика 1');
    check('противник виден', playerSees(p, A) && A.va > 0.3, A.va);
    check('реплика записана с тем, кто сказал', b && b.id === A.id && b.foe);
    check('реплика над противником, не внизу', b && b.over === true);
  });

  run('не видно (за спиной), но слышно — внизу экрана', () => {
    at(A, tx, ty + 8);
    if (!walkable(tx, ty + 8)) at(A, tx, ty + 6);
    const b = say('Тестовая реплика 2');
    check('противник не виден', !playerSees(p, A), A.va);
    check('реплика слышна и выводится внизу', b && b.over === false);
  });

  run('дальше 35 м — не слышно', () => {
    at(A, tx, Math.max(1, ty - 40));
    G.barks = []; bark(A, 'Тестовая реплика 3'); frame();
    check('реплики нет', !G.barks.length);
  });
  return T_.checks;
})();
