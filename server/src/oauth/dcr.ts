/**
 * Dynamic Client Registration Module (RFC 7591)
 * Enables automatic OAuth client registration with authorization servers
 */

import crypto from 'crypto';
import type {
    AuthServerMetadata,
    DCRRequest,
    DCRResponse,
    RegisteredClient,
} from '../types.js';

// In-memory storage for registered clients (keyed by issuer + resourceUri)
const registeredClients = new Map<string, RegisteredClient>();

// Encryption key for client secrets (should be set via environment variable)
let encryptionKey: Buffer | null = null;

/**
 * Initialize the DCR module with an encryption key
 */
export function initializeDcr(key?: string): void {
  if (key) {
    // Derive a 32-byte key from the provided string
    encryptionKey = crypto.scryptSync(key, 'mcp-client-salt', 32);
    console.log('[DCR] Initialized with encryption key');
  } else {
    console.warn('[DCR] No encryption key provided - client secrets will be stored in plain text');
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
  
  // Format: iv:authTag:encrypted
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
    // Not encrypted or invalid format
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
 * Generate a cache key for registered clients
 * Includes redirectUri to ensure a new client is registered when the port changes
 */
function getClientCacheKey(issuer: string, resourceUri: string, redirectUri?: string): string {
  if (redirectUri) {
    return `${issuer}|${resourceUri}|${redirectUri}`;
  }
  return `${issuer}|${resourceUri}`;
}

/**
 * Get a previously registered client
 * First tries to find a client with the exact redirectUri, then falls back to any client for the issuer/resource
 */
export function getRegisteredClient(issuer: string, resourceUri: string, redirectUri?: string): RegisteredClient | null {
  // First, try to find with exact redirectUri match
  if (redirectUri) {
    const keyWithRedirect = getClientCacheKey(issuer, resourceUri, redirectUri);
    const clientWithRedirect = registeredClients.get(keyWithRedirect);
    if (clientWithRedirect) {
      // Check if client secret has expired
      if (clientWithRedirect.clientSecretExpiresAt && clientWithRedirect.clientSecretExpiresAt < Date.now() / 1000) {
        console.log('[DCR] Registered client secret has expired, removing from cache');
        registeredClients.delete(keyWithRedirect);
      } else {
        return {
          ...clientWithRedirect,
          clientSecret: clientWithRedirect.clientSecret ? decrypt(clientWithRedirect.clientSecret) : undefined,
        };
      }
    }
  }

  // Fallback: search for any client matching issuer and resourceUri (for backward compatibility)
  for (const [key, client] of registeredClients.entries()) {
    if (key.startsWith(`${issuer}|${resourceUri}`)) {
      // Check if client secret has expired
      if (client.clientSecretExpiresAt && client.clientSecretExpiresAt < Date.now() / 1000) {
        console.log('[DCR] Registered client secret has expired, removing from cache');
        registeredClients.delete(key);
        continue;
      }
      
      console.log(`[DCR] Found existing client (fallback search): ${client.clientId}`);
      return {
        ...client,
        clientSecret: client.clientSecret ? decrypt(client.clientSecret) : undefined,
      };
    }
  }

  return null;
}

/**
 * Store a registered client
 */
function storeRegisteredClient(
  issuer: string,
  resourceUri: string,
  redirectUri: string,
  response: DCRResponse
): RegisteredClient {
  const client: RegisteredClient = {
    clientId: response.client_id,
    clientSecret: response.client_secret ? encrypt(response.client_secret) : undefined,
    issuer,
    resourceUri,
    registeredAt: Date.now(),
    clientSecretExpiresAt: response.client_secret_expires_at,
  };

  const key = getClientCacheKey(issuer, resourceUri, redirectUri);
  registeredClients.set(key, client);

  console.log(`[DCR] Stored registered client: ${response.client_id}`);
  return {
    ...client,
    clientSecret: response.client_secret, // Return unencrypted for immediate use
  };
}

/**
 * Build the DCR request payload
 */
function buildDcrRequest(
  redirectUri: string,
  clientName: string,
  scopes?: string[]
): DCRRequest {
  return {
    redirect_uris: [redirectUri],
    client_name: clientName,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
    scope: scopes?.join(' '),
  };
}

/**
 * Register a new OAuth client via Dynamic Client Registration (RFC 7591)
 */
export async function registerClient(
  metadata: AuthServerMetadata,
  resourceUri: string,
  redirectUri: string,
  clientName: string = 'MCP Client',
  scopes?: string[]
): Promise<RegisteredClient> {
  if (!metadata.registration_endpoint) {
    throw new Error('Authorization server does not support Dynamic Client Registration');
  }

  // Check if we already have a valid registered client for this redirect URI
  const existing = getRegisteredClient(metadata.issuer, resourceUri, redirectUri);
  if (existing) {
    console.log(`[DCR] Using existing registered client: ${existing.clientId} for redirect: ${redirectUri}`);
    return existing;
  }

  console.log(`[DCR] Registering new client with ${metadata.registration_endpoint}`);

  const request = buildDcrRequest(redirectUri, clientName, scopes);

  try {
    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(request),
    });

    // RFC 7591 specifies 201 Created, but some servers return 200 OK
    if (!response.ok && response.status !== 201) {
      const errorBody = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      
      try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error_description) {
          errorMessage = errorJson.error_description;
        } else if (errorJson.error) {
          errorMessage = errorJson.error;
        }
      } catch {
        // Use raw error body if not JSON
        if (errorBody) {
          errorMessage = errorBody;
        }
      }
      
      throw new Error(`DCR failed: ${errorMessage}`);
    }

    const dcrResponse = await response.json() as DCRResponse;

    // Validate response
    if (!dcrResponse.client_id) {
      throw new Error('DCR response missing client_id');
    }

    console.log(`[DCR] Successfully registered client: ${dcrResponse.client_id}`);
    
    if (dcrResponse.client_secret) {
      console.log('[DCR] Received client secret (confidential client)');
    } else {
      console.log('[DCR] No client secret received (public client)');
    }

    if (dcrResponse.client_secret_expires_at) {
      const expiresDate = new Date(dcrResponse.client_secret_expires_at * 1000);
      console.log(`[DCR] Client secret expires at: ${expiresDate.toISOString()}`);
    }

    // Store and return the registered client
    return storeRegisteredClient(metadata.issuer, resourceUri, redirectUri, dcrResponse);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`DCR failed: ${String(error)}`);
  }
}

/**
 * Remove a registered client from the cache
 */
export function removeRegisteredClient(issuer: string, resourceUri: string): boolean {
  const key = getClientCacheKey(issuer, resourceUri);
  return registeredClients.delete(key);
}

/**
 * Clear all registered clients from the cache
 */
export function clearRegisteredClients(): void {
  registeredClients.clear();
  console.log('[DCR] Cleared all registered clients');
}

/**
 * Get all registered clients (for debugging/admin purposes)
 */
export function getAllRegisteredClients(): Array<Omit<RegisteredClient, 'clientSecret'>> {
  return Array.from(registeredClients.values()).map(client => ({
    clientId: client.clientId,
    issuer: client.issuer,
    resourceUri: client.resourceUri,
    registeredAt: client.registeredAt,
    clientSecretExpiresAt: client.clientSecretExpiresAt,
  }));
}
