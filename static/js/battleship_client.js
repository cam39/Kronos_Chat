(() => {
  function cell(x, y) {
    const d = document.createElement('div');
    d.className = 'cell';
    d.dataset.x = String(x);
    d.dataset.y = String(y);
    return d;
  }

  function emptyBoard() {
    const b = [];
    for (let i = 0; i < 10; i++) {
      const r = [];
      for (let j = 0; j < 10; j++) r.push({ s: 0 });
      b.push(r);
    }
    return b;
  }

  function renderBoard(id, board, maskShips) {
    const root = document.getElementById(id);
    if (!root || !Array.isArray(board)) return;
    root.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        const c = cell(i, j);
        const v = board[i][j];
        if (v) {
          if (!maskShips && (v.s === 1 || v.s === 2)) c.classList.add('ship');
          if (v.s === 2) c.classList.add('hit');
          if (v.s === 3) c.classList.add('miss');
        }
        frag.appendChild(c);
      }
    }
    root.appendChild(frag);
  }

  function toast(msg) {
    const el = document.getElementById('bs-toast');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 1400);
  }

  function setStatus(t) {
    const el = document.getElementById('bs-status');
    if (el) el.textContent = t || '';
  }

  const state = { socket: null, code: '', spectator: false, role: null, turn: null, turnId: null, selfId: '', status: '', myBoard: null, oppBoard: null, fleet: [5,4,3,3,2], shipIdx: 0, orient: 'H', preview: [], players: {p1:null,p2:null}, chat: [], lockedPlacement: false };

  function updateReadyButton() {
    const readyBtn = document.getElementById('bs-ready');
    if (!readyBtn) return;
    if (state.spectator) { readyBtn.style.display = 'none'; return; }
    if (state.status === 'waiting') {
      readyBtn.style.display = 'inline-flex';
      const allPlaced = state.shipIdx >= state.fleet.length;
      readyBtn.disabled = !allPlaced;
      readyBtn.classList.toggle('enabled', allPlaced);
    } else {
      readyBtn.style.display = 'none';
    }
  }

  function initMeta() {
    const codeEl = document.getElementById('bs-game-code');
    const spEl = document.getElementById('bs-spectate');
    const selfEl = document.getElementById('bs-self-id');
    state.code = codeEl ? codeEl.value : '';
    state.spectator = !!(spEl && spEl.value);
    state.selfId = selfEl ? selfEl.value : '';
    const show = document.getElementById('bs-code');
    if (show) show.textContent = state.code ? `Code ${state.code}` : '';
  }

  function clearPreviewClasses(root){
    root.querySelectorAll('.cell.ghost').forEach(el => {
      el.classList.remove('ghost'); el.classList.remove('invalid');
    });
  }
  function isValidPlacement(board,x,y,size,orient){
    if (orient==='H'){
      if (y+size-1>9) return false;
      for(let k=0;k<size;k++){ if (board[x][y+k].s!==0) return false; }
    } else {
      if (x+size-1>9) return false;
      for(let k=0;k<size;k++){ if (board[x+k][y].s!==0) return false; }
    }
    return true;
  }
  function applyGhost(root,x,y,size,orient,valid){
    const cells=[];
    for(let k=0;k<size;k++){
      const gx = orient==='H'? x : x+k;
      const gy = orient==='H'? y+k : y;
      const sel = root.querySelector(`.cell[data-x="${gx}"][data-y="${gy}"]`);
      if (sel){ sel.classList.add('ghost'); if(!valid) sel.classList.add('invalid'); cells.push(sel); }
    }
    state.preview = cells;
  }
  function bindPlacement() {
    const mine = document.getElementById('board-p1');
    const readyBtn = document.getElementById('bs-ready');
    if (!mine) return;
    document.addEventListener('keydown', (e)=>{ if (e.key==='r' || e.key==='R'){ state.orient = state.orient==='H'?'V':'H'; }});
    mine.addEventListener('mousemove', (ev) => {
      if (state.spectator) return;
      if (state.lockedPlacement) return;
      if (state.status === 'in_progress') return;
      if (state.shipIdx >= state.fleet.length) return;
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const c = t.closest('.cell'); if (!c) return;
      const x = parseInt(c.getAttribute('data-x')||'0',10);
      const y = parseInt(c.getAttribute('data-y')||'0',10);
      if (!state.myBoard) state.myBoard = emptyBoard();
      clearPreviewClasses(mine);
      const size = state.fleet[state.shipIdx];
      const valid = isValidPlacement(state.myBoard,x,y,size,state.orient);
      applyGhost(mine,x,y,size,state.orient,valid);
    });
    mine.addEventListener('mouseleave', () => {
      clearPreviewClasses(mine);
    });
    mine.addEventListener('click', (ev) => {
      if (state.spectator) return;
      if (state.lockedPlacement) return;
      if (state.status === 'in_progress') return;
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const c = t.closest('.cell'); if (!c) return;
      const x = parseInt(c.getAttribute('data-x')||'0',10);
      const y = parseInt(c.getAttribute('data-y')||'0',10);
      if (!state.myBoard) state.myBoard = emptyBoard();
      if (state.shipIdx >= state.fleet.length) return;
      const size = state.fleet[state.shipIdx];
      const valid = isValidPlacement(state.myBoard,x,y,size,state.orient);
      if (!valid){ toast('Placement invalide'); return; }
      for(let k=0;k<size;k++){
        const gx = state.orient==='H'? x : x+k;
        const gy = state.orient==='H'? y+k : y;
        state.myBoard[gx][gy].s = 1;
      }
      state.shipIdx += 1;
      renderBoard('board-p1', state.myBoard, false);
      clearPreviewClasses(mine);
      updateReadyButton();
    });
    if (readyBtn){
      readyBtn.addEventListener('click', ()=>{
        if (!state.myBoard) return;
        if (state.shipIdx < state.fleet.length) return;
        if (!state.socket) return;
        const fleet = boardToFleet(state.myBoard);
        readyBtn.disabled = true; // éviter double-clic
        state.lockedPlacement = true; // verrouiller le placement
        // Cacher immédiatement après clic une fois cliquable
        readyBtn.style.display = 'none';
        state.socket.emit('bs_place', { code: state.code, board: state.myBoard });
        state.socket.emit('player_ready', { game_id: state.code, player_id: state.selfId, fleet_array: fleet }, (resp)=>{
          if (!resp || !resp.ok){
            // En cas d'échec, ré-afficher et re-désactiver
            state.lockedPlacement = false;
            updateReadyButton();
            toast((resp && resp.error) || 'Erreur lors du prêt');
          } else {
            toast('Prêt envoyé, en attente de l’adversaire');
          }
        });
      });
    }
  }

  function boardToFleet(board){
    const coords = [];
    for (let i=0;i<10;i++){
      for (let j=0;j<10;j++){
        const cell = board[i][j];
        if (cell && cell.s === 1){
          coords.push([i,j]);
        }
      }
    }
    return [{ ship_type:'fleet', coords }];
  }

  function bindFire() {
    const opp = document.getElementById('board-p2');
    if (!opp) return;
    opp.addEventListener('click', (ev) => {
      if (state.spectator) return;
      if (state.status !== 'in_progress') return;
      const t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      const c = t.closest('.cell');
      if (!c) return;
      if (!state.turnId || state.turnId !== state.selfId) return;
      const x = c.getAttribute('data-x');
      const y = c.getAttribute('data-y');
      if (x == null || y == null) return;
      state.socket.emit('bs_fire', { code: state.code, x: parseInt(x, 10), y: parseInt(y, 10) });
    });
  }

  function bindRematch() {
    const btn = document.getElementById('bs-rematch');
    if (btn) btn.addEventListener('click', () => {
      state.socket.emit('bs_rematch', { code: state.code });
    });
  }

  function connect() {
    const s = io({ transports: ['polling', 'websocket'], reconnection: true });
    state.socket = s;
    s.on('connect', () => {
      s.emit('bs_join', { code: state.code, spectator: state.spectator });
    });
    s.on('bs_identity', (p) => {
      if (!p || p.code !== state.code) return;
      const p1n = document.getElementById('p1-name');
      const p2n = document.getElementById('p2-name');
      const p1a = document.getElementById('p1-avatar');
      const p2a = document.getElementById('p2-avatar');
      if (p.left){
        if (p1n) p1n.textContent = p.left.display_name || p.left.username || 'Joueur';
        if (p1a) p1a.src = p.left.avatar || '/static/icons/default_avatar.svg';
      }
      if (p.right){
        if (p2n) p2n.textContent = p.right.display_name || p.right.username || 'Joueur';
        if (p2a) p2a.src = p.right.avatar || '/static/icons/default_avatar.svg';
      }
    });
    s.on('bs_start', (p) => {
      if (!p || p.code !== state.code) return;
      state.status = 'in_progress';
      state.turnId = p.turn_id || state.turnId || null;
      updateReadyButton();
      const statusEl = document.getElementById('bs-status');
       const hintEl = document.getElementById('bs-hint');
      if (hintEl) hintEl.style.display = 'none';
      if (statusEl) {
        const myTurn = state.turnId && state.turnId === state.selfId;
        statusEl.classList.toggle('my-turn', !!myTurn);
        if (myTurn) setStatus("C'EST À TOI DE JOUER"); else setStatus("ATTENTE DE L'ADVERSAIRE");
      }
    });
    s.on('bs_state', (p) => {
      if (!p || p.code !== state.code) return;
      state.turn = p.turn || null;
      state.turnId = p.turn_id || null;
      state.status = p.status || '';
      updateReadyButton();
      const hintEl = document.getElementById('bs-hint');
      if (hintEl) hintEl.style.display = (p.status === 'waiting' && !state.spectator) ? 'block' : 'none';
      state.players = { p1: p.p1 || null, p2: p.p2 || null };
      const p1 = state.players.p1;
      const p2 = state.players.p2;
      if (state.selfId && p1 && p1.id === state.selfId) {
        state.role = 'p1';
      } else if (state.selfId && p2 && p2.id === state.selfId) {
        state.role = 'p2';
      } else {
        state.role = 'spec';
      }
      const statusEl = document.getElementById('bs-status');
      if (statusEl) {
        const myTurn = p.status === 'in_progress' && p.turn_id && p.turn_id === state.selfId;
        statusEl.classList.toggle('my-turn', myTurn);
        if (p.status === 'in_progress') {
          if (myTurn) {
            setStatus("C'EST À TOI DE JOUER");
          } else {
            let name = '';
            if (p.turn_id && state.players.p1 && p.turn_id === state.players.p1.id) {
              name = state.players.p1.display_name || state.players.p1.username || '';
            } else if (p.turn_id && state.players.p2 && p.turn_id === state.players.p2.id) {
              name = state.players.p2.display_name || state.players.p2.username || '';
            }
            setStatus(name ? `Attente de ${name}` : "ATTENTE DE L'ADVERSAIRE");
          }
        } else {
          setStatus(p.status_label);
        }
      } else {
        setStatus(p.status_label);
      }
      const p1n = document.getElementById('p1-name');
      const p2n = document.getElementById('p2-name');
      const p1a = document.getElementById('p1-avatar');
      const p2a = document.getElementById('p2-avatar');
      const p1User = state.players.p1;
      const p2User = state.players.p2;
      let me = null;
      let opp = null;
      if (state.role === 'p1') {
        me = p1User;
        opp = p2User;
      } else if (state.role === 'p2') {
        me = p2User;
        opp = p1User;
      }
      if (p1n){ p1n.textContent = me ? (me.display_name || me.username || 'Joueur') : 'Joueur'; }
      if (p2n){ p2n.textContent = opp ? (opp.display_name || opp.username || 'Joueur') : 'Joueur'; }
      if (p1a){ p1a.src = (me && me.avatar) ? me.avatar : '/static/icons/default_avatar.svg'; }
      if (p2a){ p2a.src = (opp && opp.avatar) ? opp.avatar : '/static/icons/default_avatar.svg'; }
      const p1wrap = document.getElementById('p1-info');
      const p2wrap = document.getElementById('p2-info');
      const myTurnNow = p.status === 'in_progress' && p.turn_id && p.turn_id === state.selfId;
      const oppTurnNow = p.status === 'in_progress' && p.turn_id && p.turn_id !== state.selfId;
      p1wrap && p1wrap.classList.toggle('turn', !!myTurnNow);
      p2wrap && p2wrap.classList.toggle('turn', !!oppTurnNow);
      if (state.role === 'spec') {
        if (p.status === 'in_progress'){
          renderBoard('board-p1', p.p1_board, false);
          renderBoard('board-p2', p.p2_board, false);
        } else {
          renderBoard('board-p1', emptyBoard(), false);
          renderBoard('board-p2', emptyBoard(), false);
        }
      } else {
        if (p.status === 'waiting') {
          if (!state.myBoard) state.myBoard = emptyBoard();
          renderBoard('board-p1', state.myBoard, false);
          renderBoard('board-p2', emptyBoard(), true);
        } else {
          let my = Array.isArray(state.myBoard) ? state.myBoard : emptyBoard();
          let opp = Array.isArray(state.oppBoard) ? state.oppBoard : emptyBoard();
          if (state.role === 'p1') {
            if (Array.isArray(p.p1_board)) my = p.p1_board;
            if (Array.isArray(p.p2_board)) opp = p.p2_board;
          } else if (state.role === 'p2') {
            if (Array.isArray(p.p2_board)) my = p.p2_board;
            if (Array.isArray(p.p1_board)) opp = p.p1_board;
          }
          state.myBoard = my;
          state.oppBoard = opp;
          renderBoard('board-p1', my, false);
          renderBoard('board-p2', opp, true);
        }
      }
      if (p.winner) {
        toast(p.winner === state.role ? 'Victoire' : 'Défaite');
        const r = document.getElementById('bs-rematch');
        if (r) r.style.display = 'inline-flex';
        // clear ephemeral chat at end of game
        const cm = document.getElementById('bs-chat-messages');
        state.chat = [];
        if (cm) cm.innerHTML = '';
      }
    });
    s.on('fire_result', (p) => {
      if (!p || p.code !== state.code) return;
      const meShooter = p.from && p.from === state.role;
      const sx = Number(p.x), sy = Number(p.y);
      if (state.role !== 'spec') {
        if (meShooter) {
          if (!Array.isArray(state.oppBoard)) state.oppBoard = emptyBoard();
          state.oppBoard[sx][sy].s = (p.hit === 'hit') ? 2 : 3;
          renderBoard('board-p2', state.oppBoard, true);
        } else {
          const root = document.getElementById('board-p1');
          if (root) {
            const sel = root.querySelector(`.cell[data-x="${p.x}"][data-y="${p.y}"]`);
            if (sel) {
              sel.classList.remove('hit','miss');
              sel.classList.add(p.hit === 'hit' ? 'hit' : 'miss');
              if (p.hit === 'hit') sel.classList.add('ship');
            }
          }
          if (Array.isArray(state.myBoard) && state.myBoard[sx] && state.myBoard[sx][sy]) {
            state.myBoard[sx][sy].s = (p.hit === 'hit') ? 2 : 3;
          }
        }
      } else {
        const root = document.getElementById('board-p2');
        if (root) {
          const sel = root.querySelector(`.cell[data-x="${p.x}"][data-y="${p.y}"]`);
          if (sel) {
            sel.classList.remove('hit','miss');
            sel.classList.add(p.hit === 'hit' ? 'hit' : 'miss');
          }
        }
      }
      if (meShooter) {
        toast(p.hit === 'hit' ? 'Touché' : 'Manqué');
      } else if (state.role !== 'spec') {
        toast(p.hit === 'hit' ? 'Ton navire est touché' : 'Tir adverse manqué');
      }
    });
    s.on('bs_error', (e) => toast(e && e.message ? e.message : 'Erreur'));
    s.on('bs_chat', (m) => {
      if (!m || m.code !== state.code) return;
      state.chat.push(m);
      const cm = document.getElementById('bs-chat-messages');
      if (!cm) return;
      const line = document.createElement('div');
      line.className = 'chat-line';
      const sender = document.createElement('span');
      sender.className = 'sender';
      sender.textContent = (m.user && (m.user.display_name || m.user.username)) ? (m.user.display_name || m.user.username) + ':' : 'Joueur:';
      const text = document.createElement('span');
      text.textContent = ' ' + (m.message || '');
      line.appendChild(sender);
      line.appendChild(text);
      cm.appendChild(line);
      cm.scrollTop = cm.scrollHeight;
    });
  }

  function start() {
    initMeta();
    renderBoard('board-p1', emptyBoard(), false);
    renderBoard('board-p2', emptyBoard(), true);
    bindPlacement();
    bindFire();
    bindRematch();
    const ci = document.getElementById('bs-chat-input');
    if (ci){
      ci.addEventListener('keydown', (e)=>{
        if (e.key === 'Enter'){
          const v = ci.value.trim();
          if (!v) return;
          if (state.spectator) return;
          if (state.socket){
            state.socket.emit('bs_chat', { code: state.code, message: v });
          }
          ci.value = '';
        }
      });
      if (state.spectator) ci.disabled = true;
    }
    connect();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
