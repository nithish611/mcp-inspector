# MCP Client

A modern, feature-rich Model Context Protocol (MCP) client with a beautiful UI, comprehensive HTTP logging, and OAuth 2.1 support.

![MCP Client](https://img.shields.io/npm/v/@nithish611/mcp-inspector)
![License](https://img.shields.io/npm/l/@nithish611/mcp-inspector)
![Node](https://img.shields.io/node/v/@nithish611/mcp-inspector)

## Features

- 🎨 **Beautiful Modern UI** - Clean, Postman-like interface for interacting with MCP servers
- 🔐 **OAuth 2.1 Support** - Full OAuth 2.1 with PKCE and Dynamic Client Registration (DCR)
- 📡 **Multiple Server Connections** - Connect to and manage multiple MCP servers simultaneously
- 📝 **Comprehensive Logging** - View detailed HTTP request/response logs with headers
- 🛠️ **Tools, Resources & Prompts** - Full support for all MCP capabilities
- 🔍 **Search & Filter** - Quickly find servers and tools
- 💾 **Persistent State** - Remembers your server configurations and tool inputs
- ⌨️ **Keyboard Shortcuts** - Execute tools with Cmd+Enter

## Installation

### Using npx (Recommended)

```bash
npx @nithish611/mcp-inspector
```

### Global Installation

```bash
npm install -g @nithish611/mcp-inspector
mcp-client
```

### From Source

```bash
git clone https://github.com/nithish611/mcp-inspector.git
cd mcp-inspector
npm install
npm run build
npm start
```

## Usage

### Basic Usage

```bash
# Start on default port 3000
mcp-client

# Start on a custom port
mcp-client --port 8080
mcp-client -p 4000
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <number>` | Port to run the server on | 3000 |
| `-h, --help` | Show help message | - |
| `-v, --version` | Show version number | - |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (overridden by --port flag) |
| `OAUTH_ENCRYPTION_KEY` | Encryption key for OAuth tokens |
| `AUTH_ENCRYPTION_SECRET` | Alternative encryption key for OAuth tokens |
| `OAUTH_REDIRECT_URI` | OAuth redirect URI |

## Connecting to MCP Servers

### HTTP/SSE Servers

1. Click "Add" to add a new server
2. Enter a name and the server URL
3. For OAuth-protected servers, enable OAuth and configure scopes
4. Click "Connect"

### Stdio Servers

1. Click "Add" to add a new server
2. Select "Stdio" transport type
3. Enter the command and arguments
4. Click "Connect"

## OAuth 2.1 Support

MCP Client supports OAuth 2.1 with:

- **PKCE** (Proof Key for Code Exchange) for enhanced security
- **Dynamic Client Registration** (RFC 7591) for automatic client setup
- **Protected Resource Metadata** (RFC 9728) for server discovery
- **Authorization Server Metadata** (RFC 8414) for auth server discovery

### Connecting to OAuth-Protected Servers

1. Add a new server with the MCP server URL
2. Enable OAuth in the server configuration
3. (Optional) Add custom scopes
4. Click "Connect" - you'll be redirected to the authorization server
5. After authorization, you'll be redirected back and connected

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0

### Setup

```bash
# Install dependencies
npm install

# Start development servers (client + server with hot reload)
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Project Structure

```
mcp-client/
├── bin/              # CLI entry point
├── client/           # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── components/   # UI components
│   │   ├── hooks/        # React hooks
│   │   ├── stores/       # Zustand stores
│   │   └── lib/          # Utilities
│   └── ...
├── server/           # Express backend (TypeScript)
│   ├── src/
│   │   ├── oauth/        # OAuth 2.1 implementation
│   │   └── ...
│   └── ...
├── scripts/          # Build scripts
└── dist/             # Production build output
```

## API Reference

The server exposes the following API endpoints:

### Connection

- `POST /api/connect` - Connect to an MCP server
- `POST /api/disconnect` - Disconnect from an MCP server
- `GET /api/status` - Get connection status
- `GET /api/servers/connected` - List connected servers

### MCP Operations

- `GET /api/tools` - List available tools
- `POST /api/tools/call` - Execute a tool
- `GET /api/resources` - List available resources
- `POST /api/resources/read` - Read a resource
- `GET /api/prompts` - List available prompts
- `POST /api/prompts/get` - Get a prompt

### OAuth

- `POST /api/oauth/authorize` - Initiate OAuth flow
- `GET /api/oauth/callback` - OAuth callback handler
- `GET /api/oauth/status` - Get OAuth status
- `POST /api/oauth/revoke` - Revoke authorization

### Logs

- `GET /api/logs` - Get all logs
- `DELETE /api/logs` - Clear logs

### WebSocket

- `ws://localhost:PORT/ws` - Real-time updates

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- Built with [Model Context Protocol](https://modelcontextprotocol.io/)
- UI powered by [React](https://react.dev/), [Tailwind CSS](https://tailwindcss.com/), and [shadcn/ui](https://ui.shadcn.com/)
- Code editor by [Monaco Editor](https://microsoft.github.io/monaco-editor/)
