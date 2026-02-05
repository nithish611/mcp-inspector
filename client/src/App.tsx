import { Layout } from '@/components/Layout'
import { OAuthCallback } from '@/components/OAuthCallback'
import { useThemeStore } from '@/stores/themeStore'
import { useEffect, useState } from 'react'

function App() {
  const { theme } = useThemeStore()
  const [isOAuthCallback, setIsOAuthCallback] = useState(false)

  // Check if we're on the OAuth callback path
  useEffect(() => {
    const path = window.location.pathname
    setIsOAuthCallback(path === '/oauth/callback')
  }, [])

  // Initialize theme on mount
  useEffect(() => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
  }, [theme])

  // Handle OAuth callback
  if (isOAuthCallback) {
    return <OAuthCallback />
  }

  return <Layout />
}

export default App
