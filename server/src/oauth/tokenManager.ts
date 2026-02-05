/**
 * Token Manager Module
 * Handles OAuth token storage, refresh, and validation
 */

import crypto from 'crypto';
import type { AuthServerMetadata, OAuthTokens } from '../types.js';

// In-memory storage for tokens (keyed by resourceUri)
const tokenStore = new Map<string, EncryptedTokens>();

// Encryption key for tokens
let encryptionKey: Buffer | null = null;

interface EncryptedTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt: number;
  scope?: string;
  issuer: string;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
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
  const encrypted: EncryptedTokens = {
    accessToken: encrypt(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken) : undefined,
    tokenType: tokens.tokenType,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope,
    issuer,
  };

  tokenStore.set(resourceUri, encrypted);
  console.log(`[TokenManager] Stored tokens for ${resourceUri}`);
}

/**
 * Get tokens for a resource
 */
export function getTokens(resourceUri: string): OAuthTokens | null {
  const encrypted = tokenStore.get(resourceUri);
  if (!encrypted) {
    return null;
  }

  return {
    accessToken: decrypt(encrypted.accessToken),
    refreshToken: encrypted.refreshToken ? decrypt(encrypted.refreshToken) : undefined,
    tokenType: encrypted.tokenType,
    expiresAt: encrypted.expiresAt,
    scope: encrypted.scope,
  };
}

/**
 * Get the issuer for stored tokens
 */
export function getTokenIssuer(resourceUri: string): string | null {
  const encrypted = tokenStore.get(resourceUri);
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
    scope: tokenResponse.scope,
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
    scope: tokenResponse.scope || currentTokens.scope,
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
  const deleted = tokenStore.delete(resourceUri);
  if (deleted) {
    console.log(`[TokenManager] Removed tokens for ${resourceUri}`);
  }
  return deleted;
}

/**
 * Clear all stored tokens
 */
export function clearAllTokens(): void {
  tokenStore.clear();
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
