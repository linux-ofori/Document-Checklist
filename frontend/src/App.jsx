import { RouterProvider } from './context/RouterProvider'
import { AppDataProvider } from './context/AppDataProvider'
import { ThemeProvider } from './context/ThemeProvider'
import { useActiveRoute } from './hooks/useActiveRoute'
import { matchRoute } from './utils/routes'
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
  const { path } = useActiveRoute()

  return renderRoute(matchRoute(path))
}

function App() {
  return (
    <ThemeProvider>
      <RouterProvider>
        <AppDataProvider>
          <AppRoutes />
        </AppDataProvider>
      </RouterProvider>
    </ThemeProvider>
  )
}

export default App
