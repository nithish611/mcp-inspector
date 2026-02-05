/**
 * PKCE (Proof Key for Code Exchange) Module (RFC 7636)
 * Implements secure code verifier and challenge generation for OAuth 2.1
 */

import crypto from 'crypto';

/**
 * Character set for code verifier (RFC 7636 Section 4.1)
 * ALPHA / DIGIT / "-" / "." / "_" / "~"
 */
const CODE_VERIFIER_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

/**
 * Generate a cryptographically random code verifier
 * Per RFC 7636, the verifier must be 43-128 characters long
 * 
 * @param length Length of the verifier (default: 64, recommended for security)
 * @returns A random code verifier string
 */
export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error('Code verifier length must be between 43 and 128 characters');
  }

  const randomBytes = crypto.randomBytes(length);
  let verifier = '';
  
  for (let i = 0; i < length; i++) {
    // Use modulo to map random byte to charset index
    verifier += CODE_VERIFIER_CHARSET[randomBytes[i] % CODE_VERIFIER_CHARSET.length];
  }
  
  return verifier;
}

/**
 * Generate a code challenge from a code verifier using S256 method
 * Per RFC 7636 Section 4.2:
 * code_challenge = BASE64URL(SHA256(code_verifier))
 * 
 * @param verifier The code verifier to hash
 * @returns Base64URL-encoded SHA256 hash of the verifier
 */
export function generateCodeChallengeS256(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier, 'ascii').digest();
  return base64UrlEncode(hash);
}

/**
 * Generate a code challenge using the plain method (less secure, fallback only)
 * Per RFC 7636 Section 4.2:
 * code_challenge = code_verifier
 * 
 * @param verifier The code verifier
 * @returns The verifier itself (no transformation)
 */
export function generateCodeChallengePlain(verifier: string): string {
  return verifier;
}

/**
 * Generate a code challenge with the specified method
 * 
 * @param verifier The code verifier
 * @param method The challenge method ('S256' or 'plain')
 * @returns The code challenge
 */
export function generateCodeChallenge(verifier: string, method: 'S256' | 'plain' = 'S256'): string {
  if (method === 'S256') {
    return generateCodeChallengeS256(verifier);
  } else if (method === 'plain') {
    return generateCodeChallengePlain(verifier);
  } else {
    throw new Error(`Unsupported PKCE method: ${method}`);
  }
}

/**
 * Base64URL encode a buffer
 * Per RFC 4648 Section 5, this is base64 with:
 * - '+' replaced with '-'
 * - '/' replaced with '_'
 * - Padding ('=') removed
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Generate a random state parameter for CSRF protection
 * 
 * @param length Length of the state string (default: 32)
 * @returns A random state string
 */
export function generateState(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Verify that a code verifier matches a code challenge
 * Used for testing/validation purposes
 * 
 * @param verifier The original code verifier
 * @param challenge The code challenge to verify against
 * @param method The challenge method used
 * @returns True if the verifier matches the challenge
 */
export function verifyCodeChallenge(
  verifier: string,
  challenge: string,
  method: 'S256' | 'plain' = 'S256'
): boolean {
  const computedChallenge = generateCodeChallenge(verifier, method);
  return computedChallenge === challenge;
}

/**
 * Determine the best PKCE method to use based on server support
 * 
 * @param supportedMethods Array of methods supported by the server
 * @returns The best method to use, or null if none supported
 */
export function selectPkceMethod(supportedMethods?: string[]): 'S256' | 'plain' | null {
  if (!supportedMethods || supportedMethods.length === 0) {
    // If not specified, assume S256 is supported (OAuth 2.1 requirement)
    console.log('[PKCE] Server does not advertise PKCE support, defaulting to S256');
    return 'S256';
  }

  // Prefer S256 (more secure)
  if (supportedMethods.includes('S256')) {
    return 'S256';
  }

  // Fall back to plain if S256 not available
  if (supportedMethods.includes('plain')) {
    console.warn('[PKCE] Using plain method as fallback (less secure)');
    return 'plain';
  }

  // No supported method
  return null;
}

/**
 * Generate a complete PKCE pair (verifier and challenge)
 * 
 * @param method The challenge method to use (default: 'S256')
 * @returns Object containing verifier, challenge, and method
 */
export function generatePkcePair(method: 'S256' | 'plain' = 'S256'): {
  verifier: string;
  challenge: string;
  method: 'S256' | 'plain';
} {
  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier, method);
  
  return {
    verifier,
    challenge,
    method,
  };
}
