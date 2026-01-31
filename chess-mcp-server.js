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
        description: 'Get the best move for the current position (simple evaluation)',
        inputSchema: {
          type: 'object',
          properties: {
            game_id: { type: 'string', description: 'Game identifier' },
            depth: { type: 'number', description: 'Search depth (not used in simple eval)' }
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

// Piece values for simple evaluation
const PIECE_VALUES = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000
};

// Simple position evaluation
function evaluatePosition(chess) {
  if (chess.isCheckmate()) {
    return chess.turn() === 'w' ? -Infinity : Infinity;
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
        const value = PIECE_VALUES[piece.type];
        score += piece.color === 'w' ? value : -value;
      }
    }
  }

  return score;
}

// Get best move using simple minimax
function getBestMove(chess, depth = 2) {
  const moves = chess.moves();
  if (moves.length === 0) return null;

  const isMaximizing = chess.turn() === 'w';
  let bestMove = moves[0];
  let bestScore = isMaximizing ? -Infinity : Infinity;

  for (const move of moves) {
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

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of moves) {
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
    for (const move of moves) {
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
      const depth = Math.min(args.depth || 3, 4); // Limit depth for performance
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
