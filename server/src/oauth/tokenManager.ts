/**
 * Token Manager Module
 * Handles OAuth token storage, refresh, and validation
 */

import crypto from 'crypto';
import fs from 'fs';
import { homedir } from 'os';
import path from 'path';
import type { AuthServerMetadata, OAuthTokens, PersonaToken } from '../types.js';
import { getTokenSharingKey } from './discovery.js';

// In-memory storage for tokens, keyed by the token-sharing key (host + tenant)
// so all connectors under the same auth server share one login
const tokenStore = new Map<string, EncryptedTokens>();
const TOKEN_CACHE_DIR = path.join(homedir(), '.mcpinspector');
const TOKEN_CACHE_FILE = path.join(TOKEN_CACHE_DIR, 'oauth-tokens.json');

// Encryption key for tokens
let encryptionKey: Buffer | null = null;

interface EncryptedTokens {
  accessToken: string;
  refreshToken?: string;
  refreshExpiresAt?: number;
  tokenType: string;
  expiresAt: number;
  scope?: string;
  issuer: string;
  userEmail?: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  scope?: string;
  id_token?: string;
}

interface TokenCacheFile {
  version: 1;
  tokens: Record<string, EncryptedTokens>;
}

function ensureTokenCacheDir(): void {
  if (!fs.existsSync(TOKEN_CACHE_DIR)) {
    fs.mkdirSync(TOKEN_CACHE_DIR, { recursive: true });
  }
}

function saveTokensToFile(): void {
  try {
    ensureTokenCacheDir();
    const serialized: Record<string, EncryptedTokens> = {};
    for (const [resourceUri, token] of tokenStore.entries()) {
      serialized[resourceUri] = token;
    }
    const payload: TokenCacheFile = {
      version: 1,
      tokens: serialized,
    };
    fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('[TokenManager] Failed to persist tokens:', error);
  }
}

function loadTokensFromFile(): void {
  try {
    if (!fs.existsSync(TOKEN_CACHE_FILE)) {
      return;
    }
    const raw = fs.readFileSync(TOKEN_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as TokenCacheFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.tokens) {
      return;
    }

    let loaded = 0;
    let migrated = false;
    for (const [resourceUri, token] of Object.entries(parsed.tokens)) {
      if (!token || typeof token !== 'object') continue;
      // Migrate legacy full-resource-URI keys to the shared key; on collision
      // keep the entry with the latest expiration
      const key = getTokenSharingKey(resourceUri);
      if (key !== resourceUri) migrated = true;
      const existing = tokenStore.get(key);
      if (!existing || (token.expiresAt || 0) > (existing.expiresAt || 0)) {
        tokenStore.set(key, token);
      }
      loaded += 1;
    }
    if (migrated) {
      saveTokensToFile();
    }
    if (loaded > 0) {
      console.log(`[TokenManager] Loaded ${loaded} token set(s) from ${TOKEN_CACHE_FILE}`);
    }
  } catch (error) {
    console.error('[TokenManager] Failed to load persisted tokens:', error);
  }
}

/**
 * Initialize the token manager with an encryption key
 */
export function initializeTokenManager(key?: string): void {
  if (key) {
    encryptionKey = crypto.scryptSync(key, 'mcp-token-salt', 32);
    console.log('[TokenManager] Initialized with encryption key');
  } else {
    console.warn('[TokenManager] No encryption key provided - tokens will be stored in plain text');
    encryptionKey = null;
  }
  loadTokensFromFile();
}

/**
 * Encrypt a string value
 */
