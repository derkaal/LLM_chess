# LLM Chess Battle - MCP Demo

A visual demonstration of the power of Model Context Protocol (MCP) through a chess battle between two LLM players.

## Players

- **Pure LLM (White)**: Uses only the Anthropic API with direct prompting. No tools, no validation - just raw LLM reasoning. This player may make illegal moves.

- **MCP Player (Black)**: Uses the Anthropic API combined with chess move validation and engine assistance. This player always plays valid moves.

## Features

- Real-time visual chessboard with move animations
- Dark theme optimized for screen recording
- Move history tracking
- Illegal move attempt counter and log
- Automatic game progression with viewing delays
- Professional UI for presentations

## Prerequisites

- Node.js 18+
- Anthropic API key

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your Anthropic API key:
```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

3. Start the server:
```bash
npm start
```

4. Open your browser to `http://localhost:3000`

5. Click "Start New Game" to watch the battle!

## Technical Stack

- **Backend**: Node.js, Express, WebSocket (ws), @anthropic-ai/sdk, @modelcontextprotocol/sdk, chess.js
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **AI**: Claude Sonnet 4 via Anthropic API

## How It Works

1. The Pure LLM player receives the board position and must reason about legal moves without any tools
2. The MCP player receives validated legal moves and optional engine recommendations
3. When the Pure LLM makes an illegal move, it gets up to 3 retry attempts
4. All moves are validated using chess.js before being applied to the board
5. The game continues until checkmate, draw, or a player fails to make a valid move

## License

MIT
