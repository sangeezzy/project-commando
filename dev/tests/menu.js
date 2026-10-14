// Меню и лобби (DOM): без ?autotest игра ждёт в меню; «Играть одному» → лобби → «Готов» → «Начать» → полигон.
window.__result = (() => {
  const { check, run } = T_;
  run('меню', () => {
    leaveToMenu('');
    const vis = (id) => !document.getElementById(id).classList.contains('hidden') && !document.getElementById('menu').classList.contains('hidden');
    check('главное меню на экране', vis('mainMenu'));
    check('есть галочка «заполнять ботами»', !!document.getElementById('botsChk'));
    document.getElementById('botsChk').checked = true;
    document.getElementById('btnSolo').click();
    check('«Играть одному» → лобби', G.state === 'lobby' && vis('lobby'), G.state);
    check('в лобби 4 места', document.querySelectorAll('#slots .slot').length === 4);
    check('пока не нажал «Готов» — начать нельзя', document.getElementById('btnStart').disabled);
    document.getElementById('btnStart').click();
    check('…и не начинается', G.state === 'lobby');
    document.getElementById('btnReady').click();
    check('нажал «Готов» — можно начинать', !document.getElementById('btnStart').disabled);
    document.getElementById('btnStart').click();
    check('«Начать» запускает полигон', G.state === 'play' && document.getElementById('menu').classList.contains('hidden'), G.state);
    check('с галочкой — пустые места заняли боты', G.players.length === 4 && G.players.filter((q) => q.ai).length === 3, G.players.map((q) => q.name));
    render(1 / 60);
    check('кадр рисуется', true);
    // без ботов
    leaveToMenu('');
    document.getElementById('botsChk').checked = false;
    document.getElementById('btnSolo').click();
    document.getElementById('btnReady').click();
    document.getElementById('btnStart').click();
    check('без галочки — один в отряде', G.players.length === 1 && !G.players[0].ai, G.players.length);
    document.getElementById('botsChk').checked = true;
  });
  return T_.checks;
})();
