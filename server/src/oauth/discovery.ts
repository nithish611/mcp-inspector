/**
 * OAuth Discovery Module
 * Implements RFC 9728 (Protected Resource Metadata) and RFC 8414 (Authorization Server Metadata)
 */

import type {
    AuthServerMetadata,
    ProtectedResourceMetadata,
    WwwAuthenticateParams,
} from '../types.js';

// Cache for metadata to avoid repeated requests
const protectedResourceMetadataCache = new Map<string, { data: ProtectedResourceMetadata; expiresAt: number }>();
const authServerMetadataCache = new Map<string, { data: AuthServerMetadata; expiresAt: number }>();

const CACHE_TTL_MS = 3600 * 1000; // 1 hour

/**
 * Parse WWW-Authenticate header from 401 response
 * Extracts resource_metadata URL and scope from Bearer challenge
 * 
 * Example header:
 * WWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read"
 */
export function parseWwwAuthenticateHeader(header: string): WwwAuthenticateParams {
  const result: WwwAuthenticateParams = { scheme: '' };

  // Extract scheme (e.g., "Bearer")
  const schemeMatch = header.match(/^(\w+)\s*/);
  if (schemeMatch) {
    result.scheme = schemeMatch[1];
  }

  // Extract quoted parameters
  const paramRegex = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = paramRegex.exec(header)) !== null) {
    const [, key, value] = match;
    switch (key) {
      case 'resource_metadata':
        result.resourceMetadata = value;
        break;
      case 'scope':
        result.scope = value;
        break;
      case 'error':
        result.error = value;
        break;
      case 'error_description':
        result.errorDescription = value;
        break;
    }
  }

  return result;
}

/**
 * Construct the well-known URI for Protected Resource Metadata
 * Per RFC 9728, the path can be at:
 * 1. /.well-known/oauth-protected-resource/{path} (path insertion)
 * 2. /.well-known/oauth-protected-resource (root)
 */
function getProtectedResourceMetadataUrls(serverUrl: string): string[] {
  const url = new URL(serverUrl);
  const urls: string[] = [];

  // If there's a path, try path-specific first
  if (url.pathname && url.pathname !== '/') {
    // Remove trailing slash and construct path-inserted URL
    const pathWithoutLeadingSlash = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    urls.push(`${url.origin}/.well-known/oauth-protected-resource/${pathWithoutLeadingSlash}`);
  }

  // Always try root
  urls.push(`${url.origin}/.well-known/oauth-protected-resource`);

  return urls;
}

/**
 * Discover Protected Resource Metadata (RFC 9728)
 * This tells us which authorization server(s) protect the MCP server
 */
