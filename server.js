import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { Chess } from 'chess.js';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Game state
let currentGame = null;
let gameInProgress = false;

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// MCP Client for chess server
let mcpClient = null;
let mcpTransport = null;

// Broadcast to all connected clients
function broadcast(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// MCP connection status
let mcpAvailable = false;

// Initialize MCP client connection to chess server
async function initializeMCPClient() {
  try {
    console.log('Initializing MCP Chess Server connection...');

    mcpClient = new Client({
      name: 'chess-battle-client',
      version: '1.0.0'
    }, {
      capabilities: {}
    });

    // Create transport with local chess MCP server
    mcpTransport = new StdioClientTransport({
      command: 'node',
      args: [join(__dirname, 'chess-mcp-server.js')]
    });

    await mcpClient.connect(mcpTransport);

    // List available tools
    const tools = await mcpClient.listTools();
    console.log('MCP Chess Server connected. Available tools:', tools.tools.map(t => t.name));
    mcpAvailable = true;

    return true;
  } catch (error) {
    console.error('Failed to initialize MCP client:', error.message);
    console.log('MCP features will be limited - using fallback chess.js validation');
    mcpAvailable = false;
    return false;
  }
}

// Pure LLM Player (White) - No tools, just raw prompting
async function getPureLLMMove(chess, moveHistory, illegalAttempts = []) {
  const board = chess.ascii();
  const fen = chess.fen();
  const legalMoves = chess.moves();

  let prompt = `You are playing chess as White. You must respond with ONLY a chess move in standard algebraic notation (like e4, Nf3, Bxc6, O-O, etc).

Current board position:
${board}

FEN: ${fen}

Move history: ${moveHistory.length > 0 ? moveHistory.join(', ') : 'Game just started'}

It is your turn (White). Analyze the position and make your best move.`;

  if (illegalAttempts.length > 0) {
    prompt += `

WARNING: Your previous move attempts were ILLEGAL: ${illegalAttempts.join(', ')}
Please try a different, LEGAL move. Think carefully about which pieces you have and where they can legally go.`;
  }

  prompt += `

Respond with ONLY the move in algebraic notation (e.g., "e4" or "Nf3" or "Bxc6"). No explanation, no other text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }]
    });

    const moveText = response.content[0].text.trim();
    // Extract just the move, removing any extra text
    const moveMatch = moveText.match(/^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?|O-O-O|O-O|0-0-0|0-0)[\+#]?/i);
    return moveMatch ? moveMatch[0] : moveText.split(/\s/)[0];
  } catch (error) {
    console.error('Pure LLM error:', error);
    throw error;
  }
}

// MCP-enabled Player (Black) - Uses Chess MCP server for assistance
async function getMCPPlayerMove(chess, moveHistory, gameId) {
  const board = chess.ascii();
  const fen = chess.fen();
  const chessLegalMoves = chess.moves();

  try {
    // Try to get engine recommendation from MCP if available
    if (mcpAvailable && mcpClient) {
      try {
        // Get best move from engine - use it directly if available
        const bestMoveResult = await mcpClient.callTool({
          name: 'get_best_move',
          arguments: { game_id: gameId, depth: 10 }
        });

        if (bestMoveResult.content && bestMoveResult.content[0]) {
          const engineMove = bestMoveResult.content[0].text.trim();
          // Verify it's a legal move and use it directly
          if (chessLegalMoves.includes(engineMove)) {
            console.log(`MCP Player using engine move: ${engineMove}`);
            return engineMove;
          }
        }
      } catch (e) {
        console.log('Could not get best move from MCP:', e.message);
      }
    }

    // Fallback: Use LLM with validated legal moves if MCP engine move not available
    const prompt = `You are playing chess as Black. Choose the strongest move.

Current board position:
${board}

FEN: ${fen}

Move history: ${moveHistory.length > 0 ? moveHistory.join(', ') : 'Game just started'}

Legal moves: ${chessLegalMoves.join(', ')}

Choose the best move from the legal moves list. Respond with ONLY the move. No explanation.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }]
    });

    let moveText = response.content[0].text.trim();
    const moveMatch = moveText.match(/^([KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](=[QRBN])?|O-O-O|O-O|0-0-0|0-0)[\+#]?/i);
    moveText = moveMatch ? moveMatch[0] : moveText.split(/\s/)[0];

    // Validate the move
    if (chessLegalMoves.includes(moveText)) {
      return moveText;
    }

    // Fallback to first legal move
    return chessLegalMoves[0];
  } catch (error) {
    console.error('MCP Player error:', error);
    return chess.moves()[0];
  }
}

