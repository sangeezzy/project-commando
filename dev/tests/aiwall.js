// Противник за непробиваемой стеной от цели (жалоба: стоит в углу, смотрит в стену, стреляет в неё, не выглядывает).
// Сарай box(29, 40, 39, 46) — бетон, выходы [34, 40] и [39, 44]; A внутри у западной стены, игрок снаружи за ней.
window.__result = (() => {
  const { check, tick, at, only, run } = T_;
  const p = me();

  // B — снаружи на открытом месте; seesP — видит ли игрока
  function placeB(B, A, seesP, P_) {
    for (let r = 5; r <= 14; r++) for (let k = 0; k < 24; k++) {
      const tx = Math.round(P_[0] + Math.cos((k / 24) * Math.PI * 2) * r), ty = Math.round(P_[1] + Math.sin((k / 24) * Math.PI * 2) * r);
      if (map.fl[ty * map.w + tx] === FM.INDOOR) continue;
      if (!walkable(tx, ty)) continue;
      at(B, tx, ty);
      if (sightLine(B, p) === seesP && !los(A.x, A.y, B.x, B.y)) return [tx, ty];
    }
    return null;
  }

  // 15 с: стрельба A без линии огня, выглядывания, увидел ли, путь
  function scenario(name, withB, bSees, A_ = [30, 42], P_ = [27, 42], reps = 3) {
    for (let rep = 0; rep < reps; rep++) scenario1(`${name} #${rep + 1}`, withB, bSees, A_, P_);
  }
  function scenario1(name, withB, bSees, A_, P_) {
    run(name, () => {
      startRange();
      const [A, B] = G.enemies;
      only(...(withB ? [A, B] : [A]));
      const p = me();
      p.god = true;
      at(p, P_[0], P_[1]); p.a = 0;
      at(A, A_[0], A_[1]); A.a = Math.atan2(P_[1] - A_[1], P_[0] - A_[0]);
      const spot = withB ? placeB(B, A, bSees, P_) : true;
      check(`${name}: расстановка`, !!spot, spot);
      for (const e of G.enemies) { alertEnemy(e, p.x, p.y, true); e.lastX = p.x; e.lastY = p.y; e.lastSeen = G.time; e.target = p; }
      const a0 = { x: A.x, y: A.y };
      let wallShots = 0, peeks = 0, sawP = false, path = 0, lx = A.x, ly = A.y;
      const roles = new Set();
      const ammo = () => A.gun.mag + A.gun.chamber + A.gun.pouch.reduce((s, n) => s + n, 0);
      let am = ammo();
      for (let i = 0; i < 60 * 15; i++) {
        tick(1);
        const now = ammo();
        if (now < am && fireLineK(A.leanPx ? A.lx : A.x, A.leanPx ? A.ly : A.y, p.x, p.y) < 0.2) wallShots += am - now;   // пуля из точки выстрела не дошла бы
        am = now;
        if (A.peek) peeks++;
        if (A.seeing) sawP = true;
        if (A.role) roles.add(A.role);
        path += Math.hypot(A.x - lx, A.y - ly); lx = A.x; ly = A.y;
      }
      const moved = Math.hypot(A.x - a0.x, A.y - a0.y);
      const info = { wallShots, peeks, sawP, path: (path / PX_M).toFixed(1) + ' м', moved: (moved / PX_M).toFixed(1) + ' м', roles: [...roles], st: A.st };
      check(`${name}: A не стреляет в непробиваемую стену`, wallShots === 0, info);
      check(`${name}: A не стоит в углу — ищет позицию (выход, обход, выглядывание)`, path > M(4) && (sawP || peeks > 0 || moved > M(3)), info);
    });
  }
  scenario('A один, знает место игрока', false);
  scenario('A и B, игрока видит B', true, true);
  scenario('A и B, игрока не видит никто', true, false);
  scenario('кирпичный дом: A у западной стены, игрок снаружи', false, false, [7, 11], [4, 11]);
  scenario('кирпичный дом, игрока не видит никто', true, false, [7, 11], [4, 11]);
  return T_.checks;
})();