function encrypt(text: string): string {
  if (!encryptionKey) {
    return text;
  }

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a string value
 */
function decrypt(encryptedText: string): string {
  if (!encryptionKey) {
    return encryptedText;
  }

  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return encryptedText;
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Store tokens for a resource
 */
export function storeTokens(resourceUri: string, tokens: OAuthTokens, issuer: string): void {
  const key = getTokenSharingKey(resourceUri);
  const encrypted: EncryptedTokens = {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : undefined,
    refreshExpiresAt: tokens.refreshExpiresAt,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    issuer,
    // Preserve a previously resolved email if the new tokens don't carry one
    userEmail: tokens.userEmail || tokenStore.get(key)?.userEmail,
  };

  tokenStore.set(key, encrypted);
  saveTokensToFile();
  console.log(`[TokenManager] Stored tokens for ${key}`);
}

/**
 * Get tokens for a resource
 */
export function getTokens(resourceUri: string): OAuthTokens | null {
  const encrypted = tokenStore.get(getTokenSharingKey(resourceUri));
  if (!encrypted) {
    return null;
  }

  return {
    accessToken: decrypt(encrypted.accessToken),
    refreshToken: encrypted.refreshToken ? decrypt(encrypted.refreshToken) : undefined,
    refreshExpiresAt: encrypted.refreshExpiresAt,
    tokenType: encrypted.tokenType,
    expiresAt: encrypted.expiresAt,
    scope: encrypted.scope,
    userEmail: encrypted.userEmail,
  };
}

/**
 * Decode an email-ish claim from a JWT (best-effort, no verification)
 */
function decodeEmailFromJwt(jwt: string): string | undefined {
  try {
    const payload = jwt.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return decoded.email || decoded.preferred_username || decoded.upn || undefined;
  } catch {
    // Opaque (non-JWT) token or malformed payload
    return undefined;
  }
}

/**
 * Resolve the logged-in user's email for a resource.
 * Order: stored email (from id_token) → access token claims → userinfo endpoint.
 * The userinfo result is cached back into the token store.
 */
export async function getUserEmail(
  resourceUri: string,
  userinfoEndpoint?: string
): Promise<string | undefined> {
  const tokens = getTokens(resourceUri);
  if (!tokens?.accessToken) {
    return undefined;
  }

  if (tokens.userEmail) {
    return tokens.userEmail;
  }

  const fromJwt = decodeEmailFromJwt(tokens.accessToken);
  if (fromJwt) {
    return fromJwt;
  }

  if (!userinfoEndpoint) {
    return undefined;
  }

  try {
    const response = await fetch(userinfoEndpoint, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!response.ok) {
      return undefined;
    }
    const info = await response.json() as { email?: string; preferred_username?: string };
    const email = info.email || info.preferred_username;
    if (email) {
      const encrypted = tokenStore.get(getTokenSharingKey(resourceUri));
      if (encrypted) {
        encrypted.userEmail = email;
        saveTokensToFile();
      }
    }
    return email;
  } catch {
    return undefined;
  }
}

/**
 * Get the issuer for stored tokens
 */
export function getTokenIssuer(resourceUri: string): string | null {
  const encrypted = tokenStore.get(getTokenSharingKey(resourceUri));
  return encrypted?.issuer || null;
}

/**
 * Check if tokens exist and are valid (not expired)
 */
export function hasValidTokens(resourceUri: string): boolean {
  const tokens = getTokens(resourceUri);
  if (!tokens) {
    return false;
  }

  // Add 30 second buffer before expiration
  const bufferMs = 30 * 1000;
  return tokens.expiresAt > Date.now() + bufferMs;
}

/**
 * Check if tokens need refresh (expired or about to expire)
 */
export function needsRefresh(resourceUri: string): boolean {
  const tokens = getTokens(resourceUri);
  if (!tokens) {
    return false;
  }

  // Refresh if within 5 minutes of expiration
  const refreshBufferMs = 5 * 60 * 1000;
  return tokens.expiresAt < Date.now() + refreshBufferMs;
}

/**
 * Check if we can refresh tokens (have a refresh token)
 */
export function canRefresh(resourceUri: string): boolean {
  const tokens = getTokens(resourceUri);
  return !!tokens?.refreshToken;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  metadata: AuthServerMetadata,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  clientId: string,
  clientSecret?: string,
  resourceUri?: string
): Promise<OAuthTokens> {
  console.log(`[TokenManager] Exchanging code for tokens at ${metadata.token_endpoint}`);

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: codeVerifier,
  });

  // Add resource parameter per RFC 8707
  if (resourceUri) {
    params.set('resource', resourceUri);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  };

  // Use client_secret_basic authentication if we have a secret
  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    // Remove client_id from body when using Basic auth
    params.delete('client_id');
  }

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.error_description) {
        errorMessage = errorJson.error_description;
      } else if (errorJson.error) {
        errorMessage = `${errorJson.error}: ${errorJson.error_description || ''}`;
      }
    } catch {
      if (errorBody) {
        errorMessage = errorBody;
      }
    }
    
    throw new Error(`Token exchange failed: ${errorMessage}`);
  }

  const tokenResponse = await response.json() as TokenResponse;

  if (!tokenResponse.access_token) {
    throw new Error('Token response missing access_token');
  }

  const tokens: OAuthTokens = {
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type || 'Bearer',
    expiresAt: tokenResponse.expires_in
      ? Date.now() + tokenResponse.expires_in * 1000
      : Date.now() + 3600 * 1000, // Default 1 hour if not specified
    refreshToken: tokenResponse.refresh_token,
    refreshExpiresAt: tokenResponse.refresh_expires_in
      ? Date.now() + tokenResponse.refresh_expires_in * 1000
      : undefined,
    scope: tokenResponse.scope,
    userEmail: tokenResponse.id_token
      ? decodeEmailFromJwt(tokenResponse.id_token)
      : undefined,
  };

  console.log(`[TokenManager] Received tokens, expires at ${new Date(tokens.expiresAt).toISOString()}`);
  
  if (tokens.refreshToken) {
    console.log('[TokenManager] Refresh token received');
  }

  return tokens;
}