// Game controller
async function runGame() {
  if (gameInProgress) {
    broadcast({ type: 'error', message: 'Game already in progress' });
    return;
  }

  gameInProgress = true;
  const chess = new Chess();
  const moveHistory = [];
  const illegalMoveLog = [];
  let mcpGameId = 'game_' + Date.now();

  broadcast({
    type: 'gameStart',
    board: chess.board(),
    fen: chess.fen(),
    ascii: chess.ascii()
  });

  // Initialize a new game on the MCP server if available
  if (mcpAvailable && mcpClient) {
    try {
      await mcpClient.callTool({
        name: 'new_game',
        arguments: { game_id: mcpGameId }
      });
      console.log('New MCP game created:', mcpGameId);
    } catch (e) {
      console.log('Could not create new MCP game:', e.message);
      mcpAvailable = false;
    }
  }

  // Game loop
  while (!chess.isGameOver()) {
    const isWhiteTurn = chess.turn() === 'w';
    const player = isWhiteTurn ? 'Pure LLM (White)' : 'MCP Player (Black)';

    broadcast({
      type: 'turnStart',
      player,
      isWhite: isWhiteTurn,
      board: chess.board(),
      fen: chess.fen()
    });

    // Add delay for viewing
    await new Promise(resolve => setTimeout(resolve, 1500));

    let move = null;
    let attempts = 0;
    const maxAttempts = 3;
    const illegalAttempts = [];

    let proposedMove = null;
    while (!move && attempts < maxAttempts) {
      try {

        if (isWhiteTurn) {
          // Pure LLM player (White)
          proposedMove = await getPureLLMMove(chess, moveHistory, illegalAttempts);
        } else {
          // MCP-enabled player (Black)
          proposedMove = await getMCPPlayerMove(chess, moveHistory, mcpGameId);
        }

        broadcast({
          type: 'moveAttempt',
          player,
          move: proposedMove,
          attempt: attempts + 1
        });

        // Try to make the move
        const result = chess.move(proposedMove);

        if (result) {
          move = result;
          moveHistory.push(proposedMove);

          // Sync move with MCP server if available
          if (mcpAvailable && mcpClient) {
            try {
              await mcpClient.callTool({
                name: 'make_move',
                arguments: { game_id: mcpGameId, move: proposedMove }
              });
            } catch (e) {
              console.log('Could not sync move with MCP:', e.message);
            }
          }

          broadcast({
            type: 'moveSuccess',
            player,
            move: proposedMove,
            san: result.san,
            board: chess.board(),
            fen: chess.fen(),
            moveHistory: [...moveHistory]
          });
        } else {
          throw new Error('Invalid move');
        }
      } catch (error) {
        attempts++;
        const attemptedMove = proposedMove || error.message || 'unknown';
        illegalAttempts.push(attemptedMove);

        if (isWhiteTurn) {
          illegalMoveLog.push({
            turn: moveHistory.length + 1,
            player: 'Pure LLM (White)',
            attemptedMove: attemptedMove,
            attempt: attempts
          });
        }

        broadcast({
          type: 'illegalMove',
          player,
          move: attemptedMove,
          attempt: attempts,
          maxAttempts,
          isWhite: isWhiteTurn
        });

        // Small delay before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // If no valid move after max attempts, resign
    if (!move) {
      broadcast({
        type: 'resignation',
        player,
        reason: `Failed to make a legal move after ${maxAttempts} attempts`
      });
      break;
    }

    // Delay between moves
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Game over
  let result = 'Unknown';
  let winner = null;

  if (chess.isCheckmate()) {
    winner = chess.turn() === 'w' ? 'MCP Player (Black)' : 'Pure LLM (White)';
    result = `Checkmate! ${winner} wins!`;
  } else if (chess.isDraw()) {
    if (chess.isStalemate()) {
      result = 'Draw by stalemate';
    } else if (chess.isThreefoldRepetition()) {
      result = 'Draw by threefold repetition';
    } else if (chess.isInsufficientMaterial()) {
      result = 'Draw by insufficient material';
    } else {
      result = 'Draw by 50-move rule';
    }
  }

  broadcast({
    type: 'gameOver',
    result,
    winner,
    moveHistory,
    illegalMoveLog,
    totalMoves: moveHistory.length,
    finalBoard: chess.board(),
    finalFen: chess.fen(),
    pgn: chess.pgn()
  });

  gameInProgress = false;
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'startGame') {
        if (!mcpClient) {
          const initialized = await initializeMCPClient();
          if (!initialized) {
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Failed to initialize MCP Chess Server. Make sure you have npx available.'
            }));
            return;
          }
        }
        runGame();
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Start server
server.listen(PORT, async () => {
  console.log(`Chess Battle server running on http://localhost:${PORT}`);
  console.log('Waiting for client connection to start game...');

  // Pre-initialize MCP client
  await initializeMCPClient();
});
