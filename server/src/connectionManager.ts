import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChildProcess, spawn } from 'child_process';
import httpLogger from './httpLogger.js';
import {
    getAccessToken,
    getOAuthStatus,
    handle401Response,
    handle403Response,
    revokeAuthorization,
} from './oauth/index.js';
import type {
    ConnectionStatus,
    OAuthConfig,
    OAuthStatus,
    Prompt,
    PromptGetRequest,
    Resource,
    ResourceReadRequest,
    ServerConfig,
    Tool,
    ToolCallRequest,
} from './types.js';
import wsManager from './websocket.js';

interface ServerConnection {
  id: string;
  client: Client | null;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null;
  childProcess: ChildProcess | null;
  status: ConnectionStatus;
  config: ServerConfig | null;
  accessToken: string | null;
  pendingAuthUrl: string | null;
  pendingAuthState: string | null;
}

class ConnectionManager {
  private connections: Map<string, ServerConnection> = new Map();

  private createEmptyConnection(id: string): ServerConnection {
    return {
      id,
      client: null,
      transport: null,
      childProcess: null,
      status: { connected: false },
      config: null,
      accessToken: null,
      pendingAuthUrl: null,
      pendingAuthState: null,
    };
  }

  private getOrCreateConnection(serverId: string): ServerConnection {
    let conn = this.connections.get(serverId);
    if (!conn) {
      conn = this.createEmptyConnection(serverId);
      this.connections.set(serverId, conn);
    }
    return conn;
  }