/**
 * Refresh tokens using a refresh token
 */
export async function refreshTokens(
  metadata: AuthServerMetadata,
  resourceUri: string,
  clientId: string,
  clientSecret?: string
): Promise<OAuthTokens> {
  const currentTokens = getTokens(resourceUri);
  if (!currentTokens?.refreshToken) {
    throw new Error('No refresh token available');
  }
  if (currentTokens.refreshExpiresAt && currentTokens.refreshExpiresAt <= Date.now()) {
    removeTokens(resourceUri);
    throw new Error('Refresh token has expired');
  }

  console.log(`[TokenManager] Refreshing tokens at ${metadata.token_endpoint}`);

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentTokens.refreshToken,
    client_id: clientId,
  });

  // Add resource parameter per RFC 8707
  params.set('resource', resourceUri);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  };

  // Use client_secret_basic authentication if we have a secret
  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    params.delete('client_id');
  }

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    
    try {
      const errorJson = JSON.parse(errorBody);
      if (errorJson.error_description) {
        errorMessage = errorJson.error_description;
      } else if (errorJson.error) {
        errorMessage = `${errorJson.error}: ${errorJson.error_description || ''}`;
      }
    } catch {
      if (errorBody) {
        errorMessage = errorBody;
      }
    }
    
    // If refresh fails, clear the stored tokens
    if (response.status === 400 || response.status === 401) {
      console.log('[TokenManager] Refresh token invalid, clearing stored tokens');
      removeTokens(resourceUri);
    }
    
    throw new Error(`Token refresh failed: ${errorMessage}`);
  }

  const tokenResponse = await response.json() as TokenResponse;

  if (!tokenResponse.access_token) {
    throw new Error('Token response missing access_token');
  }

  const tokens: OAuthTokens = {
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type || 'Bearer',
    expiresAt: tokenResponse.expires_in
      ? Date.now() + tokenResponse.expires_in * 1000
      : Date.now() + 3600 * 1000,
    // Use new refresh token if provided, otherwise keep the old one
    refreshToken: tokenResponse.refresh_token || currentTokens.refreshToken,
    refreshExpiresAt: tokenResponse.refresh_expires_in
      ? Date.now() + tokenResponse.refresh_expires_in * 1000
      : currentTokens.refreshExpiresAt,
    scope: tokenResponse.scope || currentTokens.scope,
    userEmail: (tokenResponse.id_token && decodeEmailFromJwt(tokenResponse.id_token))
      || currentTokens.userEmail,
  };

  // Store the new tokens
  const issuer = getTokenIssuer(resourceUri);
  if (issuer) {
    storeTokens(resourceUri, tokens, issuer);
  }

  console.log(`[TokenManager] Tokens refreshed, new expiration: ${new Date(tokens.expiresAt).toISOString()}`);

  return tokens;
}

/**
 * Get a valid access token, refreshing if necessary
 */
export async function getValidAccessToken(
  resourceUri: string,
  metadata: AuthServerMetadata,
  clientId: string,
  clientSecret?: string
): Promise<string | null> {
  // Check if we have valid tokens
  if (hasValidTokens(resourceUri)) {
    const tokens = getTokens(resourceUri);
    return tokens?.accessToken || null;
  }

  // Try to refresh if we have a refresh token
  if (canRefresh(resourceUri)) {
    try {
      const tokens = await refreshTokens(metadata, resourceUri, clientId, clientSecret);
      return tokens.accessToken;
    } catch (error) {
      console.error('[TokenManager] Failed to refresh tokens:', error);
      // Fall through to return null - caller should initiate new auth flow
    }
  }

  return null;
}

/**
 * Remove tokens for a resource
 */
export function removeTokens(resourceUri: string): boolean {
  const deleted = tokenStore.delete(getTokenSharingKey(resourceUri));
  if (deleted) {
    saveTokensToFile();
    console.log(`[TokenManager] Removed tokens for ${resourceUri}`);
  }
  return deleted;
}

/**
 * Clear all stored tokens
 */
export function clearAllTokens(): void {
  tokenStore.clear();
  saveTokensToFile();
  console.log('[TokenManager] Cleared all tokens');
}

/**
 * Revoke tokens at the authorization server
 */
