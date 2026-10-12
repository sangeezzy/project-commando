// Скрытность в поселении: камеры, станция наблюдения, задержка тревоги, тихое устранение, дроид-связист.
window.__result = (() => {
  const { check, tick, run, at } = T_;
  const reset = () => {
    G.m = freshFlags(); G.m.met = true; startStage(1, 2, 'start');
    T_.freeze(); T_.unride();
    const p = me(); T_.away(p); p.lamp = false;
    return p;
  };
  const facePoint = (o, d) => ({ x: o.x + Math.cos(o.a0) * d, y: o.y + Math.sin(o.a0) * d });
  run('камера', () => {
    const p = reset();
    const cam = G.objs.find((o) => o.k === 'camera' && o.label === 'главные ворота');
    cam.sweep = 0;
    const s = freeSpotNear(facePoint(cam, 150).x, facePoint(cam, 150).y);
    p.x = p.rx = s.x; p.y = p.ry = s.y;
    T_.only();
    tick(90);
    check('камера заметила отряд — тревога на окраинах', G.m.alarm && G.m.camsAlarm && G.m.centerAlert, { alarm: G.m.alarm, seen: cam.seen });
  });
  run('станция', () => {
    const p = reset();
    const st = objByName('station');
    completeHold(st, p);
    check('станция отключена — все камеры выключены', G.m.stationOff && G.objs.filter((o) => o.k === 'camera').every((o) => !o.on));
    const cam = G.objs.find((o) => o.k === 'camera' && o.label === 'главные ворота');
    cam.sweep = 0;
    const s = freeSpotNear(facePoint(cam, 150).x, facePoint(cam, 150).y);
    p.x = p.rx = s.x; p.y = p.ry = s.y;
    T_.only();
    tick(90);
    check('при выключенной станции камера не поднимает тревогу', !G.m.alarm);
  });
  // враг окраин, перед которым стоит герой
  const faceOff = (p) => {
    const e = G.enemies.find((q) => q.zone === 'out' && q.t === 'S' && !q.patrol);
    T_.only(e);
    at(e, 66, 40); e.a = Math.PI; e.st = 0;
    at(p, 61, 40); p.dash = 99;       // неуязвим, чтобы не упасть
    return e;
  };
  run('задержка тревоги', () => {
    const p = reset();
    const e = faceOff(p);
    tick(60);
    check('враг заметил героя, но тревоги ещё нет', e.st === 2 && !G.m.alarm, { st: e.st, alarmT: e.alarmT });
    tick(60 * (ALARM_DELAY + 0.5));
    check('через ' + ALARM_DELAY + ' с — тревога в районе', G.m.alarm && G.m.centerAlert);
  });
  run('успели устранить', () => {
    const p = reset();
    const e = faceOff(p);
    tick(60);
    damageEnemy(e, 99, p.idx, p.x, p.y);
    tick(60 * (ALARM_DELAY + 1));
    check('враг убит до тревоги — тревоги нет', !G.m.alarm);
  });
  run('тихое устранение', () => {
    const p = reset();
    const es = G.enemies.filter((q) => q.zone === 'out' && q.t === 'S' && !q.patrol).slice(0, 2);
    T_.only(...es);
    const [e, e2] = es;
    at(e, 64, 40); e.a = 0; e.st = 0; e.look = 0; e.lookT = 99;
    at(e2, 66, 37); e2.a = 0; e2.st = 0; e2.look = 0; e2.lookT = 99;
    p.x = p.rx = e.x - 26; p.y = p.ry = e.y; p.a = 0; p.mv = MV.IDLE;
    playerMelee(p);
    tick(30);
    check('удар со спины по ничего не подозревающему — насмерть', e.dead && e.silent);
    check('соседний враг ничего не услышал', e2.st === 0 && !G.m.alarm, e2.st);
  });
  run('связист', () => {
    const p = reset();
    const c = G.enemies.find((q) => q.t === 'C');
    T_.only(c);
    c.a = 0; c.st = 0;
    const s = freeSpotNear(c.x + 110, c.y); p.x = p.rx = s.x; p.y = p.ry = s.y; p.dash = 99;
    tick(60 * (COMM_CALL_TIME + 0.6));
    check('дроид-связист вызвал подкрепление — тревога в центре', G.m.cenAlarm && G.m.centerAlert, { st: c.st, call: c.callT });
  });
  return T_.checks;
})();
