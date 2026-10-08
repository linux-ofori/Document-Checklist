import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { clearAuthToken, hasAuthToken, request } from '../services'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('checking')
  const [error, setError] = useState('')
  const verificationId = useRef(0)

  useEffect(() => {
    let isActive = true
    const currentVerificationId = verificationId.current

    const verifySession = async () => {
      if (!hasAuthToken()) {
        if (isActive) {
          setStatus('unauthenticated')
        }
        return
      }

      try {
        const result = await request('auth/me')
        if (!isActive || verificationId.current !== currentVerificationId) return

        if (result?.user) {
          setUser(result.user)
          setStatus('authenticated')
          return
        }

        clearAuthToken()
        setStatus('unauthenticated')
      } catch (requestError) {
        if (!isActive || verificationId.current !== currentVerificationId) return

        if (requestError.status === 401) {
          clearAuthToken()
          setStatus('unauthenticated')
        } else {
          setError('We could not verify your session. Check your connection and try again.')
          setStatus('error')
        }
      }
    }

    verifySession()
    return () => {
      isActive = false
    }
  }, [])

  const authenticate = useCallback((authenticatedUser) => {
    verificationId.current += 1
    setUser(authenticatedUser)
    setError('')
    setStatus('authenticated')
  }, [])

  const updateUser = useCallback((updatedUser) => {
    if (!updatedUser) return

    verificationId.current += 1
    setUser((currentUser) => ({
      ...currentUser,
      ...updatedUser,
      preferences: updatedUser.preferences
        ? { ...currentUser?.preferences, ...updatedUser.preferences }
        : currentUser?.preferences,
    }))
  }, [])

  const signOut = useCallback(() => {
    verificationId.current += 1
    clearAuthToken()
    setUser(null)
    setError('')
    setStatus('unauthenticated')
  }, [])

  return (
    <AuthContext.Provider value={{ user, status, error, authenticate, updateUser, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) {
    throw new Error('useAuth must be used inside an AuthProvider.')
  }

  return auth
}