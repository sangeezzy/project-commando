// Укрытия: низкие (присел — спрятался, стоя — частично), стрельба поверх своего укрытия, пробитие материалов.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const t = G.enemies[0];
  G.enemies = [t];
  const vital = WEAPONS.m4a1.vital;
  WEAPONS.m4a1.vital = 0;                         // считаем урон без случайных смертельных
  // n прицельных выстрелов без разброса стрелка; цель бессмертна, ИИ не думает
  function volley(shooter, target, n, spread = 0) {
    let hits = 0, dmg = 0;
    for (let i = 0; i < n; i++) {
      target.hp = 1e6; target.dead = false;
      shooter.a = Math.atan2(target.y - shooter.y, target.x - shooter.x);
      shooter.gun.chamber = 1; shooter.gun.mag = 20;
      fireRound(shooter, spread);
      for (let k = 0; k < 10; k++) updateBullets(1 / 60);
      if (target.hp < 1e6) { hits++; dmg += 1e6 - target.hp; }
    }
    return { hits, avg: hits ? Math.round(dmg / hits) : 0 };
  }
  run('низкое укрытие', () => {
    check('бетонный блок — низкое укрытие', tileAt(32, 23) === T.LOW && wmAt(32, 23) === WM.JERSEY);
    at(p, 32, 33); p.crouch = false;
    at(t, 32, 22); t.crouch = true;
    check('присевшего за блоком не видно', !sightLine(p, t));
    let r = volley(p, t, 30);
    check('присевшего за блоком пули не достают', r.hits === 0, r);
    t.crouch = false;
    check('стоящего за блоком видно', sightLine(p, t));
    r = volley(p, t, 200);
    check('в стоящего за блоком попадает ~70% (остальное — в блок)', r.hits > 120 && r.hits < 165, r.hits);
    // стрелок сам за укрытием
    at(p, 32, 24); at(t, 32, 18); t.crouch = false;
    p.crouch = true;
    check('присевший за своим блоком цель не видит', !sightLine(p, t));
    r = volley(p, t, 10);
    check('присев за блоком, стреляешь в блок', r.hits === 0, r);
    p.crouch = false;
    r = volley(p, t, 10);
    check('встав, стреляешь поверх своего блока', r.hits === 10, r);
    // блок в чистом поле не мешает стрелять по далёкой стоящей цели
    at(p, 32, 33); at(t, 32, 16); t.crouch = false;
    r = volley(p, t, 20);
    check('блок посреди поля не ловит пули, летящие в далёкую цель', r.hits === 20, r);
  });
  run('пробитие', () => {
    p.crouch = false;
    // ящики (33..34, 30): цель присела за ящиком
    at(p, 33, 37); at(t, 33, 29); t.crouch = true;
    let r = volley(p, t, 30);
    check('деревянный ящик пуля пробивает', r.hits === 30, r);
    check('но теряет энергию (урон ~55%)', r.avg > 18 && r.avg < 36, r.avg);
    // бетонный сарай (29..39, 40..46)
    at(p, 31, 48); at(t, 31, 44); t.crouch = false;
    check('за бетонной стеной не видно', !los(p.x, p.y, t.x, t.y));
    r = volley(p, t, 20);
    check('бетонную стену 5,56 не пробивает', r.hits === 0, r);
    // кирпичное здание (6..20, 6..16)
    at(p, 17, 18); at(t, 17, 13);
    r = volley(p, t, 20);
    check('кирпичную стену не пробивает', r.hits === 0, r);
    // фанерный забор (26..32, 13)
    at(p, 29, 17); at(t, 29, 10);
    check('сквозь забор не видно', !los(p.x, p.y, t.x, t.y));
    r = volley(p, t, 20);
    check('фанерный забор прошивает почти без потерь', r.hits === 20 && r.avg > 35, r);
    // контейнер (55..56, 4..9): пуля проходит две клетки
    at(p, 52, 7); at(t, 58, 7);
    r = volley(p, t, 20);
    check('контейнер пробивает насквозь, урон ~30%', r.hits === 20 && r.avg < 22, r);
    // автомобиль (50..51, 36..39)
    at(p, 47, 37); at(t, 52, 37); t.crouch = true;
    r = volley(p, t, 20);
    check('за машиной (2 м металла) пуля теряет силу', r.hits === 0, r);
  });
  WEAPONS.m4a1.vital = vital;
  return T_.checks;
})();