export async function discoverProtectedResourceMetadata(
  serverUrl: string,
  resourceMetadataUrl?: string
): Promise<ProtectedResourceMetadata> {
  // Check cache first
  const cacheKey = resourceMetadataUrl || serverUrl;
  const cached = protectedResourceMetadataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // If we have a specific URL from WWW-Authenticate, use it
  const urlsToTry = resourceMetadataUrl
    ? [resourceMetadataUrl]
    : getProtectedResourceMetadataUrls(serverUrl);

  let lastError: Error | null = null;

  for (const url of urlsToTry) {
    try {
      console.log(`[OAuth Discovery] Fetching Protected Resource Metadata from: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const metadata = await response.json() as ProtectedResourceMetadata;

      // Validate required fields
      if (!metadata.resource || !metadata.authorization_servers?.length) {
        throw new Error('Invalid Protected Resource Metadata: missing required fields');
      }

      // Cache the result
      protectedResourceMetadataCache.set(cacheKey, {
        data: metadata,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      console.log(`[OAuth Discovery] Found ${metadata.authorization_servers.length} authorization server(s)`);
      return metadata;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[OAuth Discovery] Failed to fetch from ${url}: ${lastError.message}`);
    }
  }

  throw new Error(
    `Failed to discover Protected Resource Metadata: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Construct the well-known URIs for Authorization Server Metadata
 * Per RFC 8414, we try multiple endpoints for compatibility:
 * 1. OAuth 2.0 AS Metadata with path insertion
 * 2. OIDC Discovery with path insertion
 * 3. OIDC Discovery path appending
 */
function getAuthServerMetadataUrls(issuer: string): string[] {
  const url = new URL(issuer);
  const urls: string[] = [];

  if (url.pathname && url.pathname !== '/') {
    // Has path component (e.g., https://auth.example.com/tenant1)
    const pathWithoutLeadingSlash = url.pathname.replace(/^\//, '').replace(/\/$/, '');
    
    // OAuth 2.0 AS Metadata with path insertion
    urls.push(`${url.origin}/.well-known/oauth-authorization-server/${pathWithoutLeadingSlash}`);
    
    // OIDC Discovery with path insertion
    urls.push(`${url.origin}/.well-known/openid-configuration/${pathWithoutLeadingSlash}`);
    
    // OIDC Discovery path appending
    urls.push(`${url.origin}/${pathWithoutLeadingSlash}/.well-known/openid-configuration`);
  } else {
    // No path component (e.g., https://auth.example.com)
    urls.push(`${url.origin}/.well-known/oauth-authorization-server`);
    urls.push(`${url.origin}/.well-known/openid-configuration`);
  }

  return urls;
}

/**
 * Discover Authorization Server Metadata (RFC 8414 / OIDC Discovery)
 * This gives us the endpoints we need for OAuth (authorization, token, registration)
 * 
 * Note: Some providers (like AWS Cognito with custom domains) serve metadata at a 
 * different URL than the actual issuer. We handle this by:
 * 1. First trying strict issuer validation
 * 2. If that fails, accepting the metadata if it was successfully retrieved from
 *    a well-known endpoint derived from the discovery URL
 */
export async function discoverAuthServerMetadata(issuer: string): Promise<AuthServerMetadata> {
  // Check cache first
  const cached = authServerMetadataCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const urlsToTry = getAuthServerMetadataUrls(issuer);
  let lastError: Error | null = null;
  let metadataWithMismatchedIssuer: AuthServerMetadata | null = null;

  for (const url of urlsToTry) {
    try {
      console.log(`[OAuth Discovery] Fetching AS Metadata from: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const metadata = await response.json() as AuthServerMetadata;

      // Validate required fields
      if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint) {
        throw new Error('Invalid AS Metadata: missing required fields');
      }

      // Check if issuer matches
      const normalizedIssuer = issuer.replace(/\/$/, '');
      const normalizedMetadataIssuer = metadata.issuer.replace(/\/$/, '');
      
      if (normalizedIssuer !== normalizedMetadataIssuer) {
        // Issuer mismatch - this is common with AWS Cognito custom domains
        // Store the metadata but continue trying other URLs
        console.log(`[OAuth Discovery] Issuer mismatch at ${url}: expected ${normalizedIssuer}, got ${normalizedMetadataIssuer}`);
        console.log(`[OAuth Discovery] This may be valid for providers like AWS Cognito with custom domains`);
        
        if (!metadataWithMismatchedIssuer) {
          metadataWithMismatchedIssuer = metadata;
        }
        continue;
      }

      // Cache the result with the original issuer as key
      authServerMetadataCache.set(issuer, {
        data: metadata,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      console.log(`[OAuth Discovery] Found AS Metadata for ${metadata.issuer}`);
      console.log(`[OAuth Discovery] - Authorization endpoint: ${metadata.authorization_endpoint}`);
      console.log(`[OAuth Discovery] - Token endpoint: ${metadata.token_endpoint}`);
      console.log(`[OAuth Discovery] - Registration endpoint: ${metadata.registration_endpoint || 'not available'}`);
      console.log(`[OAuth Discovery] - PKCE methods: ${metadata.code_challenge_methods_supported?.join(', ') || 'not specified'}`);

      return metadata;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.log(`[OAuth Discovery] Failed to fetch from ${url}: ${lastError.message}`);
    }
  }

  // If we found metadata but with a mismatched issuer, accept it
  // This handles AWS Cognito and similar providers where the discovery URL
  // differs from the actual token issuer
  if (metadataWithMismatchedIssuer) {
    console.log(`[OAuth Discovery] Accepting metadata with different issuer (common for Cognito/custom domain setups)`);
    console.log(`[OAuth Discovery] Discovery URL base: ${issuer}`);
    console.log(`[OAuth Discovery] Actual issuer: ${metadataWithMismatchedIssuer.issuer}`);
    
    // Cache using the original discovery issuer as key
    authServerMetadataCache.set(issuer, {
      data: metadataWithMismatchedIssuer,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    console.log(`[OAuth Discovery] Found AS Metadata for ${metadataWithMismatchedIssuer.issuer}`);
    console.log(`[OAuth Discovery] - Authorization endpoint: ${metadataWithMismatchedIssuer.authorization_endpoint}`);
    console.log(`[OAuth Discovery] - Token endpoint: ${metadataWithMismatchedIssuer.token_endpoint}`);
    console.log(`[OAuth Discovery] - Registration endpoint: ${metadataWithMismatchedIssuer.registration_endpoint || 'not available'}`);
    console.log(`[OAuth Discovery] - PKCE methods: ${metadataWithMismatchedIssuer.code_challenge_methods_supported?.join(', ') || 'not specified'}`);

    return metadataWithMismatchedIssuer;
  }

  throw new Error(
    `Failed to discover Authorization Server Metadata for ${issuer}: ${lastError?.message || 'Unknown error'}`
  );
}

/**
 * Verify that the Authorization Server supports PKCE
 * Per MCP spec, PKCE is required and clients MUST refuse to proceed without it
 */
export function verifyPkceSupport(metadata: AuthServerMetadata): boolean {
  const supportedMethods = metadata.code_challenge_methods_supported;
  
  if (!supportedMethods || supportedMethods.length === 0) {
    console.warn('[OAuth Discovery] AS does not advertise PKCE support - proceeding with caution');
    // Some servers don't advertise but still support PKCE
    // We'll try anyway but log a warning
    return false;
  }

  // S256 is required by OAuth 2.1
  if (supportedMethods.includes('S256')) {
    return true;
  }

  // Plain is less secure but acceptable as fallback
  if (supportedMethods.includes('plain')) {
    console.warn('[OAuth Discovery] AS only supports plain PKCE method - using it as fallback');
    return true;
  }

  return false;
}

/**
 * Check if the Authorization Server supports Dynamic Client Registration
 */
export function supportsDcr(metadata: AuthServerMetadata): boolean {
  return !!metadata.registration_endpoint;
}

/**
 * Clear all cached metadata
 */
export function clearMetadataCache(): void {
  protectedResourceMetadataCache.clear();
  authServerMetadataCache.clear();
  console.log('[OAuth Discovery] Metadata cache cleared');
}

/**
 * Get the canonical URI for an MCP server (for RFC 8707 resource parameter)
 */
export function getCanonicalResourceUri(serverUrl: string): string {
  const url = new URL(serverUrl);
  // Remove trailing slash for consistency
  let canonical = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/$/, '');
  
  // Include port if non-standard
  if (url.port && 
      !((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80'))) {
    // Port is already included in url.host
  }
  
  return canonical;
}
