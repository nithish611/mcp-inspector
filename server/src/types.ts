export type TransportType = 'stdio' | 'sse' | 'streamable-http';

export interface ServerConfig {
  type: TransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** OAuth configuration for HTTP-based transports */
  oauth?: OAuthConfig;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  direction: 'request' | 'response' | 'notification' | 'error';
  method: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  duration?: number;
  requestId?: string | number;
  /** Server identifier for multi-server support */
  serverId?: string;
  /** Server name for display */
  serverName?: string;
  /** HTTP-specific metadata */
  http?: {
    /** HTTP method (GET, POST, etc.) */
    method?: string;
    /** Request URL */
    url?: string;
    /** HTTP status code */
    statusCode?: number;
    /** HTTP status text */
    statusText?: string;
    /** Request headers */
    requestHeaders?: Record<string, string>;
    /** Response headers */
    responseHeaders?: Record<string, string>;
    /** Raw request body */
    requestBody?: string;
    /** Raw response body */
    responseBody?: string;
  };
}

export interface ConnectionStatus {
  connected: boolean;
  serverInfo?: {
    name: string;
    version: string;
  };
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
  error?: string;
  /** OAuth status for HTTP-based connections */
  oauth?: OAuthStatus;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface ToolCallRequest {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ResourceReadRequest {
  uri: string;
}

export interface PromptGetRequest {
  name: string;
  arguments?: Record<string, string>;
}

// ============================================================================
// OAuth Types (RFC 7591, RFC 8414, RFC 9728, OAuth 2.1)
// ============================================================================

/**
 * OAuth configuration for HTTP-based MCP servers
 */
export interface OAuthConfig {
  /** Whether OAuth is enabled for this connection */
  enabled: boolean;
  /** Authorization server issuer URL (optional, can be discovered) */
  issuer?: string;
  /** Pre-registered client ID (optional, uses DCR if not provided) */
  clientId?: string;
  /** Pre-registered client secret (optional, for confidential clients) */
  clientSecret?: string;
  /** Requested OAuth scopes */
  scopes?: string[];
  /** OAuth callback redirect URI */
  redirectUri: string;
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 * Returned from /.well-known/oauth-protected-resource
 */
export interface ProtectedResourceMetadata {
  /** The protected resource identifier */
  resource: string;
  /** List of authorization server issuer URLs */
  authorization_servers: string[];
  /** Scopes supported by this resource */
  scopes_supported?: string[];
  /** Bearer token methods supported */
  bearer_methods_supported?: string[];
  /** Resource signing algorithms supported */
  resource_signing_alg_values_supported?: string[];
  /** Resource documentation URL */
  resource_documentation?: string;
  /** Resource policy URI */
  resource_policy_uri?: string;
  /** Resource terms of service URI */
  resource_tos_uri?: string;
}

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * Returned from /.well-known/oauth-authorization-server
 */
export interface AuthServerMetadata {
  /** Authorization server issuer identifier */
  issuer: string;
  /** URL of the authorization endpoint */
  authorization_endpoint: string;
  /** URL of the token endpoint */
  token_endpoint: string;
  /** URL of the JWKS endpoint */
  jwks_uri?: string;
  /** URL of the dynamic client registration endpoint (RFC 7591) */
  registration_endpoint?: string;
  /** Scopes supported by this authorization server */
  scopes_supported?: string[];
  /** Response types supported */
  response_types_supported?: string[];
  /** Response modes supported */
  response_modes_supported?: string[];
  /** Grant types supported */
  grant_types_supported?: string[];
  /** Token endpoint authentication methods supported */
  token_endpoint_auth_methods_supported?: string[];
  /** Token endpoint authentication signing algorithms */
  token_endpoint_auth_signing_alg_values_supported?: string[];
  /** Service documentation URL */
  service_documentation?: string;
  /** UI locales supported */
  ui_locales_supported?: string[];
  /** Claims parameter supported */
  claims_parameter_supported?: boolean;
  /** Request parameter supported */
  request_parameter_supported?: boolean;
  /** Request URI parameter supported */
  request_uri_parameter_supported?: boolean;
  /** Require request URI registration */
  require_request_uri_registration?: boolean;
  /** PKCE code challenge methods supported */
  code_challenge_methods_supported?: string[];
  /** Revocation endpoint URL */
  revocation_endpoint?: string;
  /** Revocation endpoint auth methods supported */
  revocation_endpoint_auth_methods_supported?: string[];
  /** Introspection endpoint URL */
  introspection_endpoint?: string;
  /** Introspection endpoint auth methods supported */
  introspection_endpoint_auth_methods_supported?: string[];
  /** Whether Client ID Metadata Documents are supported */
  client_id_metadata_document_supported?: boolean;
}

/**
 * Dynamic Client Registration Request (RFC 7591)
 */
export interface DCRRequest {
  /** Array of redirect URIs */
  redirect_uris: string[];
  /** Token endpoint authentication method */
  token_endpoint_auth_method?: string;
  /** Grant types the client will use */
  grant_types?: string[];
  /** Response types the client will use */
  response_types?: string[];
  /** Human-readable client name */
  client_name?: string;
  /** URL of the client's home page */
  client_uri?: string;
  /** URL of the client's logo */
  logo_uri?: string;
  /** Scopes the client will request */
  scope?: string;
  /** Client contacts */
  contacts?: string[];
  /** URL of the client's terms of service */
  tos_uri?: string;
  /** URL of the client's privacy policy */
  policy_uri?: string;
  /** URL of the client's JWKS */
  jwks_uri?: string;
  /** Client's JWKS (inline) */
  jwks?: object;
  /** Software identifier */
  software_id?: string;
  /** Software version */
  software_version?: string;
}

/**
 * Dynamic Client Registration Response (RFC 7591)
 */
export interface DCRResponse {
  /** Unique client identifier */
  client_id: string;
  /** Client secret (for confidential clients) */
  client_secret?: string;
  /** Client secret expiration time (Unix timestamp) */
  client_secret_expires_at?: number;
  /** Client ID issued at time (Unix timestamp) */
  client_id_issued_at?: number;
  /** Registration access token for managing the client */
  registration_access_token?: string;
  /** Registration client URI for managing the client */
  registration_client_uri?: string;
  /** All other fields from the request echoed back */
  redirect_uris?: string[];
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
}

/**
 * OAuth tokens received from token endpoint
 */
export interface OAuthTokens {
  /** Access token for API requests */
  accessToken: string;
  /** Refresh token for obtaining new access tokens */
  refreshToken?: string;
  /** Token type (usually "Bearer") */
  tokenType: string;
  /** Expiration time (Unix timestamp in milliseconds) */
  expiresAt: number;
  /** Granted scopes (space-separated) */
  scope?: string;
}

/**
 * OAuth authorization state (stored during auth flow)
 */
export interface OAuthState {
  /** Random state parameter for CSRF protection */
  state: string;
  /** PKCE code verifier */
  codeVerifier: string;
  /** Redirect URI used in the authorization request */
  redirectUri: string;
  /** MCP server resource URI */
  resourceUri: string;
  /** Authorization server issuer */
  issuer: string;
  /** Creation timestamp */
  createdAt: number;
  /** Requested scopes */
  scopes?: string[];
}

/**
 * Registered OAuth client (cached after DCR)
 */
export interface RegisteredClient {
  /** Client ID */
  clientId: string;
  /** Client secret (encrypted) */
  clientSecret?: string;
  /** Authorization server issuer */
  issuer: string;
  /** MCP server resource URI */
  resourceUri: string;
  /** Registration timestamp */
  registeredAt: number;
  /** Client secret expiration (Unix timestamp) */
  clientSecretExpiresAt?: number;
}

/**
 * OAuth status for the frontend
 */
export interface OAuthStatus {
  /** Whether the user is authenticated */
  authenticated: boolean;
  /** Whether authorization is required */
  authorizationRequired?: boolean;
  /** Authorization URL to redirect to */
  authorizationUrl?: string;
  /** Granted scopes */
  scopes?: string[];
  /** Token expiration time */
  expiresAt?: number;
  /** Error message if any */
  error?: string;
}

/**
 * Parsed WWW-Authenticate header
 */
export interface WwwAuthenticateParams {
  /** Authentication scheme (e.g., "Bearer") */
  scheme: string;
  /** Resource metadata URL */
  resourceMetadata?: string;
  /** Required scopes */
  scope?: string;
  /** Error code */
  error?: string;
  /** Error description */
  errorDescription?: string;
}
