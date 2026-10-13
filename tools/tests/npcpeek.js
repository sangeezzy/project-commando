// Выглядывание противников: знают об опасности за углом — сначала выглядывают; никого — идут дальше;
// на них смотрят — прячутся и либо обходят вне поля зрения, либо пересиживают и выглядывают снова;
// смотрят в другую сторону — стреляют, а как только к ним повернулись — прячутся.
// Угол: юго-восточный угол кирпичного здания (стена x = 20, y 6..16). Противник идёт с юга-запада, опасность — к северо-востоку.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  const e = makeEnemy(0, 0, 0, null);
  G.enemies = [e];
  const D = { x: 22.5 * TILE, y: 10.5 * TILE };
  const reset = () => {
    at(e, 17, 17); e.a = e.want = 0; e.st = 2; e.notice = 0; e.seeing = false; e.lastSeen = -99;
    e.lastX = D.x; e.lastY = D.y; e.goal = null; e.searchT = 0; e.cover = null; e.patrol = null;
    e.peek = null; e.peekCd = 0; e.flank = null; e.lean = 0; e.leanWant = 0; e.leanPx = 0; e.lx = e.x; e.ly = e.y;
    e.crouch = false; e.react = 0; e.gun = makeGun('m4a1', ENEMY.mags); e.doorFire = null; e.hp = 100; e.dead = false;
    e.caught = 0; e.commit = 0;      // первая встреча у угла (нарастание проверяется отдельно)
    G.bullets = [];
  };
  const face = (o, x, y) => { o.a = Math.atan2(y - o.y, x - o.x); };
  // n кадров; fn — наблюдатель за каждым кадром
  const sim = (sec, fn) => { for (let i = 0; i < sec * 60; i++) { G.time += 1 / 60; updateAI(1 / 60); updateBullets(1 / 60); trackSpeed(p, 1 / 60); if (fn && fn(i) === false) return; } };

  run('за углом никого — выглянул и пошёл дальше', () => {
    reset(); at(p, 15, 12); p.hp = 1e9; p.a = 0;              // игрок в здании, его не видно
    let peeked = null;
    sim(10, () => {
      if (!e.peek || Math.abs(e.lean) < 0.8) return;
      if (!peeked) peeked = { x: e.x / TILE, y: e.y / TILE, hidden: !los(e.x, e.y, D.x, D.y), see: false };
      if (los(e.lx, e.ly, D.x, D.y)) peeked.see = true;       // довернулся и высунулся — видит
    });
    check('у угла остановился и выглянул', !!peeked, peeked);
    check('тело при этом за углом, а глаза — уже видят опасное место', peeked && peeked.hidden && peeked.see, peeked);
    check('никого не увидел — пошёл дальше за угол', e.x > 21 * TILE && e.y < 15 * TILE && !e.peek && Math.abs(e.lean) < 0.1, [e.x / TILE, e.y / TILE]);
  });

  run('на него смотрят — прячется, затем обход или пересидеть', () => {
    let hide = 0, flank = 0, shotWatched = 0, seenOnFlank = 0, peekAgain = 0, flankOk = 0;
    for (let k = 0; k < 14; k++) {
      reset(); at(p, 22, 10); p.hp = 1e9; face(p, 21 * TILE, 17.5 * TILE);
      const shot0 = e.gun.lastShot;
      let phase = null;
      sim(6, () => {
        if (e.gun.lastShot > shot0) shotWatched++;
        if (e.flank || (e.peek && e.peek.phase === 'hide')) { phase = e.flank ? 'flank' : 'hide'; return false; }
      });
      if (phase === 'hide') {
        hide++;
        // пересидел — выглядывает снова
        let again = false;
        sim(8, () => { if (e.peek && e.peek.phase === 'look' && Math.abs(e.lean) > 0.5) { again = true; return false; } });
        if (again) peekAgain++;
      } else if (phase === 'flank') {
        flank++;
        const f = e.flank, d = Math.hypot(f.x - p.x, f.y - p.y);
        if (d >= ENEMY.peek.flankR[0] - 1 && d <= ENEMY.peek.flankR[1] + 1 && Math.abs(angDiff(Math.atan2(f.y - p.y, f.x - p.x), p.a)) > PLAYER_FOV) flankOk++;
        sim(6, () => { if (e.flank && playerSees(p, e)) seenOnFlank++; });
      }
    }
    check('на него смотрят — не стреляет, прячется', shotWatched === 0, shotWatched);
    check('решает случайно: и обходит, и пересиживает', hide > 0 && flank > 0, { hide, flank });
    check('пересидев, выглядывает снова', peekAgain === hide, [peekAgain, hide]);
    check('обходит к точке вне поля зрения игрока, в 4–10 м от него', flankOk === flank, [flankOk, flank]);
    check('при обходе игрок его не видит', seenOnFlank === 0, seenOnFlank);
  });

  run('заметили у угла не раз — не ходит по кругу: выходит с огнём или держит угол', () => {
    let commit = 0, hold = 0, shotAfter = 0;
    const calls = []; const cc0 = window.cornerCaught; window.cornerCaught = (a, b) => { const r = cc0(a, b); calls.push(String(r)); return r; };
    for (let k = 0; k < 10; k++) {
      reset(); at(p, 22, 10); p.hp = 1e9; face(p, 21 * TILE, 17.5 * TILE);
      e.caught = ENEMY.peek.commitAfter - 1; e.caughtT = G.time;          // уже ловили у этого угла
      const shot0 = e.gun.lastShot;
      let r = null;
      sim(6, () => {
        if (e.peek && e.peek.phase === 'hold') { r = 'hold'; return false; }
        if (e.commit > G.time) { r = 'commit'; return false; }
        if (e.flank || (e.peek && e.peek.phase === 'hide')) { r = 'hide'; return false; }
      });
      if (r === 'commit') {
        commit++;
        sim(3, () => { if (e.gun.lastShot > shot0) { shotAfter++; return false; } });
      } else if (r === 'hold') hold++;
    }
    window.cornerCaught = cc0;
    check('решился: вышел и стреляет, хотя на него смотрят — или держит угол (один, без напарника)', commit + hold === 10 && commit > 0 && hold > 0, { commit, hold, calls: calls.join(' ') });
    check('решившись — стреляет', shotAfter === commit, [shotAfter, commit]);
  });

  run('смотрят в другую сторону — стреляет; повернулись — прячется', () => {
    let fired = 0, fromCorner = 0, retreat = 0, trials = 0;
    for (let k = 0; k < 6; k++) {
      reset(); at(p, 22, 10); p.hp = 1e9; p.a = -Math.PI / 2;    // смотрит на север, спиной к углу
      const shot0 = e.gun.lastShot;
      let ok = false;
      sim(6, () => {
        if (e.gun.lastShot > shot0) {
          ok = true;
          if (Math.abs(e.lean) > 0.5 && !sightLine(p, e)) fromCorner++;
          return false;
        }
      });
      if (!ok) continue;
      fired++;
      trials++;
      // игрок повернулся к нему
      face(p, e.lx, e.ly);
      let hid = false;
      sim(1, () => { if ((e.flank || (e.peek && (e.peek.phase === 'back' || e.peek.phase === 'hide'))) && Math.abs(e.lean) < 0.15) { hid = true; return false; } });
      if (hid) retreat++;
    }
    check('противник, не глядящий на него, получает огонь первым', fired >= 5, fired);
    check('стреляет высунувшись из-за угла (тело за стеной)', fromCorner === fired, [fromCorner, fired]);
    check('игрок повернулся — за 1 с прячется (обход или пересидеть)', retreat === trials, [retreat, trials]);
  });

  run('отрисовка', () => {
    reset(); at(p, 22, 10); p.a = -Math.PI / 2; sim(2);
    G.cam.x = p.x; G.cam.y = p.y; render(1 / 60);
    check('кадр с выглядывающим противником рисуется', true);
  });
  G.enemies = [];
  return T_.checks;
})();
