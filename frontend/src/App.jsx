import { useEffect } from 'react'
import { RouterProvider } from './context/RouterProvider'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { AppDataProvider } from './context/AppDataProvider'
import { ThemeProvider } from './context/ThemeProvider'
import { useActiveRoute } from './hooks/useActiveRoute'
import { matchRoute, ROUTES } from './utils/routes'
import { Alert, LoadingState } from './components/ui'
import { LandingPage } from './pages/LandingPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { DashboardPage } from './pages/DashboardPage'
import { ApplicationsPage } from './pages/ApplicationsPage'
import { ApplicationDetailPage } from './pages/ApplicationDetailPage'
import { ChooseProcessPage } from './pages/ChooseProcessPage'
import { DocumentsPage } from './pages/DocumentsPage'
import { RemindersPage } from './pages/RemindersPage'
import { ProfilePage } from './pages/ProfilePage'
import { SettingsPage } from './pages/SettingsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import './App.css'
import './components/product/product.css'

const PROTECTED_ROUTE_NAMES = new Set([
  'dashboard',
  'applications',
  'chooseProcess',
  'application',
  'documents',
  'reminders',
  'profile',
  'settings',
])

function renderRoute(route) {
  switch (route.name) {
    case 'landing':
      return <LandingPage />
    case 'login':
      return <LoginPage />
    case 'signup':
      return <SignupPage />
    case 'dashboard':
      return <DashboardPage />
    case 'applications':
      return <ApplicationsPage />
    case 'chooseProcess':
      return <ChooseProcessPage />
    case 'application':
      return <ApplicationDetailPage applicationId={route.params.id} />
    case 'documents':
      return <DocumentsPage />
    case 'reminders':
      return <RemindersPage />
    case 'profile':
      return <ProfilePage />
    case 'settings':
      return <SettingsPage />
    default:
      return <NotFoundPage />
  }
}

function AppRoutes() {
  const { path, navigate } = useActiveRoute()
  const { status, error } = useAuth()
  const route = matchRoute(path)
  const isProtectedRoute = PROTECTED_ROUTE_NAMES.has(route.name)

  useEffect(() => {
    if (isProtectedRoute && status === 'unauthenticated') {
      navigate(ROUTES.login)
    }
  }, [isProtectedRoute, navigate, status])

  if (isProtectedRoute && status === 'checking') {
    return <LoadingState label="Checking your session" />
  }

  if (isProtectedRoute && status === 'error') {
    return <Alert tone="danger" title="Unable to verify your session" description={error} />
  }

  if (isProtectedRoute && status !== 'authenticated') {
    return <LoadingState label="Redirecting to sign in" />
  }

  return renderRoute(route)
}

function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <AuthProvider>
          <AppDataProvider>
            <AppRoutes />
          </AppDataProvider>
        </AuthProvider>
      </RouterProvider>
    </ThemeProvider>
  )
}

export default App
