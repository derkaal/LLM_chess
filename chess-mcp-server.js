import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { Chess } from 'chess.js';

// Store active games
const games = new Map();

const server = new Server({
  name: 'chess-mcp-server',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

// Register tools list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'new_game',
        description: 'Create a new chess game',
        inputSchema: {
          type: 'object',
          properties: {
            game_id: { type: 'string', description: 'Unique game identifier' }
          },
          required: ['game_id']
        }
      },
      {
        name: 'get_legal_moves',
        description: 'Get all legal moves for the current position',
        inputSchema: {
          type: 'object',
          properties: {
            game_id: { type: 'string', description: 'Game identifier' }
          },
          required: ['game_id']
        }
      },
      {
        name: 'make_move',
        description: 'Make a move in the game',
        inputSchema: {
          type: 'object',
          properties: {
            game_id: { type: 'string', description: 'Game identifier' },
            move: { type: 'string', description: 'Move in algebraic notation' }
          },
          required: ['game_id', 'move']
        }
      },
      {
        name: 'get_best_move',
        description: 'Get the best move for the current position',
        inputSchema: {
          type: 'object',
          properties: {
            game_id: { type: 'string', description: 'Game identifier' },
            depth: { type: 'number', description: 'Search depth' }
          },
          required: ['game_id']
        }
      },
      {
        name: 'get_board',
        description: 'Get the current board state',
        inputSchema: {
          type: 'object',
          properties: {
            game_id: { type: 'string', description: 'Game identifier' }
          },
          required: ['game_id']
        }
      }
    ]
  };
});

// Piece values
const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
};

// Piece-square tables (from White's perspective, flip for Black)
// These encourage pieces to go to good squares
const PST = {
  p: [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5,  5, 10, 25, 25, 10,  5,  5],
    [0,  0,  0, 20, 20,  0,  0,  0],
    [5, -5,-10,  0,  0,-10, -5,  5],
    [5, 10, 10,-20,-20, 10, 10,  5],
    [0,  0,  0,  0,  0,  0,  0,  0]
  ],
  n: [
    [-50,-40,-30,-30,-30,-30,-40,-50],
    [-40,-20,  0,  0,  0,  0,-20,-40],
    [-30,  0, 10, 15, 15, 10,  0,-30],
    [-30,  5, 15, 20, 20, 15,  5,-30],
    [-30,  0, 15, 20, 20, 15,  0,-30],
    [-30,  5, 10, 15, 15, 10,  5,-30],
    [-40,-20,  0,  5,  5,  0,-20,-40],
    [-50,-40,-30,-30,-30,-30,-40,-50]
  ],
  b: [
    [-20,-10,-10,-10,-10,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0, 10, 10, 10, 10,  0,-10],
    [-10,  5,  5, 10, 10,  5,  5,-10],
    [-10,  0,  5, 10, 10,  5,  0,-10],
    [-10,  5,  5,  5,  5,  5,  5,-10],
    [-10,  5,  0,  0,  0,  0,  5,-10],
    [-20,-10,-10,-10,-10,-10,-10,-20]
  ],
  r: [
    [0,  0,  0,  0,  0,  0,  0,  0],
    [5, 10, 10, 10, 10, 10, 10,  5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [-5,  0,  0,  0,  0,  0,  0, -5],
    [0,  0,  0,  5,  5,  0,  0,  0]
  ],
  q: [
    [-20,-10,-10, -5, -5,-10,-10,-20],
    [-10,  0,  0,  0,  0,  0,  0,-10],
    [-10,  0,  5,  5,  5,  5,  0,-10],
    [-5,  0,  5,  5,  5,  5,  0, -5],
    [0,  0,  5,  5,  5,  5,  0, -5],
    [-10,  5,  5,  5,  5,  5,  0,-10],
    [-10,  0,  5,  0,  0,  0,  0,-10],
    [-20,-10,-10, -5, -5,-10,-10,-20]
  ],
  k: [
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-30,-40,-40,-50,-50,-40,-40,-30],
    [-20,-30,-30,-40,-40,-30,-30,-20],
    [-10,-20,-20,-20,-20,-20,-20,-10],
    [20, 20,  0,  0,  0,  0, 20, 20],
    [20, 30, 10,  0,  0, 10, 30, 20]
  ]
};

// Get piece-square value
function getPST(piece, row, col) {
  const table = PST[piece.type];
  if (!table) return 0;

  // Flip row for black pieces (they see the board from the other side)
  const r = piece.color === 'w' ? row : 7 - row;
  return table[r][col];
}

