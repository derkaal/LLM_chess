// Chess piece Unicode characters
const PIECES = {
  w: {
    k: '\u2654', // ♔
    q: '\u2655', // ♕
    r: '\u2656', // ♖
    b: '\u2657', // ♗
    n: '\u2658', // ♘
    p: '\u2659', // ♙
  },
  b: {
    k: '\u265A', // ♚
    q: '\u265B', // ♛
    r: '\u265C', // ♜
    b: '\u265D', // ♝
    n: '\u265E', // ♞
    p: '\u265F', // ♟
  }
};

// DOM Elements
const chessboard = document.getElementById('chessboard');
const startBtn = document.getElementById('start-btn');
const gameStatus = document.getElementById('game-status');
const currentTurn = document.getElementById('current-turn');
const whiteStatus = document.getElementById('white-status');
const blackStatus = document.getElementById('black-status');
const illegalCount = document.getElementById('illegal-count');
const illegalMovesList = document.getElementById('illegal-moves-list');
const moveHistory = document.getElementById('move-history');
const resultModal = document.getElementById('result-modal');
const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const totalMoves = document.getElementById('total-moves');
const totalIllegal = document.getElementById('total-illegal');
const closeModal = document.getElementById('close-modal');

// WebSocket connection
let ws = null;
let illegalMoveCount = 0;
let moveCount = 0;
let lastMove = null;

// Initialize the board
function initBoard() {
  chessboard.innerHTML = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const square = document.createElement('div');
      const isWhite = (row + col) % 2 === 0;
      square.className = `square ${isWhite ? 'white' : 'black'}`;
      square.dataset.row = row;
      square.dataset.col = col;
      chessboard.appendChild(square);
    }
  }
}

// Update board with piece positions
function updateBoard(board) {
  const squares = chessboard.querySelectorAll('.square');
  squares.forEach(square => {
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    const piece = board[row][col];

    // Reset classes
    square.classList.remove('last-move', 'highlight');

    if (piece) {
      const pieceClass = piece.color === 'w' ? 'white-piece' : 'black-piece';
      square.innerHTML = `<span class="piece ${pieceClass}">${PIECES[piece.color][piece.type]}</span>`;
    } else {
      square.innerHTML = '';
    }
  });
}

// Highlight last move
function highlightLastMove(from, to) {
  if (!from || !to) return;

  const files = 'abcdefgh';
  const fromCol = files.indexOf(from[0]);
  const fromRow = 8 - parseInt(from[1]);
  const toCol = files.indexOf(to[0]);
  const toRow = 8 - parseInt(to[1]);

  const squares = chessboard.querySelectorAll('.square');
  squares.forEach(square => {
    const row = parseInt(square.dataset.row);
    const col = parseInt(square.dataset.col);
    if ((row === fromRow && col === fromCol) || (row === toRow && col === toCol)) {
      square.classList.add('last-move');
    }
  });
}

// Update player status
function setPlayerStatus(player, status, text) {
  const statusEl = player === 'white' ? whiteStatus : blackStatus;
  statusEl.className = `status-indicator ${status}`;
  statusEl.querySelector('.status-text').textContent = text;
}

// Add move to history
function addMoveToHistory(moveNum, whiteMove, blackMove = null) {
  // Find or create the move row
  let moveRow = moveHistory.querySelector(`[data-move="${moveNum}"]`);

  if (!moveRow) {
    moveRow = document.createElement('div');
    moveRow.className = 'move-row';
    moveRow.dataset.move = moveNum;
    moveRow.innerHTML = `
      <span class="move-number">${moveNum}.</span>
      <span class="move-white"></span>
      <span class="move-black"></span>
    `;
    moveHistory.appendChild(moveRow);
  }

  if (whiteMove) {
    moveRow.querySelector('.move-white').textContent = whiteMove;
  }
  if (blackMove) {
    moveRow.querySelector('.move-black').textContent = blackMove;
  }

  // Scroll to bottom
  moveHistory.scrollTop = moveHistory.scrollHeight;
}

// Add illegal move to log
function addIllegalMove(move, attempt) {
  illegalMoveCount++;
  illegalCount.textContent = illegalMoveCount;

  const li = document.createElement('li');
  li.textContent = `Attempt ${attempt}: ${move}`;
  illegalMovesList.appendChild(li);
  illegalMovesList.scrollTop = illegalMovesList.scrollHeight;
}

// Update current turn display
function setCurrentTurn(player, isWhite) {
  currentTurn.className = `current-turn ${isWhite ? 'white-turn' : 'black-turn'}`;
  currentTurn.textContent = `${player}'s turn`;
}

