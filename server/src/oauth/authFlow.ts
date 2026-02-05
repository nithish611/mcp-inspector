/**
 * OAuth Authorization Flow Orchestration
 * Coordinates the complete OAuth 2.1 flow with DCR and PKCE
 */

import fs from 'fs';
import path from 'path';
import type {
    AuthServerMetadata,
    OAuthConfig,
    OAuthState,
    OAuthStatus,
    OAuthTokens,
    ProtectedResourceMetadata,
} from '../types.js';
import { getRegisteredClient, registerClient } from './dcr.js';
import {
    discoverAuthServerMetadata,
    discoverProtectedResourceMetadata,
    getCanonicalResourceUri,
    parseWwwAuthenticateHeader,
    supportsDcr,
    verifyPkceSupport,
} from './discovery.js';
import { generatePkcePair, generateState, selectPkceMethod } from './pkce.js';
import {
    exchangeCodeForTokens,
    getTokens,
    getValidAccessToken,
    hasValidTokens,
    removeTokens,
    revokeTokens,
    storeTokens,
} from './tokenManager.js';

// File-based storage for OAuth states to survive server restarts
const STATES_FILE = path.join(process.cwd(), '.oauth-states.json');

// In-memory storage for OAuth states (pending authorization flows)
const pendingStates = new Map<string, OAuthState>();

// State TTL (10 minutes)
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Load states from file on startup
 */
function loadStatesFromFile(): void {
  try {
    if (fs.existsSync(STATES_FILE)) {
      const data = fs.readFileSync(STATES_FILE, 'utf-8');
      const states = JSON.parse(data) as Record<string, OAuthState>;
      const now = Date.now();
      
      for (const [state, oauthState] of Object.entries(states)) {
        // Only load non-expired states
        if (now - oauthState.createdAt <= STATE_TTL_MS) {
          pendingStates.set(state, oauthState);
        }
      }
      
      console.log(`[AuthFlow] Loaded ${pendingStates.size} pending OAuth states from file`);
    }
  } catch (error) {
    console.log('[AuthFlow] Could not load states from file:', error);
  }
}

/**
 * Save states to file
 */
function saveStatesToFile(): void {
  try {
    const states: Record<string, OAuthState> = {};
    for (const [state, oauthState] of pendingStates.entries()) {
      states[state] = oauthState;
    }
    fs.writeFileSync(STATES_FILE, JSON.stringify(states, null, 2));
  } catch (error) {
    console.log('[AuthFlow] Could not save states to file:', error);
  }
}

// Load states on module initialization
loadStatesFromFile();

// Cached metadata per resource
const resourceMetadataCache = new Map<string, {
  protectedResource: ProtectedResourceMetadata;
  authServer: AuthServerMetadata;
}>();

/**
 * Clean up expired states
 */
function cleanupExpiredStates(): void {
  const now = Date.now();
  let deleted = false;
  for (const [state, data] of pendingStates.entries()) {
    if (now - data.createdAt > STATE_TTL_MS) {
      pendingStates.delete(state);
      deleted = true;
    }
  }
  if (deleted) {
    saveStatesToFile();
  }
}

/**
 * Get or discover metadata for a resource
 */
async function getMetadata(
  serverUrl: string,
  resourceMetadataUrl?: string
): Promise<{
  protectedResource: ProtectedResourceMetadata;
  authServer: AuthServerMetadata;
}> {
  const resourceUri = getCanonicalResourceUri(serverUrl);
  
  // Check cache first
  const cached = resourceMetadataCache.get(resourceUri);
  if (cached) {
    return cached;
  }

  // Discover protected resource metadata
  const protectedResource = await discoverProtectedResourceMetadata(serverUrl, resourceMetadataUrl);

  // Get the first authorization server (per RFC 9728, client chooses)
  const issuer = protectedResource.authorization_servers[0];
  if (!issuer) {
    throw new Error('No authorization server found in Protected Resource Metadata');
  }

  // Discover authorization server metadata
  const authServer = await discoverAuthServerMetadata(issuer);

  // Verify PKCE support
  const pkceSupported = verifyPkceSupport(authServer);
  if (!pkceSupported) {
    console.warn('[AuthFlow] Authorization server may not support PKCE - proceeding anyway');
  }

  // Cache the metadata
  const metadata = { protectedResource, authServer };
  resourceMetadataCache.set(resourceUri, metadata);

  return metadata;
}

