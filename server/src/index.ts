import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import { createServer } from 'http';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import connectionManager from './connectionManager.js';
import httpLogger from './httpLogger.js';
import {
    clearAllTokens,
    clearRegisteredClients,
    getAllRegisteredClients,
    getOAuthStatus,
    handleAuthCallback,
    initializeOAuth,
    initiateAuthFlow,
    revokeAuthorization,
} from './oauth/index.js';
import type {
    OAuthConfig,
    PromptGetRequest,
    ResourceReadRequest,
    ServerConfig,
    ToolCallRequest,
} from './types.js';
import wsManager from './websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize OAuth module with encryption key from environment
const OAUTH_ENCRYPTION_KEY = process.env.AUTH_ENCRYPTION_SECRET || process.env.OAUTH_ENCRYPTION_KEY;
initializeOAuth(OAUTH_ENCRYPTION_KEY);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Default OAuth redirect URI - uses the same port the server is running on
const DEFAULT_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Connection endpoints
app.post('/api/connect', async (req: Request, res: Response) => {
  try {
    const { serverId, ...config } = req.body as ServerConfig & { serverId?: string };
    
    if (!config.type) {
      res.status(400).json({ error: 'Transport type is required' });
      return;
    }

    // Use provided serverId or generate a default one
    const id = serverId || 'default';
    const status = await connectionManager.connect(id, config);
    res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection failed';
    res.status(500).json({ error: message });
  }
});

app.post('/api/disconnect', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.body as { serverId?: string };
    const id = serverId || 'default';
    await connectionManager.disconnect(id);
    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Disconnect failed';
    res.status(500).json({ error: message });
  }
});

app.get('/api/status', (req: Request, res: Response) => {
  const serverId = (req.query.serverId as string) || 'default';
  res.json(connectionManager.getStatus(serverId));
});

// Get all connected servers
app.get('/api/servers/connected', (_req: Request, res: Response) => {
  res.json({ serverIds: connectionManager.getConnectedServerIds() });
});

// Tools endpoints
app.get('/api/tools', async (req: Request, res: Response) => {
  try {
    const serverId = (req.query.serverId as string) || 'default';
    const tools = await connectionManager.listTools(serverId);
    res.json({ tools });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list tools';
    res.status(500).json({ error: message });
  }
});

app.post('/api/tools/call', async (req: Request, res: Response) => {
  try {
    const { serverId, ...request } = req.body as ToolCallRequest & { serverId?: string };
    
    if (!request.name) {
      res.status(400).json({ error: 'Tool name is required' });
      return;
    }

    const id = serverId || 'default';
    const result = await connectionManager.callTool(id, request);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool call failed';
    res.status(500).json({ error: message });
  }
});

// Resources endpoints
app.get('/api/resources', async (req: Request, res: Response) => {
  try {
    const serverId = (req.query.serverId as string) || 'default';
    const resources = await connectionManager.listResources(serverId);
    res.json({ resources });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list resources';
    res.status(500).json({ error: message });
  }
});

app.post('/api/resources/read', async (req: Request, res: Response) => {
  try {
    const { serverId, ...request } = req.body as ResourceReadRequest & { serverId?: string };
    
    if (!request.uri) {
      res.status(400).json({ error: 'Resource URI is required' });
      return;
    }

    const id = serverId || 'default';
    const result = await connectionManager.readResource(id, request);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Resource read failed';
    res.status(500).json({ error: message });
  }
});

// Prompts endpoints
app.get('/api/prompts', async (req: Request, res: Response) => {
  try {
    const serverId = (req.query.serverId as string) || 'default';
    const prompts = await connectionManager.listPrompts(serverId);
    res.json({ prompts });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list prompts';
    res.status(500).json({ error: message });
  }
});

app.post('/api/prompts/get', async (req: Request, res: Response) => {
  try {
    const { serverId, ...request } = req.body as PromptGetRequest & { serverId?: string };
    
    if (!request.name) {
      res.status(400).json({ error: 'Prompt name is required' });
      return;
    }

    const id = serverId || 'default';
    const result = await connectionManager.getPrompt(id, request);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Prompt get failed';
    res.status(500).json({ error: message });
  }
});