  async connect(serverId: string, config: ServerConfig): Promise<ConnectionStatus> {
    // Disconnect existing connection for this server if any
    await this.disconnect(serverId);

    const conn = this.getOrCreateConnection(serverId);
    conn.config = config;
    const serverName = config.url || config.command || serverId;
    const logOptions = { serverId, serverName };
    
    httpLogger.logNotification('connection:start', { config }, logOptions);

    try {
      // For HTTP-based transports with OAuth, check authorization first
      if ((config.type === 'sse' || config.type === 'streamable-http') && config.oauth?.enabled) {
        const oauthResult = await this.checkOAuthAuthorizationForConnection(conn, config);
        if (oauthResult.authorizationRequired) {
          conn.status = {
            connected: false,
            oauth: oauthResult,
          };
          wsManager.broadcastConnectionStatus(conn.status, serverId);
          return conn.status;
        }
      }

      conn.client = new Client({
        name: 'mcp-client-ui',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      // Create transport based on type
      switch (config.type) {
        case 'stdio':
          await this.connectStdio(conn, config);
          break;
        case 'sse':
          await this.connectSSE(conn, config);
          break;
        case 'streamable-http':
          await this.connectStreamableHttp(conn, config);
          break;
        default:
          throw new Error(`Unknown transport type: ${config.type}`);
      }

      // Connect the client
      if (!conn.transport) {
        throw new Error('Transport not initialized');
      }

      httpLogger.logRequest('initialize', {}, undefined, logOptions);
      await conn.client.connect(conn.transport);

      // Get server info
      const serverInfo = conn.client.getServerVersion();
      const capabilities = conn.client.getServerCapabilities();

      // Get OAuth status if applicable
      let oauthStatus: OAuthStatus | undefined;
      if ((config.type === 'sse' || config.type === 'streamable-http') && config.oauth?.enabled && config.url) {
        oauthStatus = await getOAuthStatus(config.url, config.oauth);
      }

      conn.status = {
        connected: true,
        serverInfo: serverInfo ? {
          name: serverInfo.name,
          version: serverInfo.version,
        } : undefined,
        capabilities: {
          tools: !!capabilities?.tools,
          resources: !!capabilities?.resources,
          prompts: !!capabilities?.prompts,
        },
        oauth: oauthStatus,
      };

      httpLogger.logResponse(conn.status, undefined, undefined, logOptions);
      wsManager.broadcastConnectionStatus(conn.status, serverId);

      return conn.status;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if this is an OAuth-related error
      if (config.type === 'sse' || config.type === 'streamable-http') {
        const oauthResult = await this.handleOAuthError(conn, error, config);
        
        // If tokens were refreshed, retry the connection
        if (oauthResult === 'retry') {
          console.log('[ConnectionManager] Retrying connection with refreshed tokens');
          // Disconnect and retry with the updated access token
          await this.disconnectTransport(conn);
          return this.connect(serverId, config);
        }
        
        // If authorization is required, return the OAuth status
        // Don't include error message when OAuth redirect is expected - it's not an error
        if (oauthResult && typeof oauthResult === 'object') {
          conn.status = {
            connected: false,
            oauth: oauthResult,
            // Don't set error when authorization is required - this is expected behavior
          };
          wsManager.broadcastConnectionStatus(conn.status, serverId);
          return conn.status;
        }
      }

      conn.status = {
        connected: false,
        error: errorMessage,
      };

      httpLogger.logError('connection:failed', { error: errorMessage }, logOptions);
      wsManager.broadcastConnectionStatus(conn.status, serverId);

      throw error;
    }
  }

  private async disconnectTransport(conn: ServerConnection): Promise<void> {
    if (conn.transport) {
      try {
        await conn.transport.close();
      } catch (e) {
        // Ignore close errors
      }
      conn.transport = null;
    }
    if (conn.client) {
      try {
        await conn.client.close();
      } catch (e) {
        // Ignore close errors
      }
      conn.client = null;
    }
  }

  private async handleOAuthError(conn: ServerConnection, error: unknown, config: ServerConfig): Promise<OAuthStatus | 'retry' | null> {
    if (!config.url) {
      return null;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const is401 = errorMessage.includes('401') || 
                  errorMessage.includes('Unauthorized') ||
                  errorMessage.includes('Authorization header') ||
                  errorMessage.includes('Missing or invalid Authorization');
    const is403 = errorMessage.includes('403') || 
                  errorMessage.includes('Forbidden') || 
                  errorMessage.includes('insufficient_scope');

    const oauthConfig = config.oauth || {
      enabled: true,
      redirectUri: 'http://localhost:5173/oauth/callback',
    };

    if (is401) {
      try {
        console.log('[ConnectionManager] Detected auth error, initiating OAuth flow');
        const result = await handle401Response(config.url, null, oauthConfig);
        if (result) {
          // Need to redirect user for authorization
          conn.pendingAuthUrl = result.authorizationUrl;
          conn.pendingAuthState = result.state;
          return {
            authenticated: false,
            authorizationRequired: true,
            authorizationUrl: result.authorizationUrl,
          };
        } else {
          // Tokens were refreshed successfully, update the access token and retry
          console.log('[ConnectionManager] Tokens refreshed, updating access token and retrying connection');
          const newToken = await getAccessToken(config.url, oauthConfig);
          if (newToken) {
            conn.accessToken = newToken;
            return 'retry';
          }
        }
      } catch (oauthError) {
        console.error('[ConnectionManager] Failed to handle 401:', oauthError);
      }
    }

    if (is403) {
      try {
        console.log('[ConnectionManager] Detected 403 error, initiating OAuth flow with broader scope');
        const result = await handle403Response(config.url, null, oauthConfig);
        conn.pendingAuthUrl = result.authorizationUrl;
        conn.pendingAuthState = result.state;
        return {
          authenticated: false,
          authorizationRequired: true,
          authorizationUrl: result.authorizationUrl,
        };
      } catch (oauthError) {
        console.error('[ConnectionManager] Failed to handle 403:', oauthError);
      }
    }

    return null;
  }

  private async connectStdio(conn: ServerConnection, config: ServerConfig): Promise<void> {
    if (!config.command) {
      throw new Error('Command is required for stdio transport');
    }

    const env = { ...process.env, ...config.env };
    
    conn.childProcess = spawn(config.command, config.args || [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    conn.childProcess.stderr?.on('data', (data) => {
      const message = data.toString();
      console.error(`MCP Server [${conn.id}] stderr:`, message);
      httpLogger.logNotification('server:stderr', { serverId: conn.id, message });
    });

    conn.childProcess.on('error', (error) => {
      console.error(`MCP Server [${conn.id}] process error:`, error);
      httpLogger.logError('server:process_error', { serverId: conn.id, error: error.message });
    });

    conn.childProcess.on('exit', (code, signal) => {
      console.log(`MCP Server [${conn.id}] process exited with code ${code}, signal ${signal}`);
      httpLogger.logNotification('server:exit', { serverId: conn.id, code, signal });
      conn.status = { connected: false };
      wsManager.broadcastConnectionStatus(conn.status, conn.id);
    });

    conn.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }

  private async connectSSE(conn: ServerConnection, config: ServerConfig): Promise<void> {
    if (!config.url) {
      throw new Error('URL is required for SSE transport');
    }

    const url = new URL(config.url);
    conn.transport = new SSEClientTransport(url);
  }

  private async connectStreamableHttp(conn: ServerConnection, config: ServerConfig): Promise<void> {
    if (!config.url) {
      throw new Error('URL is required for streamable-http transport');
    }

    const url = new URL(config.url);

    const requestInit: RequestInit = {
      headers: {
        ...config.headers,
      },
    };

    // Try to get access token from connection or token manager
    let accessToken = conn.accessToken;
    if (!accessToken && config.url) {
      // Try to get token from token manager (might have been refreshed)
      const oauthConfig = config.oauth || { enabled: true, redirectUri: 'http://localhost:3000/oauth/callback' };
      accessToken = await getAccessToken(config.url, oauthConfig);
      if (accessToken) {
        conn.accessToken = accessToken;
      }
    }

    if (accessToken) {
      (requestInit.headers as Record<string, string>)['Authorization'] = `Bearer ${accessToken}`;
      httpLogger.logNotification('oauth:token_attached', { serverId: conn.id, transport: 'streamable-http' });
    }

    conn.transport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    const serverName = this.getServerName(serverId);
    const logOptions = { serverId, serverName };

    if (conn.client) {
      try {
        httpLogger.logNotification('connection:close', {}, logOptions);
        await conn.client.close();
      } catch (error) {
        console.error(`Error closing client [${serverId}]:`, error);
      }
      conn.client = null;
    }

    if (conn.childProcess) {
      conn.childProcess.kill();
      conn.childProcess = null;
    }

    conn.transport = null;
    conn.status = { connected: false };
    conn.config = null;
    conn.accessToken = null;
    conn.pendingAuthUrl = null;
    conn.pendingAuthState = null;
    wsManager.broadcastConnectionStatus(conn.status, serverId);
  }

  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.connections.keys());
    await Promise.all(serverIds.map(id => this.disconnect(id)));
  }

  getStatus(serverId: string): ConnectionStatus {
    const conn = this.connections.get(serverId);
    return conn?.status || { connected: false };
  }

  getConfig(serverId: string): ServerConfig | null {
    const conn = this.connections.get(serverId);
    return conn?.config || null;
  }

  isConnected(serverId: string): boolean {
    const conn = this.connections.get(serverId);
    return conn?.status.connected || false;
  }

  getConnectedServerIds(): string[] {
    return Array.from(this.connections.entries())
      .filter(([_, conn]) => conn.status.connected)
      .map(([id, _]) => id);
  }

  getPendingAuthorizationUrl(serverId: string): string | null {
    const conn = this.connections.get(serverId);
    return conn?.pendingAuthUrl || null;
  }

  getPendingAuthorizationState(serverId: string): string | null {
    const conn = this.connections.get(serverId);
    return conn?.pendingAuthState || null;
  }

  clearPendingAuthorization(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (conn) {
      conn.pendingAuthUrl = null;
      conn.pendingAuthState = null;
    }
  }

  async revokeOAuth(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (conn?.config?.url && conn?.config?.oauth) {
      await revokeAuthorization(conn.config.url, conn.config.oauth);
      conn.accessToken = null;
    }
  }

  async checkOAuthAuthorization(serverId: string): Promise<OAuthStatus> {
    const conn = this.connections.get(serverId);
    if (!conn?.config) {
      return { authenticated: false };
    }
    return this.checkOAuthAuthorizationForConnection(conn, conn.config);
  }

  private async checkOAuthAuthorizationForConnection(conn: ServerConnection, config: ServerConfig): Promise<OAuthStatus> {
    if (!config.url || !config.oauth) {
      return { authenticated: false };
    }

    try {
      const token = await getAccessToken(config.url, config.oauth);
      if (token) {
        conn.accessToken = token;
        return { authenticated: true };
      }

      const result = await handle401Response(config.url, null, config.oauth);
      if (result) {
        conn.pendingAuthUrl = result.authorizationUrl;
        conn.pendingAuthState = result.state;
        return {
          authenticated: false,
          authorizationRequired: true,
          authorizationUrl: result.authorizationUrl,
        };
      }

      return { authenticated: false, authorizationRequired: true };
    } catch (error) {
      console.error('[ConnectionManager] OAuth check failed:', error);
      return {
        authenticated: false,
        authorizationRequired: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Helper to get server name for logging
  private getServerName(serverId: string): string | undefined {
    const conn = this.connections.get(serverId);
    return conn?.config?.url || conn?.config?.command || serverId;
  }

  /**
   * Build HTTP info for logging, including URL and Authorization header
   */
  private getHttpInfo(conn: ServerConnection): { url?: string; method: string; requestHeaders?: Record<string, string> } {
    const httpInfo: { url?: string; method: string; requestHeaders?: Record<string, string> } = {
      method: 'POST',
    };

    // Add URL if it's an HTTP-based transport
    if (conn.config?.url) {
      httpInfo.url = conn.config.url;
    }

    // Build request headers including Authorization if we have an access token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (conn.accessToken) {
      headers['Authorization'] = `Bearer ${conn.accessToken}`;
    }

    httpInfo.requestHeaders = headers;
    return httpInfo;
  }

  // Tools
  async listTools(serverId: string): Promise<Tool[]> {
    const conn = this.connections.get(serverId);
    if (!conn?.client || !conn.status.connected) {
      throw new Error(`Not connected to MCP server [${serverId}]`);
    }

    const requestId = Date.now();
    const httpInfo = this.getHttpInfo(conn);
    const logOptions = { serverId, serverName: this.getServerName(serverId), http: httpInfo };
    httpLogger.logRequest('tools/list', {}, requestId, logOptions);

    try {
      const result = await conn.client.listTools();
      httpLogger.logResponse(result, requestId, undefined, logOptions);
      return result.tools as Tool[];
    } catch (error) {
      httpLogger.logResponse(null, requestId, error, logOptions);
      throw error;
    }
  }

  async callTool(serverId: string, request: ToolCallRequest): Promise<unknown> {
    const conn = this.connections.get(serverId);
    if (!conn?.client || !conn.status.connected) {
      throw new Error(`Not connected to MCP server [${serverId}]`);
    }

    const requestId = Date.now();
    const httpInfo = this.getHttpInfo(conn);
    const logOptions = { serverId, serverName: this.getServerName(serverId), http: httpInfo };
    httpLogger.logRequest('tools/call', request, requestId, logOptions);

    try {
      const result = await conn.client.callTool({
        name: request.name,
        arguments: request.arguments,
      });
      httpLogger.logResponse(result, requestId, undefined, logOptions);
      return result;
    } catch (error) {
      httpLogger.logResponse(null, requestId, error, logOptions);
      throw error;
    }
  }

  // Resources
  async listResources(serverId: string): Promise<Resource[]> {
    const conn = this.connections.get(serverId);
    if (!conn?.client || !conn.status.connected) {
      throw new Error(`Not connected to MCP server [${serverId}]`);
    }

    const requestId = Date.now();
    const httpInfo = this.getHttpInfo(conn);
    const logOptions = { serverId, serverName: this.getServerName(serverId), http: httpInfo };
    httpLogger.logRequest('resources/list', {}, requestId, logOptions);

    try {
      const result = await conn.client.listResources();
      httpLogger.logResponse(result, requestId, undefined, logOptions);
      return result.resources as Resource[];
    } catch (error) {
      httpLogger.logResponse(null, requestId, error, logOptions);
      throw error;
    }
  }

  async readResource(serverId: string, request: ResourceReadRequest): Promise<unknown> {
    const conn = this.connections.get(serverId);
    if (!conn?.client || !conn.status.connected) {
      throw new Error(`Not connected to MCP server [${serverId}]`);
    }

    const requestId = Date.now();
    const httpInfo = this.getHttpInfo(conn);
    const logOptions = { serverId, serverName: this.getServerName(serverId), http: httpInfo };
    httpLogger.logRequest('resources/read', request, requestId, logOptions);

    try {
      const result = await conn.client.readResource({
        uri: request.uri,
      });
      httpLogger.logResponse(result, requestId, undefined, logOptions);
      return result;
    } catch (error) {
      httpLogger.logResponse(null, requestId, error, logOptions);
      throw error;
    }
  }

  // Prompts
  async listPrompts(serverId: string): Promise<Prompt[]> {
    const conn = this.connections.get(serverId);
    if (!conn?.client || !conn.status.connected) {
      throw new Error(`Not connected to MCP server [${serverId}]`);
    }

    const requestId = Date.now();
    const httpInfo = this.getHttpInfo(conn);
    const logOptions = { serverId, serverName: this.getServerName(serverId), http: httpInfo };
    httpLogger.logRequest('prompts/list', {}, requestId, logOptions);

    try {
      const result = await conn.client.listPrompts();
      httpLogger.logResponse(result, requestId, undefined, logOptions);
      return result.prompts as Prompt[];
    } catch (error) {
      httpLogger.logResponse(null, requestId, error, logOptions);
      throw error;
    }
  }

  async getPrompt(serverId: string, request: PromptGetRequest): Promise<unknown> {
    const conn = this.connections.get(serverId);
    if (!conn?.client || !conn.status.connected) {
      throw new Error(`Not connected to MCP server [${serverId}]`);
    }

    const requestId = Date.now();
    const httpInfo = this.getHttpInfo(conn);
    const logOptions = { serverId, serverName: this.getServerName(serverId), http: httpInfo };
    httpLogger.logRequest('prompts/get', request, requestId, logOptions);

    try {
      const result = await conn.client.getPrompt({
        name: request.name,
        arguments: request.arguments,
      });
      httpLogger.logResponse(result, requestId, undefined, logOptions);
      return result;
    } catch (error) {
      httpLogger.logResponse(null, requestId, error, logOptions);
      throw error;
    }
  }
}

export const connectionManager = new ConnectionManager();
export default connectionManager;