/**
 * Get or register a client for the authorization server
 */
async function getOrRegisterClient(
  authServer: AuthServerMetadata,
  resourceUri: string,
  config: OAuthConfig
): Promise<{ clientId: string; clientSecret?: string }> {
  // If client credentials are pre-configured, use them
  if (config.clientId) {
    console.log('[AuthFlow] Using pre-configured client credentials');
    return {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    };
  }

  // Check for existing registered client with matching redirect URI
  const existing = getRegisteredClient(authServer.issuer, resourceUri, config.redirectUri);
  if (existing) {
    console.log(`[AuthFlow] Using existing registered client for redirect: ${config.redirectUri}`);
    return {
      clientId: existing.clientId,
      clientSecret: existing.clientSecret,
    };
  }

  // Register a new client via DCR
  if (!supportsDcr(authServer)) {
    throw new Error(
      'Authorization server does not support Dynamic Client Registration and no client credentials were provided'
    );
  }

  console.log(`[AuthFlow] Registering new client via DCR for redirect: ${config.redirectUri}`);
  const registered = await registerClient(
    authServer,
    resourceUri,
    config.redirectUri,
    'MCP Client',
    config.scopes
  );

  return {
    clientId: registered.clientId,
    clientSecret: registered.clientSecret,
  };
}

/**
 * Build the authorization URL for the OAuth flow
 */
function buildAuthorizationUrl(
  authServer: AuthServerMetadata,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  codeChallengeMethod: 'S256' | 'plain',
  resourceUri: string,
  scopes?: string[]
): string {
  const url = new URL(authServer.authorization_endpoint);

  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', codeChallengeMethod);
  
  // Add resource parameter per RFC 8707
  url.searchParams.set('resource', resourceUri);

  // Add scopes
  if (scopes && scopes.length > 0) {
    url.searchParams.set('scope', scopes.join(' '));
  } else if (authServer.scopes_supported && authServer.scopes_supported.length > 0) {
    // Use all supported scopes if none specified
    url.searchParams.set('scope', authServer.scopes_supported.join(' '));
  }

  return url.toString();
}

/**
 * Initiate the OAuth authorization flow
 * Returns the authorization URL to redirect the user to
 */
export async function initiateAuthFlow(
  serverUrl: string,
  config: OAuthConfig,
  resourceMetadataUrl?: string,
  challengedScopes?: string
): Promise<{ authorizationUrl: string; state: string }> {
  // Clean up expired states
  cleanupExpiredStates();

  const resourceUri = getCanonicalResourceUri(serverUrl);
  console.log(`[AuthFlow] Initiating OAuth flow for ${resourceUri}`);

  // Get metadata
  const { protectedResource, authServer } = await getMetadata(serverUrl, resourceMetadataUrl);

  // Get or register client
  const { clientId, clientSecret } = await getOrRegisterClient(authServer, resourceUri, config);

  // Determine scopes to request
  let scopes = config.scopes;
  if (challengedScopes) {
    // Use scopes from WWW-Authenticate challenge
    scopes = challengedScopes.split(' ');
  } else if (!scopes && protectedResource.scopes_supported) {
    // Fall back to scopes from protected resource metadata
    scopes = protectedResource.scopes_supported;
  }

  // Generate PKCE pair
  const pkceMethod = selectPkceMethod(authServer.code_challenge_methods_supported) || 'S256';
  const { verifier, challenge, method } = generatePkcePair(pkceMethod);

  // Generate state for CSRF protection
  const state = generateState();

  // Store state for callback verification
  const oauthState: OAuthState = {
    state,
    codeVerifier: verifier,
    redirectUri: config.redirectUri,
    resourceUri,
    issuer: authServer.issuer,
    createdAt: Date.now(),
    scopes,
  };
  pendingStates.set(state, oauthState);
  saveStatesToFile(); // Persist state to survive server restarts

  // Build authorization URL
  const authorizationUrl = buildAuthorizationUrl(
    authServer,
    clientId,
    config.redirectUri,
    state,
    challenge,
    method,
    resourceUri,
    scopes
  );

  console.log(`[AuthFlow] Authorization URL generated for ${authServer.issuer}`);

  return { authorizationUrl, state };
}

