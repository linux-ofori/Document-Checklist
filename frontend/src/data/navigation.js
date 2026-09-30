import {
  Bell,
  FileStack,
  FolderOpen,
  LayoutDashboard,
  Route,
  Settings,
  User,
} from 'lucide-react'

export const APP_NAME = 'Smart Document Checklist'
export const APP_SHORT_NAME = 'SDC'
export const APP_TAGLINE = 'Documents, organised'

export const primaryNavigation = [
  { id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { id: 'applications', label: 'Applications', href: '/applications', icon: FileStack },
  { id: 'documents', label: 'Documents', href: '/documents', icon: FolderOpen },
  { id: 'reminders', label: 'Reminders', href: '/reminders', icon: Bell },
  { id: 'profile', label: 'Profile', href: '/profile', icon: User },
]

export const secondaryNavigation = [
  { id: 'settings', label: 'Settings', href: '/settings', icon: Settings },
]

export const primaryCta = {
  id: 'start-application',
  label: 'Start New Application',
  href: '/applications/new',
  icon: Route,
}

export const demoUser = {
  id: 'usr-20481',
  name: 'Ama Serwaa Boateng',
  email: 'ama.boateng@example.com',
  role: 'Personal account',
}