// Show game result modal
function showResult(result, totalMovesCount, illegalMovesCount) {
  resultMessage.textContent = result;
  totalMoves.textContent = totalMovesCount;
  totalIllegal.textContent = illegalMovesCount;
  resultModal.classList.remove('hidden');
}

// Reset game UI
function resetGame() {
  illegalMoveCount = 0;
  moveCount = 0;
  illegalCount.textContent = '0';
  illegalMovesList.innerHTML = '';
  moveHistory.innerHTML = '';
  currentTurn.textContent = '';
  currentTurn.className = 'current-turn';
  gameStatus.textContent = '';
  setPlayerStatus('white', '', 'Waiting');
  setPlayerStatus('black', '', 'Waiting');
  resultModal.classList.add('hidden');
  initBoard();
}

// Connect to WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);

  ws.onopen = () => {
    console.log('Connected to server');
    gameStatus.textContent = 'Connected. Ready to start!';
    startBtn.disabled = false;
  };

  ws.onclose = () => {
    console.log('Disconnected from server');
    gameStatus.textContent = 'Disconnected. Reconnecting...';
    startBtn.disabled = true;
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    gameStatus.textContent = 'Connection error';
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };
}

// Handle WebSocket messages
function handleMessage(data) {
  console.log('Received:', data.type, data);

  switch (data.type) {
    case 'gameStart':
      resetGame();
      updateBoard(data.board);
      gameStatus.textContent = 'Game started!';
      startBtn.disabled = true;
      startBtn.innerHTML = '<span class="btn-icon">⏳</span> Game in Progress';
      break;

    case 'turnStart':
      setCurrentTurn(data.player, data.isWhite);
      if (data.isWhite) {
        setPlayerStatus('white', 'thinking', 'Thinking...');
        setPlayerStatus('black', '', 'Waiting');
      } else {
        setPlayerStatus('white', '', 'Waiting');
        setPlayerStatus('black', 'thinking', 'Thinking...');
      }
      break;

    case 'moveAttempt':
      gameStatus.textContent = `${data.player} trying: ${data.move}`;
      break;

    case 'moveSuccess':
      updateBoard(data.board);

      // Highlight the move
      if (data.san) {
        const moveNum = Math.ceil(data.moveHistory.length / 2);
        const isWhiteMove = data.moveHistory.length % 2 === 1;

        if (isWhiteMove) {
          addMoveToHistory(moveNum, data.san);
        } else {
          addMoveToHistory(moveNum, null, data.san);
        }
      }

      gameStatus.textContent = `${data.player} played: ${data.san}`;

      // Mark piece as just moved for animation
      const pieces = chessboard.querySelectorAll('.piece');
      pieces.forEach(p => p.classList.remove('just-moved'));
      setTimeout(() => {
        const lastPiece = chessboard.querySelector('.piece:last-of-type');
        if (lastPiece) lastPiece.classList.add('just-moved');
      }, 50);
      break;

    case 'illegalMove':
      if (data.isWhite) {
        addIllegalMove(data.move, data.attempt);
        setPlayerStatus('white', 'error', `Illegal (${data.attempt}/${data.maxAttempts})`);
        gameStatus.textContent = `Pure LLM illegal move: ${data.move} (attempt ${data.attempt}/${data.maxAttempts})`;
      }
      break;

    case 'resignation':
      gameStatus.textContent = `${data.player} resigned: ${data.reason}`;
      break;

    case 'gameOver':
      updateBoard(data.finalBoard);
      gameStatus.textContent = data.result;
      setPlayerStatus('white', '', 'Game Over');
      setPlayerStatus('black', '', 'Game Over');
      currentTurn.textContent = data.result;
      currentTurn.className = 'current-turn';

      // Show result modal
      showResult(data.result, data.totalMoves, data.illegalMoveLog.length);

      startBtn.disabled = false;
      startBtn.innerHTML = '<span class="btn-icon">&#9654;</span> Start New Game';
      break;

    case 'error':
      gameStatus.textContent = `Error: ${data.message}`;
      startBtn.disabled = false;
      startBtn.innerHTML = '<span class="btn-icon">&#9654;</span> Start New Game';
      break;
  }
}

// Event listeners
startBtn.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    resetGame();
    ws.send(JSON.stringify({ type: 'startGame' }));
    startBtn.disabled = true;
    gameStatus.textContent = 'Initializing game...';
  }
});

closeModal.addEventListener('click', () => {
  resultModal.classList.add('hidden');
});

// Initialize
initBoard();
connectWebSocket();