/**
 * Handle the OAuth callback (authorization code exchange)
 */
export async function handleAuthCallback(
  code: string,
  state: string,
  config: OAuthConfig
): Promise<OAuthTokens> {
  console.log('[AuthFlow] Handling OAuth callback');

  // Verify state
  const oauthState = pendingStates.get(state);
  if (!oauthState) {
    console.log(`[AuthFlow] State not found: ${state.substring(0, 16)}...`);
    console.log(`[AuthFlow] Available states: ${Array.from(pendingStates.keys()).map(s => s.substring(0, 16) + '...').join(', ') || 'none'}`);
    throw new Error('Invalid or expired OAuth state. Please try authorizing again.');
  }

  // Remove the used state
  pendingStates.delete(state);
  saveStatesToFile(); // Persist state removal

  // Check if state has expired
  if (Date.now() - oauthState.createdAt > STATE_TTL_MS) {
    throw new Error('OAuth state has expired. Please try authorizing again.');
  }

  // Get metadata
  const authServer = await discoverAuthServerMetadata(oauthState.issuer);

  // Get client credentials
  const { clientId, clientSecret } = await getOrRegisterClient(
    authServer,
    oauthState.resourceUri,
    config
  );

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(
    authServer,
    code,
    oauthState.redirectUri,
    oauthState.codeVerifier,
    clientId,
    clientSecret,
    oauthState.resourceUri
  );

  // Store tokens
  storeTokens(oauthState.resourceUri, tokens, oauthState.issuer);

  console.log(`[AuthFlow] OAuth flow completed for ${oauthState.resourceUri}`);

  return tokens;
}

/**
 * Get a valid access token for a resource, refreshing if necessary
 * Returns null if authorization is required
 */
export async function getAccessToken(
  serverUrl: string,
  config: OAuthConfig
): Promise<string | null> {
  const resourceUri = getCanonicalResourceUri(serverUrl);

  // Check if we have valid tokens
  if (!hasValidTokens(resourceUri)) {
    // Try to get metadata and refresh
    try {
      const { authServer } = await getMetadata(serverUrl);
      const { clientId, clientSecret } = await getOrRegisterClient(authServer, resourceUri, config);
      
      const token = await getValidAccessToken(resourceUri, authServer, clientId, clientSecret);
      return token;
    } catch (error) {
      console.log('[AuthFlow] Cannot get valid token:', error);
      return null;
    }
  }

  const tokens = getTokens(resourceUri);
  return tokens?.accessToken || null;
}

/**
 * Get the OAuth status for a resource
 */
export async function getOAuthStatus(
  serverUrl: string,
  config: OAuthConfig
): Promise<OAuthStatus> {
  const resourceUri = getCanonicalResourceUri(serverUrl);

  // Check if we have valid tokens
  if (hasValidTokens(resourceUri)) {
    const tokens = getTokens(resourceUri);
    return {
      authenticated: true,
      scopes: tokens?.scope?.split(' '),
      expiresAt: tokens?.expiresAt,
    };
  }

  // Check if we need authorization
  try {
    const { authServer } = await getMetadata(serverUrl);
    const { clientId, clientSecret } = await getOrRegisterClient(authServer, resourceUri, config);
    
    // Try to refresh
    const token = await getValidAccessToken(resourceUri, authServer, clientId, clientSecret);
    if (token) {
      const tokens = getTokens(resourceUri);
      return {
        authenticated: true,
        scopes: tokens?.scope?.split(' '),
        expiresAt: tokens?.expiresAt,
      };
    }
  } catch (error) {
    // Authorization required
  }

  return {
    authenticated: false,
    authorizationRequired: true,
  };
}

