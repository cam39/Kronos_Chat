// Minimal overlay to enable PvP via Socket.IO without rebuilding the TS bundle
(function () {
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function getParam(name) {
    const m = new RegExp('[?&]' + name + '=([^&]+)').exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  const code = getParam('code');
  if (!code || !window.io) return;

  const socket = io({ transports: ['polling','websocket'], reconnection: true });
  let myTurn = false;
  let opponentPresent = true;
  let lastShot = { x: -1, y: -1, t: 0 };

  function setOpponentLabel() {
    const label = qs('.computerLabel');
    if (label) label.textContent = 'Opponent';
  }

  function cellFrom(containerSel, x, y) {
    const cont = qs(containerSel);
    if (!cont) return null;
    return qs(`.cell[data-x="${x}"][data-y="${y}"]`, cont);
  }

  function countRemainingShipsOnPlayer() {
    const playerCont = qs('.playerBoardContainer');
    if (!playerCont) return 0;
    // ship cells rendered with class 'ship' or 'blue'
    const shipCells = qsa('.board-container .cell.ship, .board-container .cell.blue', playerCont);
    const hitCells = qsa('.board-container .cell.hit', playerCont);
    // Count a cell as remaining if it's ship/blue and not marked hit
    const remaining = shipCells.filter(c => !c.classList.contains('hit')).length;
    return remaining;
  }

  function applyDefenseShot(x, y) {
    const cell = cellFrom('.playerBoardContainer', x, y);
    if (!cell) return { outcome: 'miss', game_over: false };
    const isShip = cell.classList.contains('ship') || cell.classList.contains('blue');
    if (isShip) {
      cell.classList.remove('empty');
      cell.classList.add('hit');
    } else {
      cell.classList.add('miss');
    }
    const remaining = countRemainingShipsOnPlayer();
    const gameOver = remaining === 0;
    return { outcome: isShip ? 'hit' : 'miss', game_over: gameOver };
  }

  function applyAttackResult(x, y, outcome) {
    const cell = cellFrom('.computerBoardContainer', x, y);
    if (!cell) return;
    if (outcome === 'hit') {
      cell.classList.add('hit');
    } else {
      cell.classList.add('miss');
    }
  }

  function enableTurn(enable) {
    myTurn = enable;
    const cont = qs('.computerBoardContainer');
    if (!cont) return;
    cont.style.pointerEvents = enable ? 'auto' : 'none';
    cont.style.opacity = enable ? '1' : '0.75';
  }

  // Intercept clicks on opponent board BEFORE bundle's listener
  document.addEventListener('click', function (ev) {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const cell = target.closest('.computerBoardContainer .cell');
    if (!cell) return;
    if (!opponentPresent) {
      return;
    }
    ev.stopImmediatePropagation();
    ev.preventDefault();
    if (!myTurn) return;
    const x = parseInt(cell.getAttribute('data-x') || '0', 10);
    const y = parseInt(cell.getAttribute('data-y') || '0', 10);
    enableTurn(false);
    lastShot = { x, y, t: Date.now() };
    socket.emit('bship_fire', { code, x, y });
  }, true);

  socket.on('connect', function () {
    socket.emit('game_join', { code, spectator: false });
    setOpponentLabel();
    // Start turns arbitrarily: creator plays first; server does not reveal that here,
    // so we let the first client to open page wait for result until first bship_result arrives.
    // As a heuristic, enable turn after short delay if no opponent action.
    setTimeout(function(){ enableTurn(true); }, 1500);
  });

  socket.on('bship_fire', function (payload) {
    if (!payload || payload.code !== code) return;
    if (lastShot.x === payload.x && lastShot.y === payload.y && Date.now() - lastShot.t < 1200) {
      // It's our own echo; ignore
      return;
    }
    // Ignore our own fire events
    // Server includes from_user_id; we can't access current id here; accept all and rely on turn gating.
    // If the shot targets us, apply on player board and respond
    const x = payload.x, y = payload.y;
    const result = applyDefenseShot(x, y);
    socket.emit('bship_result', { code, x, y, outcome: result.outcome, game_over: result.game_over });
    if (!result.game_over) {
      enableTurn(true);
    } else {
      alert('Défaite: tous vos navires sont coulés.');
    }
  });

  socket.on('bship_result', function (payload) {
    if (!payload || payload.code !== code) return;
    applyAttackResult(payload.x, payload.y, payload.outcome);
    if (payload.game_over) {
      alert('Victoire!');
      return;
    }
    // Opponent played back; our turn resumes on result
    enableTurn(true);
  });

  socket.on('bship_opponent_left', function (payload) {
    if (!payload || payload.code !== code) return;
    opponentPresent = false;
    enableTurn(false);
    alert("L'adversaire a quitté la partie. Passage en mode contre l'ordinateur.");
  });

  socket.on('bship_opponent_joined', function (payload) {
    if (!payload || payload.code !== code) return;
    opponentPresent = true;
    // Reprendre le mode PvP; on réactivera le tour dès réception d'événements
    setOpponentLabel();
  });
})(); 
