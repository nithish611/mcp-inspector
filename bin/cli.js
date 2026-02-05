#!/usr/bin/env node

import { spawn } from 'child_process';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    port: 3000,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '-p' || arg === '--port') {
      const port = parseInt(args[++i], 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        options.port = port;
      } else {
        console.error(`Invalid port number: ${args[i]}`);
        process.exit(1);
      }
    } else if (arg.startsWith('--port=')) {
      const port = parseInt(arg.split('=')[1], 10);
      if (!isNaN(port) && port > 0 && port < 65536) {
        options.port = port;
      } else {
        console.error(`Invalid port number: ${arg.split('=')[1]}`);
        process.exit(1);
      }
    }
  }

  return options;
}

function showHelp() {
  console.log(`
MCP Client - A modern Model Context Protocol client with OAuth 2.1 support

Usage:
  mcp-client [options]
  npx @nithish6112/mcp-inspector [options]

Options:
  -p, --port <number>  Port to run the server on (default: 3000)
  -h, --help           Show this help message
  -v, --version        Show version number

Examples:
  mcp-client                    # Start on default port 3000
  mcp-client --port 8080        # Start on port 8080
  mcp-client -p 4000            # Start on port 4000

Environment Variables:
  PORT                    Server port (overridden by --port flag)
  OAUTH_ENCRYPTION_KEY    Encryption key for OAuth tokens
  AUTH_ENCRYPTION_SECRET  Alternative encryption key for OAuth tokens

After starting, open your browser to http://localhost:<port> to use the client.
`);
}

async function showVersion() {
  try {
    const packagePath = join(__dirname, '..', 'package.json');
    const { default: pkg } = await import(packagePath, { assert: { type: 'json' } });
    console.log(`mcp-client v${pkg.version}`);
  } catch {
    // Fallback for Node versions that don't support import assertions
    const { readFileSync } = await import('fs');
    const packagePath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packagePath, 'utf-8'));
    console.log(`mcp-client v${pkg.version}`);
  }
}

async function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  if (options.version) {
    await showVersion();
    process.exit(0);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : options.port;

  // Check if port is available
  const portAvailable = await checkPortAvailable(port);
  if (!portAvailable) {
    console.error(`❌ Port ${port} is already in use.`);
    console.error(`   Try a different port with: mcp-client --port <number>`);
    process.exit(1);
  }

  // Path to the server entry point
  const serverPath = join(__dirname, '..', 'dist', 'server', 'index.js');

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🔧 MCP Client - Model Context Protocol Inspector           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

  console.log(`Starting server on http://localhost:${port}...`);

  // Start the server
  const serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
    },
    stdio: 'inherit',
  });

  serverProcess.on('error', (err) => {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });

  serverProcess.on('exit', (code) => {
    process.exit(code || 0);
  });

  // Handle graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    serverProcess.kill('SIGTERM');
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
