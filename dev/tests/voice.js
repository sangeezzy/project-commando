// Голосовой чат без микрофона: сжатие μ-law, громкость ближнего голоса (расстояние, стены, панорама), связь по рации, приём кусков.
window.__result = (() => {
  const { check, run, at } = T_;
  const p = me();
  initAudio();
  run('сжатие голоса (μ-law)', () => {
    let maxErr = 0;
    for (let v = -1; v <= 1; v += 0.001) maxErr = Math.max(maxErr, Math.abs(muDecode(muEncode(v)) - v) / Math.max(0.02, Math.abs(v)));
    check('кодирование туда-обратно: ошибка в пределах ~4%', maxErr < 0.05, maxErr.toFixed(3));
    check('тишина остаётся тишиной', Math.abs(muDecode(muEncode(0))) < 0.002);
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    check('передача кусков (base64) без потерь', unb64(b64(bytes)).join() === bytes.join());
  });
  run('ближний голос', () => {
    const S = makeHuman(1, 0, 0, 0, 'Друг');
    at(p, 36, 27);
    at(S, 38, 27);
    const near = Voice.proximity(p, S);
    at(S, 50, 27);
    const mid = Voice.proximity(p, S);
    at(S, 64, 27);
    const far = Voice.proximity(p, S);
    check('рядом громко, дальше тише, за 25 м не слышно', near.g > 0.8 && mid.g < near.g && mid.g > 0 && far.g === 0, [near.g, mid.g, far.g].map((v) => v.toFixed(2)));
    check('стерео: справа — в правом канале', mid.pan > 0);
    at(p, 14, 27); at(S, 6, 27);                    // кирпичная стена между ними
    const wall = Voice.proximity(p, S);
    check('за стеной — тише и глуше', wall.cut < 1000 && wall.g < Math.pow(1 - M(8) / VOICE.range, 1.5) * 0.6, [wall.g.toFixed(2), wall.cut]);
    S.dead = true;
    check('погибший не говорит', Voice.proximity(p, S).g === 0);
  });
  run('рация', () => {
    at(p, 36, 27);
    check('на улице связь есть', radioOk(p));
    at(p, 31, 44);
    check('в помещении (бетонный сарай) связи нет', !radioOk(p));
    at(p, 15, 12);
    check('в кирпичном здании тоже нет', !radioOk(p));
    at(p, 36, 27); p.dead = true;
    check('у погибшего нет', !radioOk(p));
    p.dead = false;
  });
  run('приём', () => {
    G.players.push(makeHuman(2, 37.5 * TILE, 27.5 * TILE, 0, 'Гость'));
    const tone = new Uint8Array(1600);
    for (let i = 0; i < tone.length; i++) tone[i] = muEncode(0.3 * Math.sin(i / 5));
    at(p, 36, 27);
    Voice.receive({ t: 'vo', s: 2, r: 1, q: 0, d: b64(tone) });
    check('кусок голоса принят и поставлен в очередь', Voice.stats.rx[2] === 1 && Voice.talking(2).talk);
    check('на улице рация слышна', Voice.stats.rxRadio[2] === 1 && Voice.talking(2).radio);
    at(p, 31, 44);
    Voice.receive({ t: 'vo', s: 2, r: 1, q: 1, d: b64(tone) });
    check('в помещении рация не принимается', Voice.stats.rxRadio[2] === 1 && Voice.stats.rx[2] === 2);
    Voice.receive({ t: 'vo', s: G.mySlot, r: 0, q: 2, d: b64(tone) });
    check('свой голос себе не воспроизводится', !Voice.stats.rx[G.mySlot]);
    Voice.update();
    render(1 / 60);
    check('кадр со значками голоса рисуется', true);
  });
  run('отправка пачками (μ-law, когда Opus не у всех)', () => {
    const sent = [], b0 = window.broadcast, role0 = G.role;
    window.broadcast = (pkt) => sent.push(pkt);
    G.role = 'host'; Voice.stream = {}; Voice.muted = false; Voice.useOpus = false;
    at(p, 36, 27); p.dead = false;
    // полсекунды тона кусками по 20 мс (как из AudioWorklet), 48 кГц
    const rate = 48000, blk = 960;
    for (let k = 0; k < 25; k++) {
      const x = new Float32Array(blk);
      for (let i = 0; i < blk; i++) x[i] = 0.3 * Math.sin(((k * blk + i) * 2 * Math.PI * 300) / rate);
      Voice.capture(x, rate);
    }
    Voice.flush();
    const bytes = sent.reduce((s, q) => s + unb64(q.d).length, 0);
    check('0,5 с голоса — 5 сообщений по 100 мс (а не по одному на кусок)', sent.length === 5 && sent.every((q) => !q.f), sent.length);
    check('16 кГц: 8000 отсчётов за 0,5 с', bytes === 8000, bytes);
    sent.length = 0;
    Voice.capture(new Float32Array(blk), rate);        // тишина после фразы: передача ещё идёт (hang), но копится
    Voice.vadUntil = 0;
    Voice.capture(new Float32Array(blk), rate);        // фраза кончилась — остаток уходит сразу
    check('конец фразы — остаток отправлен сразу', sent.length === 1 && unb64(sent[0].d).length === 320, sent.map((q) => unb64(q.d).length));
    window.broadcast = b0; G.role = role0; Voice.stream = null;
  });
  return T_.checks;
})();
