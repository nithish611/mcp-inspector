/**
 * OAuth Module Exports
 * Provides OAuth 2.1 authorization with DCR support for MCP clients
 */

// Discovery (RFC 9728, RFC 8414)
export {
    clearMetadataCache as clearDiscoveryCache, discoverAuthServerMetadata, discoverProtectedResourceMetadata, getCanonicalResourceUri, parseWwwAuthenticateHeader, supportsDcr, verifyPkceSupport
} from './discovery.js';

// Dynamic Client Registration (RFC 7591)
export {
    clearRegisteredClients,
    getAllRegisteredClients, getRegisteredClient, initializeDcr,
    registerClient, removeRegisteredClient
} from './dcr.js';

// PKCE (RFC 7636)
export {
    generateCodeChallenge, generateCodeChallengePlain, generateCodeChallengeS256, generateCodeVerifier, generatePkcePair, generateState, selectPkceMethod,
    verifyCodeChallenge
} from './pkce.js';

// Token Management
export {
    canRefresh, clearAllTokens, exchangeCodeForTokens, getTokens, getTokenStatus, getValidAccessToken, hasValidTokens, initializeTokenManager, needsRefresh, refreshTokens, removeTokens, revokeTokens, storeTokens
} from './tokenManager.js';

// Auth Flow Orchestration
export {
    clearMetadataCache, getAccessToken,
    getOAuthStatus, getPendingState, handle401Response,
    handle403Response, handleAuthCallback, hasPendingAuthorization, initiateAuthFlow, revokeAuthorization
} from './authFlow.js';

/**
 * Initialize the OAuth module with encryption key
 */
import { initializeDcr } from './dcr.js';
import { initializeTokenManager } from './tokenManager.js';

export function initializeOAuth(encryptionKey?: string): void {
  initializeDcr(encryptionKey);
  initializeTokenManager(encryptionKey);
  console.log('[OAuth] Module initialized');
}
