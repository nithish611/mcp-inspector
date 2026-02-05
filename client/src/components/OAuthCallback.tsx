import { useOAuthCallback } from '@/hooks/useApi'
import { useConnectionStore } from '@/stores/connectionStore'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface OAuthCallbackProps {
  onSuccess?: () => void
  onError?: (error: string) => void
}

/**
 * OAuth Callback Handler Component
 * 
 * This component handles the OAuth callback redirect from the authorization server.
 * It extracts the authorization code and state from the URL, exchanges them for tokens,
 * and redirects back to the main application.
 * 
 * Usage:
 * - Mount this component at the OAuth redirect URI path (e.g., /oauth/callback)
 * - It will automatically process the callback and redirect to the main page
 */
export function OAuthCallback({ onSuccess, onError }: OAuthCallbackProps) {
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [errorMessage, setErrorMessage] = useState<string>('')
  const oauthCallbackMutation = useOAuthCallback()
  const { config, setStatus: setConnectionStatus } = useConnectionStore()
  
  // Prevent duplicate processing
  const processedRef = useRef(false)

  useEffect(() => {
    // Prevent duplicate calls (React StrictMode or multiple renders)
    if (processedRef.current) {
      return
    }
    processedRef.current = true

    const processCallback = async () => {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const state = params.get('state')
      const error = params.get('error')
      const errorDescription = params.get('error_description')

      // Handle OAuth error response
      if (error) {
        const message = errorDescription || error
        setStatus('error')
        setErrorMessage(message)
        onError?.(message)
        
        // Redirect to main page with error after delay
        setTimeout(() => {
          window.location.href = `/?oauth_error=${encodeURIComponent(message)}`
        }, 2000)
        return
      }

      // Validate required parameters
      if (!code || !state) {
        const message = 'Missing authorization code or state parameter'
        setStatus('error')
        setErrorMessage(message)
        onError?.(message)
        
        setTimeout(() => {
          window.location.href = `/?oauth_error=${encodeURIComponent(message)}`
        }, 2000)
        return
      }

      try {
        // Exchange code for tokens
        await oauthCallbackMutation.mutateAsync({
          code,
          state,
          redirectUri: config.oauth?.redirectUri,
          clientId: config.oauth?.clientId,
          clientSecret: config.oauth?.clientSecret,
          scopes: config.oauth?.scopes,
        })

        setStatus('success')
        onSuccess?.()

        // Update connection status
        setConnectionStatus({
          connected: false,
          oauth: {
            authenticated: true,
          },
        })

        // Redirect to main page with success
        setTimeout(() => {
          window.location.href = '/?oauth_success=true'
        }, 1500)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Token exchange failed'
        setStatus('error')
        setErrorMessage(message)
        onError?.(message)

        setTimeout(() => {
          window.location.href = `/?oauth_error=${encodeURIComponent(message)}`
        }, 2000)
      }
    }

    processCallback()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full mx-4">
        <div className="bg-card rounded-lg border border-border shadow-lg p-8 text-center">
          {status === 'processing' && (
            <>
              <Loader2 className="h-12 w-12 mx-auto mb-4 text-primary animate-spin" />
              <h2 className="text-xl font-semibold mb-2">Processing Authorization</h2>
              <p className="text-muted-foreground">
                Please wait while we complete the authorization...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-500" />
              <h2 className="text-xl font-semibold mb-2 text-green-600 dark:text-green-400">
                Authorization Successful
              </h2>
              <p className="text-muted-foreground">
                You have been authorized. Redirecting back to the application...
              </p>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
              <h2 className="text-xl font-semibold mb-2 text-destructive">
                Authorization Failed
              </h2>
              <p className="text-muted-foreground mb-4">{errorMessage}</p>
              <p className="text-sm text-muted-foreground">
                Redirecting back to the application...
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Standalone OAuth callback page component
 * Use this if you want a dedicated route for OAuth callbacks
 */
export function OAuthCallbackPage() {
  return <OAuthCallback />
}

export default OAuthCallback
