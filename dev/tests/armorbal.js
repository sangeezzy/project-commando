// Баланс брони (анализ, не входит в обычный прогон): сколько попаданий выдерживает боец без брони и в каждом классе,
// против каждого ствола; настоящие hitPerson/armorHit, плита изнашивается от попадания к попаданию (одна плита на «жизнь»).
// Запуск: python dev/run_tests.py --only armorbal   (смотреть got: таблицы)
window.__result = (() => {
  const { check } = T_;
  const N = 3000, DIST = 20;                      // жизней на клетку таблицы, дистанция, м
  const classes = [null, ...ARMOR_ORDER.slice(1)];
  const o = makeEnemy(0, 0, 0, null);             // противник: при 0 — убит (без ранения), удобно считать
  const hitsToKill = (t, cls) => {
    const W = WEAPONS[t];
    let total = 0, oneShot = 0;
    for (let i = 0; i < N; i++) {
      Object.assign(o, { hp: HP, dead: false, down: false });
      giveArmor(o, cls);
      let n = 0;
      while (!o.dead && n < 60) {
        n++;
        hitPerson(o, { t: W, e: 1, dist: M(DIST), sx: o.x + M(DIST), sy: o.y, vx: -1, vy: 0, owner: -1 });
      }
      total += n;
      if (n === 1) oneShot++;
    }
    return { avg: total / N, one: oneShot / N };
  };
  const table = {}, gain = {};
  for (const t of WEAPON_IDS) {
    const row = classes.map((c) => hitsToKill(t, c));
    table[WEAPONS[t].short] = row.map((r) => r.avg.toFixed(2)).join(' | ');
    gain[WEAPONS[t].short] = row.slice(1).map((r) => '×' + (r.avg / row[0].avg).toFixed(2)).join(' | ');
  }
  check('попаданий до смерти (20 м; дробина — одна дробина): без брони | IIIA | III | III+ | IV', true, table);
  check('во сколько раз больше попаданий держит броня: IIIA | III | III+ | IV', true, gain);
  return T_.checks;
})();
