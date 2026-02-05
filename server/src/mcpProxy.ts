import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ChildProcess, spawn } from 'child_process';
import httpLogger from './httpLogger.js';
import {
    getAccessToken,
    getCanonicalResourceUri,
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

class McpProxy {
  private client: Client | null = null;
  private transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport | null = null;
  private childProcess: ChildProcess | null = null;
  private connectionStatus: ConnectionStatus = { connected: false };
  private currentConfig: ServerConfig | null = null;
  private accessToken: string | null = null;
  private pendingAuthUrl: string | null = null;
  private pendingAuthState: string | null = null;

  async connect(config: ServerConfig): Promise<ConnectionStatus> {
    // Disconnect existing connection if any
    await this.disconnect();

    this.currentConfig = config;
    httpLogger.logNotification('connection:start', { config });

    try {
      // For HTTP-based transports with OAuth, check authorization first
      if ((config.type === 'sse' || config.type === 'streamable-http') && config.oauth?.enabled) {
        const oauthResult = await this.checkOAuthAuthorization(config);
        if (oauthResult.authorizationRequired) {
          // Return status indicating authorization is needed
          this.connectionStatus = {
            connected: false,
            oauth: oauthResult,
          };
          wsManager.broadcastConnectionStatus(this.connectionStatus);
          return this.connectionStatus;
        }
      }

      this.client = new Client({
        name: 'mcp-client-ui',
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      // Create transport based on type
      switch (config.type) {
        case 'stdio':
          await this.connectStdio(config);
          break;
        case 'sse':
          await this.connectSSE(config);
          break;
        case 'streamable-http':
          await this.connectStreamableHttp(config);
          break;
        default:
          throw new Error(`Unknown transport type: ${config.type}`);
      }

      // Connect the client
      if (!this.transport) {
        throw new Error('Transport not initialized');
      }

      httpLogger.logRequest('initialize', {});
      await this.client.connect(this.transport);

      // Get server info
      const serverInfo = this.client.getServerVersion();
      const capabilities = this.client.getServerCapabilities();

      // Get OAuth status if applicable
      let oauthStatus: OAuthStatus | undefined;
      if ((config.type === 'sse' || config.type === 'streamable-http') && config.oauth?.enabled && config.url) {
        oauthStatus = await getOAuthStatus(config.url, config.oauth);
      }

      this.connectionStatus = {
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

      httpLogger.logResponse(this.connectionStatus, undefined);
      wsManager.broadcastConnectionStatus(this.connectionStatus);

      return this.connectionStatus;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if this is an OAuth-related error (401/403 or auth-related message)
      // Auto-detect auth errors for HTTP transports even if OAuth wasn't explicitly enabled
      if (config.type === 'sse' || config.type === 'streamable-http') {
        const oauthError = await this.handleOAuthError(error, config);
        if (oauthError) {
          this.connectionStatus = {
            connected: false,
            oauth: oauthError,
            error: errorMessage,
          };
          wsManager.broadcastConnectionStatus(this.connectionStatus);
          return this.connectionStatus;
        }
      }

      this.connectionStatus = {
        connected: false,
        error: errorMessage,
      };

      httpLogger.logError('connection:failed', { error: errorMessage });
      wsManager.broadcastConnectionStatus(this.connectionStatus);

      throw error;
    }
  }

  /**
   * Check OAuth authorization status before connecting
   */
  private async checkOAuthAuthorization(config: ServerConfig): Promise<OAuthStatus> {
    if (!config.url || !config.oauth) {
      return { authenticated: false };
    }

    try {
      // Try to get an existing valid token
      const token = await getAccessToken(config.url, config.oauth);
      if (token) {
        this.accessToken = token;
        return { authenticated: true };
      }

      // No valid token, need authorization
      const result = await handle401Response(config.url, null, config.oauth);
      if (result) {
        this.pendingAuthUrl = result.authorizationUrl;
        this.pendingAuthState = result.state;
        return {
          authenticated: false,
          authorizationRequired: true,
          authorizationUrl: result.authorizationUrl,
        };
      }

      return { authenticated: false, authorizationRequired: true };
    } catch (error) {
      console.error('[McpProxy] OAuth check failed:', error);
      return {
        authenticated: false,
        authorizationRequired: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle OAuth-related errors during connection
   * Auto-detects auth errors and triggers OAuth flow even if OAuth wasn't explicitly enabled
   */
  private async handleOAuthError(error: unknown, config: ServerConfig): Promise<OAuthStatus | null> {
    if (!config.url) {
      return null;
    }

    // Check if this looks like an auth-related error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const is401 = errorMessage.includes('401') || 
                  errorMessage.includes('Unauthorized') ||
                  errorMessage.includes('Authorization header') ||
                  errorMessage.includes('Missing or invalid Authorization');
    const is403 = errorMessage.includes('403') || 
                  errorMessage.includes('Forbidden') || 
                  errorMessage.includes('insufficient_scope');

    // Create a default OAuth config if not provided
    const oauthConfig = config.oauth || {
      enabled: true,
      redirectUri: 'http://localhost:5173/oauth/callback',
    };

    if (is401) {
      try {
        console.log('[McpProxy] Detected auth error, initiating OAuth flow');
        const result = await handle401Response(config.url, null, oauthConfig);
        if (result) {
          this.pendingAuthUrl = result.authorizationUrl;
          this.pendingAuthState = result.state;
          return {
            authenticated: false,
            authorizationRequired: true,
            authorizationUrl: result.authorizationUrl,
          };
        }
      } catch (oauthError) {
        console.error('[McpProxy] Failed to handle 401:', oauthError);
      }
    }

    if (is403) {
      try {
        console.log('[McpProxy] Detected 403 error, initiating OAuth flow with broader scope');
        const result = await handle403Response(config.url, null, oauthConfig);
        this.pendingAuthUrl = result.authorizationUrl;
        this.pendingAuthState = result.state;
        return {
          authenticated: false,
          authorizationRequired: true,
          authorizationUrl: result.authorizationUrl,
        };
      } catch (oauthError) {
        console.error('[McpProxy] Failed to handle 403:', oauthError);
      }
    }

    return null;
  }

  /**
   * Get the pending authorization URL (if any)
   */
  getPendingAuthorizationUrl(): string | null {
    return this.pendingAuthUrl;
  }

  /**
   * Get the pending authorization state (if any)
   */
  getPendingAuthorizationState(): string | null {
    return this.pendingAuthState;
  }

  /**
   * Clear pending authorization
   */
  clearPendingAuthorization(): void {
    this.pendingAuthUrl = null;
    this.pendingAuthState = null;
  }

  /**
   * Revoke OAuth authorization for the current connection
   */
  async revokeOAuth(): Promise<void> {
    if (this.currentConfig?.url && this.currentConfig?.oauth) {
      await revokeAuthorization(this.currentConfig.url, this.currentConfig.oauth);
      this.accessToken = null;
    }
  }

  private async connectStdio(config: ServerConfig): Promise<void> {
    if (!config.command) {
      throw new Error('Command is required for stdio transport');
    }

    const env = { ...process.env, ...config.env };
    
    this.childProcess = spawn(config.command, config.args || [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.childProcess.stderr?.on('data', (data) => {
      const message = data.toString();
      console.error('MCP Server stderr:', message);
      httpLogger.logNotification('server:stderr', { message });
    });

    this.childProcess.on('error', (error) => {
      console.error('MCP Server process error:', error);
      httpLogger.logError('server:process_error', { error: error.message });
    });

    this.childProcess.on('exit', (code, signal) => {
      console.log(`MCP Server process exited with code ${code}, signal ${signal}`);
      httpLogger.logNotification('server:exit', { code, signal });
      this.connectionStatus = { connected: false };
      wsManager.broadcastConnectionStatus(this.connectionStatus);
    });

    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
    });
  }

  private async connectSSE(config: ServerConfig): Promise<void> {
    if (!config.url) {
      throw new Error('URL is required for SSE transport');
    }

    const url = new URL(config.url);
    
    // Build request init with headers (including OAuth if enabled)
    const requestInit: RequestInit = {
      headers: {
        ...config.headers,
      },
    };

    // Add OAuth Bearer token if available
    if (config.oauth?.enabled && this.accessToken) {
      (requestInit.headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
      httpLogger.logNotification('oauth:token_attached', { transport: 'sse' });
    }

    // Note: SSEClientTransport may not support custom headers in all versions
    // If the SDK supports it, pass the requestInit
    this.transport = new SSEClientTransport(url);
  }

  private async connectStreamableHttp(config: ServerConfig): Promise<void> {
    if (!config.url) {
      throw new Error('URL is required for streamable-http transport');
    }

    const url = new URL(config.url);

    // Build request init with headers (including OAuth if enabled)
    const requestInit: RequestInit = {
      headers: {
        ...config.headers,
      },
    };

    // Add OAuth Bearer token if available
    if (config.oauth?.enabled && this.accessToken) {
      (requestInit.headers as Record<string, string>)['Authorization'] = `Bearer ${this.accessToken}`;
      httpLogger.logNotification('oauth:token_attached', { transport: 'streamable-http' });
    }

    // StreamableHTTPClientTransport accepts requestInit in constructor options
    this.transport = new StreamableHTTPClientTransport(url, {
      requestInit,
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        httpLogger.logNotification('connection:close', {});
        await this.client.close();
      } catch (error) {
        console.error('Error closing client:', error);
      }
      this.client = null;
    }

    if (this.childProcess) {
      this.childProcess.kill();
      this.childProcess = null;
    }

    this.transport = null;
    this.connectionStatus = { connected: false };
    this.currentConfig = null;
    this.accessToken = null;
    this.pendingAuthUrl = null;
    this.pendingAuthState = null;
    wsManager.broadcastConnectionStatus(this.connectionStatus);
  }

  /**
   * Get the current configuration
   */
  getCurrentConfig(): ServerConfig | null {
    return this.currentConfig;
  }

  getStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  isConnected(): boolean {
    return this.connectionStatus.connected;
  }

  // Tools
  async listTools(): Promise<Tool[]> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = Date.now();
    httpLogger.logRequest('tools/list', {}, requestId);

    try {
      const result = await this.client.listTools();
      httpLogger.logResponse(result, requestId);
      return result.tools as Tool[];
    } catch (error) {
      httpLogger.logResponse(null, requestId, error);
      throw error;
    }
  }

  async callTool(request: ToolCallRequest): Promise<unknown> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = Date.now();
    httpLogger.logRequest('tools/call', request, requestId);

    try {
      const result = await this.client.callTool({
        name: request.name,
        arguments: request.arguments,
      });
      httpLogger.logResponse(result, requestId);
      return result;
    } catch (error) {
      httpLogger.logResponse(null, requestId, error);
      throw error;
    }
  }

  // Resources
  async listResources(): Promise<Resource[]> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = Date.now();
    httpLogger.logRequest('resources/list', {}, requestId);

    try {
      const result = await this.client.listResources();
      httpLogger.logResponse(result, requestId);
      return result.resources as Resource[];
    } catch (error) {
      httpLogger.logResponse(null, requestId, error);
      throw error;
    }
  }

  async readResource(request: ResourceReadRequest): Promise<unknown> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = Date.now();
    httpLogger.logRequest('resources/read', request, requestId);

    try {
      const result = await this.client.readResource({
        uri: request.uri,
      });
      httpLogger.logResponse(result, requestId);
      return result;
    } catch (error) {
      httpLogger.logResponse(null, requestId, error);
      throw error;
    }
  }

  // Prompts
  async listPrompts(): Promise<Prompt[]> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = Date.now();
    httpLogger.logRequest('prompts/list', {}, requestId);

    try {
      const result = await this.client.listPrompts();
      httpLogger.logResponse(result, requestId);
      return result.prompts as Prompt[];
    } catch (error) {
      httpLogger.logResponse(null, requestId, error);
      throw error;
    }
  }

  async getPrompt(request: PromptGetRequest): Promise<unknown> {
    if (!this.client || !this.isConnected()) {
      throw new Error('Not connected to MCP server');
    }

    const requestId = Date.now();
    httpLogger.logRequest('prompts/get', request, requestId);

    try {
      const result = await this.client.getPrompt({
        name: request.name,
        arguments: request.arguments,
      });
      httpLogger.logResponse(result, requestId);
      return result;
    } catch (error) {
      httpLogger.logResponse(null, requestId, error);
      throw error;
    }
  }
}

export const mcpProxy = new McpProxy();
export default mcpProxy;