export async function revokeTokens(
  metadata: AuthServerMetadata,
  resourceUri: string,
  clientId: string,
  clientSecret?: string
): Promise<void> {
  const tokens = getTokens(resourceUri);
  if (!tokens) {
    return;
  }

  // Only revoke if the server supports it
  if (!metadata.revocation_endpoint) {
    console.log('[TokenManager] Server does not support token revocation');
    removeTokens(resourceUri);
    return;
  }

  console.log(`[TokenManager] Revoking tokens at ${metadata.revocation_endpoint}`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }

  // Revoke access token
  try {
    const params = new URLSearchParams({
      token: tokens.accessToken,
      token_type_hint: 'access_token',
    });

    if (!clientSecret) {
      params.set('client_id', clientId);
    }

    await fetch(metadata.revocation_endpoint, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  } catch (error) {
    console.error('[TokenManager] Failed to revoke access token:', error);
  }

  // Revoke refresh token if present
  if (tokens.refreshToken) {
    try {
      const params = new URLSearchParams({
        token: tokens.refreshToken,
        token_type_hint: 'refresh_token',
      });

      if (!clientSecret) {
        params.set('client_id', clientId);
      }

      await fetch(metadata.revocation_endpoint, {
        method: 'POST',
        headers,
        body: params.toString(),
      });
    } catch (error) {
      console.error('[TokenManager] Failed to revoke refresh token:', error);
    }
  }

  // Remove from local storage regardless of revocation success
  removeTokens(resourceUri);
}

/**
 * Get token status for a resource (for UI display)
 */
export function getTokenStatus(resourceUri: string): {
  hasTokens: boolean;
  isValid: boolean;
  expiresAt?: number;
  scope?: string;
} {
  const tokens = getTokens(resourceUri);
  
  if (!tokens) {
    return { hasTokens: false, isValid: false };
  }

  return {
    hasTokens: true,
    isValid: hasValidTokens(resourceUri),
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
  };
}

// ============================================================================
// Persona Token Exchange (RFC 8693)
// ============================================================================

const GRANT_TYPE_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const TOKEN_TYPE_ACCESS = 'urn:ietf:params:oauth:token-type:access_token';

const personaTokenStore = new Map<string, PersonaToken>();

function personaKey(serverId: string, email: string): string {
  return `${serverId}:${email.toLowerCase()}`;
}

interface TokenExchangeRawResponse {
  access_token: string;
  issued_token_type: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export async function performTokenExchange(
  metadata: AuthServerMetadata,
  subjectToken: string,
  targetUserEmail: string,
  clientId: string,
  clientSecret?: string,
  scope?: string,
): Promise<{ accessToken: string; expiresIn: number; scope?: string }> {
  console.log(`[TokenManager] Performing token exchange for ${targetUserEmail} at ${metadata.token_endpoint}`);

  const params = new URLSearchParams({
    grant_type: GRANT_TYPE_TOKEN_EXCHANGE,
    subject_token: subjectToken,
    subject_token_type: TOKEN_TYPE_ACCESS,
    target_user_email: targetUserEmail,
  });

  if (scope) {
    params.set('scope', scope);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  };

  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  } else {
    params.set('client_id', clientId);
  }

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers,
    body: params.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorJson = JSON.parse(errorBody);
      errorMessage = errorJson.error_description || errorJson.error || errorMessage;
    } catch {
      if (errorBody) errorMessage = errorBody;
    }
    throw new Error(`Token exchange failed: ${errorMessage}`);
  }

  const body = await response.json() as TokenExchangeRawResponse;

  if (!body.access_token) {
    throw new Error('Token exchange response missing access_token');
  }

  console.log(`[TokenManager] Token exchange successful, expires in ${body.expires_in}s`);

  return {
    accessToken: body.access_token,
    expiresIn: body.expires_in,
    scope: body.scope,
  };
}

export function storePersonaToken(serverId: string, token: PersonaToken): void {
  personaTokenStore.set(personaKey(serverId, token.targetEmail), token);
  console.log(`[TokenManager] Stored persona token for ${token.targetEmail} on server ${serverId}`);
}

export function getPersonaToken(serverId: string, email: string): PersonaToken | null {
  const token = personaTokenStore.get(personaKey(serverId, email));
  if (!token) return null;
  if (token.expiresAt <= Date.now() + 30_000) {
    personaTokenStore.delete(personaKey(serverId, email));
    return null;
  }
  return token;
}

export function clearPersonaTokens(serverId?: string): void {
  if (serverId) {
    for (const key of personaTokenStore.keys()) {
      if (key.startsWith(`${serverId}:`)) {
        personaTokenStore.delete(key);
      }
    }
  } else {
    personaTokenStore.clear();
  }
  console.log(`[TokenManager] Cleared persona tokens${serverId ? ` for server ${serverId}` : ''}`);
}