// Logs endpoints
app.get('/api/logs', (_req: Request, res: Response) => {
  res.json({ logs: httpLogger.getLogs() });
});

app.delete('/api/logs', (_req: Request, res: Response) => {
  httpLogger.clearLogs();
  res.json({ success: true });
});

// ============================================================================
// OAuth Endpoints
// ============================================================================

/**
 * Initiate OAuth authorization flow
 * POST /api/oauth/authorize
 * Body: { serverUrl: string, scopes?: string[], clientId?: string, clientSecret?: string }
 */
app.post('/api/oauth/authorize', async (req: Request, res: Response) => {
  try {
    const { serverUrl, scopes, clientId, clientSecret, redirectUri } = req.body;

    if (!serverUrl) {
      res.status(400).json({ error: 'Server URL is required' });
      return;
    }

    const oauthConfig: OAuthConfig = {
      enabled: true,
      scopes,
      clientId,
      clientSecret,
      redirectUri: redirectUri || DEFAULT_REDIRECT_URI,
    };

    httpLogger.logNotification('oauth:authorize_start', { serverUrl, scopes });

    const result = await initiateAuthFlow(serverUrl, oauthConfig);

    httpLogger.logNotification('oauth:authorize_url_generated', { 
      serverUrl,
      state: result.state,
    });

    res.json({
      authorizationUrl: result.authorizationUrl,
      state: result.state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authorization initiation failed';
    httpLogger.logError('oauth:authorize_failed', { error: message });
    res.status(500).json({ error: message });
  }
});

/**
 * Handle OAuth callback (exchange code for tokens)
 * GET /api/oauth/callback?code=...&state=...
 * Redirects to frontend with success or error
 */
app.get('/api/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Handle OAuth error response
    if (error) {
      const errorMsg = error_description || error;
      httpLogger.logError('oauth:callback_error', { error: errorMsg });
      res.redirect(`/?oauth_error=${encodeURIComponent(String(errorMsg))}`);
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    httpLogger.logNotification('oauth:callback_received', { state });

    // Note: The state contains the serverId, which is handled by handleAuthCallback
    const oauthConfig: OAuthConfig = {
      enabled: true,
      redirectUri: DEFAULT_REDIRECT_URI,
    };

    const tokens = await handleAuthCallback(
      String(code),
      String(state),
      oauthConfig
    );

    httpLogger.logNotification('oauth:tokens_received', {
      expiresAt: tokens.expiresAt,
      hasRefreshToken: !!tokens.refreshToken,
      scope: tokens.scope,
    });

    // Redirect to frontend with success
    res.redirect('/?oauth_success=true');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange failed';
    httpLogger.logError('oauth:callback_failed', { error: message });
    res.redirect(`/?oauth_error=${encodeURIComponent(message)}`);
  }
});

/**
 * Handle OAuth callback via POST (alternative for SPAs)
 * POST /api/oauth/callback
 * Body: { code: string, state: string }
 */
app.post('/api/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, redirectUri, clientId, clientSecret, scopes } = req.body;

    if (!code || !state) {
      res.status(400).json({ error: 'Missing code or state parameter' });
      return;
    }

    httpLogger.logNotification('oauth:callback_received', { state });

    const oauthConfig: OAuthConfig = {
      enabled: true,
      clientId,
      clientSecret,
      scopes,
      redirectUri: redirectUri || DEFAULT_REDIRECT_URI,
    };

    const tokens = await handleAuthCallback(code, state, oauthConfig);

    httpLogger.logNotification('oauth:tokens_received', {
      expiresAt: tokens.expiresAt,
      hasRefreshToken: !!tokens.refreshToken,
      scope: tokens.scope,
    });

    res.json({
      success: true,
      expiresAt: tokens.expiresAt,
      scope: tokens.scope,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Token exchange failed';
    httpLogger.logError('oauth:callback_failed', { error: message });
    res.status(500).json({ error: message });
  }
});

/**
 * Get OAuth status for a server
 * GET /api/oauth/status?serverUrl=...&serverId=...
 */
app.get('/api/oauth/status', async (req: Request, res: Response) => {
  try {
    const { serverUrl, serverId } = req.query;

    if (!serverUrl) {
      res.status(400).json({ error: 'Server URL is required' });
      return;
    }

    const id = (serverId as string) || 'default';
    const config = connectionManager.getConfig(id);
    const oauthConfig: OAuthConfig = {
      enabled: true,
      clientId: config?.oauth?.clientId,
      clientSecret: config?.oauth?.clientSecret,
      scopes: config?.oauth?.scopes,
      redirectUri: config?.oauth?.redirectUri || DEFAULT_REDIRECT_URI,
    };

    const status = await getOAuthStatus(String(serverUrl), oauthConfig);
    res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get OAuth status';
    res.status(500).json({ error: message });
  }
});

/**
 * Revoke OAuth authorization for a server
 * POST /api/oauth/revoke
 * Body: { serverUrl: string, serverId?: string }
 */
app.post('/api/oauth/revoke', async (req: Request, res: Response) => {
  try {
    const { serverUrl, serverId } = req.body;

    if (!serverUrl) {
      res.status(400).json({ error: 'Server URL is required' });
      return;
    }

    const id = serverId || 'default';
    const config = connectionManager.getConfig(id);
    const oauthConfig: OAuthConfig = {
      enabled: true,
      clientId: config?.oauth?.clientId,
      clientSecret: config?.oauth?.clientSecret,
      scopes: config?.oauth?.scopes,
      redirectUri: config?.oauth?.redirectUri || DEFAULT_REDIRECT_URI,
    };

    httpLogger.logNotification('oauth:revoke_start', { serverUrl, serverId: id });

    await revokeAuthorization(serverUrl, oauthConfig);

    httpLogger.logNotification('oauth:revoke_complete', { serverUrl, serverId: id });

    res.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to revoke authorization';
    httpLogger.logError('oauth:revoke_failed', { error: message });
    res.status(500).json({ error: message });
  }
});

/**
 * Get registered OAuth clients (for debugging/admin)
 * GET /api/oauth/clients
 */
app.get('/api/oauth/clients', (_req: Request, res: Response) => {
  const clients = getAllRegisteredClients();
  res.json({ clients });
});

/**
 * Clear all OAuth data (tokens and registered clients)
 * DELETE /api/oauth/clear
 */
app.delete('/api/oauth/clear', (_req: Request, res: Response) => {
  clearAllTokens();
  clearRegisteredClients();
  httpLogger.logNotification('oauth:cleared', {});
  res.json({ success: true });
});

// ============================================================================
// Static File Serving (Production)
// ============================================================================

// In production, serve the built client files
const isProduction = process.env.NODE_ENV === 'production';

// Determine client directory path
// When running from dist/server/index.js, client is at dist/client
// When running in dev, client is at ../client/dist
let clientDistPath = join(__dirname, '..', 'client');

// Fallback paths for different scenarios
const fallbackPaths = [
  join(__dirname, '..', 'client'),           // dist/server -> dist/client
  join(__dirname, '..', '..', 'client', 'dist'), // server/dist -> client/dist
  join(__dirname, '..', '..', 'dist', 'client'), // server/src -> dist/client
];

for (const fallbackPath of fallbackPaths) {
  if (existsSync(join(fallbackPath, 'index.html'))) {
    clientDistPath = fallbackPath;
    break;
  }
}

if (isProduction || existsSync(join(clientDistPath, 'index.html'))) {
  console.log(`📁 Serving static files from: ${clientDistPath}`);
  
  // Serve static files
  app.use(express.static(clientDistPath));
  
  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req: Request, res: Response) => {
    // Don't serve index.html for API routes or WebSocket
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Create HTTP server and initialize WebSocket
const server = createServer(app);
wsManager.initialize(server);

// Start server
server.listen(PORT, () => {
  console.log(`🚀 MCP Client Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server available at ws://localhost:${PORT}/ws`);
  if (isProduction || existsSync(join(clientDistPath, 'index.html'))) {
    console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await connectionManager.disconnectAll();
  wsManager.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('\nShutting down...');
  await connectionManager.disconnectAll();
  wsManager.close();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