// Evaluate position with piece-square tables
function evaluatePosition(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -99999 : 99999;
  }
  if (chess.isDraw()) {
    return 0;
  }

  let score = 0;
  const board = chess.board();

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece) {
        // Material value
        const materialValue = PIECE_VALUES[piece.type];
        // Positional value from piece-square tables
        const positionalValue = getPST(piece, row, col);

        const totalValue = materialValue + positionalValue;
        score += piece.color === 'w' ? totalValue : -totalValue;
      }
    }
  }

  // Bonus for having more mobility (more legal moves = better position)
  const currentTurn = chess.turn();
  const mobility = chess.moves().length;
  score += currentTurn === 'w' ? mobility * 2 : -mobility * 2;

  return score;
}

// Order moves to improve alpha-beta pruning
function orderMoves(chess, moves) {
  const scored = moves.map(move => {
    let score = 0;
    const moveObj = chess.move(move);

    // Captures are good to check first
    if (moveObj.captured) {
      score += 10 * PIECE_VALUES[moveObj.captured] - PIECE_VALUES[moveObj.piece];
    }
    // Promotions are very important
    if (moveObj.promotion) {
      score += PIECE_VALUES[moveObj.promotion];
    }
    // Checks are important
    if (chess.isCheck()) {
      score += 50;
    }

    chess.undo();
    return { move, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.move);
}

// Get best move using minimax with alpha-beta pruning
function getBestMove(chess, depth = 3) {
  const moves = chess.moves();
  if (moves.length === 0) return null;

  // Order moves for better pruning
  const orderedMoves = orderMoves(chess, moves);

  const isMaximizing = chess.turn() === 'w';
  let bestMove = orderedMoves[0];
  let bestScore = isMaximizing ? -Infinity : Infinity;

  for (const move of orderedMoves) {
    chess.move(move);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, !isMaximizing);
    chess.undo();

    if (isMaximizing) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }
  }

  return bestMove;
}

function minimax(chess, depth, alpha, beta, isMaximizing) {
  if (depth === 0 || chess.isGameOver()) {
    return evaluatePosition(chess);
  }

  const moves = chess.moves();

  // Simple move ordering for better pruning
  const orderedMoves = moves.length > 10 ? orderMoves(chess, moves) : moves;

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of orderedMoves) {
      chess.move(move);
      const score = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break;
    }
    return maxScore;
  } else {
    let minScore = Infinity;
    for (const move of orderedMoves) {
      chess.move(move);
      const score = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      minScore = Math.min(minScore, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break;
    }
    return minScore;
  }
}

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'new_game': {
      const chess = new Chess();
      games.set(args.game_id, chess);
      return {
        content: [{ type: 'text', text: `New game created with ID: ${args.game_id}` }]
      };
    }

    case 'get_legal_moves': {
      const chess = games.get(args.game_id);
      if (!chess) {
        return {
          content: [{ type: 'text', text: 'Game not found' }],
          isError: true
        };
      }
      const moves = chess.moves();
      return {
        content: [{ type: 'text', text: moves.join(', ') }]
      };
    }

    case 'make_move': {
      const chess = games.get(args.game_id);
      if (!chess) {
        return {
          content: [{ type: 'text', text: 'Game not found' }],
          isError: true
        };
      }
      try {
        const result = chess.move(args.move);
        if (result) {
          return {
            content: [{ type: 'text', text: `Move ${result.san} played successfully` }]
          };
        } else {
          return {
            content: [{ type: 'text', text: `Invalid move: ${args.move}` }],
            isError: true
          };
        }
      } catch (e) {
        return {
          content: [{ type: 'text', text: `Invalid move: ${args.move}` }],
          isError: true
        };
      }
    }

    case 'get_best_move': {
      const chess = games.get(args.game_id);
      if (!chess) {
        return {
          content: [{ type: 'text', text: 'Game not found' }],
          isError: true
        };
      }
      // Use depth 3 for reasonable speed and quality
      const depth = Math.min(args.depth || 3, 3);
      const bestMove = getBestMove(chess, depth);
      return {
        content: [{ type: 'text', text: bestMove || 'No moves available' }]
      };
    }

    case 'get_board': {
      const chess = games.get(args.game_id);
      if (!chess) {
        return {
          content: [{ type: 'text', text: 'Game not found' }],
          isError: true
        };
      }
      return {
        content: [{ type: 'text', text: chess.ascii() }]
      };
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true
      };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Chess MCP Server running on stdio');
}

main().catch(console.error);