/**
 * Handle a 401 Unauthorized response from an MCP server
 * Returns authorization URL if auth is needed, or null if tokens were refreshed
 */
export async function handle401Response(
  serverUrl: string,
  wwwAuthenticateHeader: string | null,
  config: OAuthConfig
): Promise<{ authorizationUrl: string; state: string } | null> {
  const resourceUri = getCanonicalResourceUri(serverUrl);
  console.log(`[AuthFlow] Handling 401 response for ${resourceUri}`);

  // Parse WWW-Authenticate header if present
  let resourceMetadataUrl: string | undefined;
  let challengedScopes: string | undefined;

  if (wwwAuthenticateHeader) {
    const params = parseWwwAuthenticateHeader(wwwAuthenticateHeader);
    resourceMetadataUrl = params.resourceMetadata;
    challengedScopes = params.scope;
    
    console.log(`[AuthFlow] WWW-Authenticate: resource_metadata=${resourceMetadataUrl}, scope=${challengedScopes}`);
  }

  // Try to refresh tokens first
  try {
    const { authServer } = await getMetadata(serverUrl, resourceMetadataUrl);
    const { clientId, clientSecret } = await getOrRegisterClient(authServer, resourceUri, config);
    
    const token = await getValidAccessToken(resourceUri, authServer, clientId, clientSecret);
    if (token) {
      console.log('[AuthFlow] Tokens refreshed successfully');
      return null; // Tokens refreshed, retry the request
    }
  } catch (error) {
    console.log('[AuthFlow] Cannot refresh tokens:', error);
  }

  // Need to initiate new authorization flow
  return initiateAuthFlow(serverUrl, config, resourceMetadataUrl, challengedScopes);
}

/**
 * Handle a 403 Forbidden response (insufficient scope)
 * Initiates step-up authorization with additional scopes
 */
export async function handle403Response(
  serverUrl: string,
  wwwAuthenticateHeader: string | null,
  config: OAuthConfig
): Promise<{ authorizationUrl: string; state: string }> {
  console.log('[AuthFlow] Handling 403 insufficient_scope response');

  // Parse WWW-Authenticate header for required scopes
  let requiredScopes: string | undefined;
  let resourceMetadataUrl: string | undefined;

  if (wwwAuthenticateHeader) {
    const params = parseWwwAuthenticateHeader(wwwAuthenticateHeader);
    requiredScopes = params.scope;
    resourceMetadataUrl = params.resourceMetadata;
    
    console.log(`[AuthFlow] Required scopes: ${requiredScopes}`);
  }

  // Initiate authorization with the required scopes
  return initiateAuthFlow(serverUrl, config, resourceMetadataUrl, requiredScopes);
}

/**
 * Revoke tokens and clear authorization for a resource
 */
export async function revokeAuthorization(
  serverUrl: string,
  config: OAuthConfig
): Promise<void> {
  const resourceUri = getCanonicalResourceUri(serverUrl);
  console.log(`[AuthFlow] Revoking authorization for ${resourceUri}`);

  try {
    const { authServer } = await getMetadata(serverUrl);
    const { clientId, clientSecret } = await getOrRegisterClient(authServer, resourceUri, config);
    
    await revokeTokens(authServer, resourceUri, clientId, clientSecret);
  } catch (error) {
    // Just remove local tokens if revocation fails
    console.log('[AuthFlow] Could not revoke at server, removing local tokens');
    removeTokens(resourceUri);
  }
}

/**
 * Clear all cached metadata
 */
export function clearMetadataCache(): void {
  resourceMetadataCache.clear();
  console.log('[AuthFlow] Metadata cache cleared');
}

/**
 * Get pending state by state parameter (for debugging)
 */
export function getPendingState(state: string): OAuthState | undefined {
  return pendingStates.get(state);
}

/**
 * Check if there's a pending authorization for a resource
 */
export function hasPendingAuthorization(serverUrl: string): boolean {
  const resourceUri = getCanonicalResourceUri(serverUrl);
  
  for (const state of pendingStates.values()) {
    if (state.resourceUri === resourceUri) {
      return true;
    }
  }
  
  return false;
}
