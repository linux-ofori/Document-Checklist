import { useState } from 'react'
import { cn } from '../../utils/cn'
import { useActiveRoute } from '../../hooks/useActiveRoute'
import { useAppData } from '../../hooks/useAppData'
import { demoUser, primaryCta, primaryNavigation, secondaryNavigation } from '../../data/navigation'
import { ROUTES, matchRoute } from '../../utils/routes'
import { Sidebar, TopHeader, MobileNavigation } from '../navigation'

const SECTION_TITLES = {
  dashboard: 'Dashboard',
  applications: 'Applications',
  application: 'Checklist',
  chooseProcess: 'Start a new application',
  documents: 'My documents',
  reminders: 'Reminders',
  profile: 'Profile',
  settings: 'Settings',
  notFound: 'Page not found',
}

export function AppShell({ children, className, headerActions }) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const { path, navigate } = useActiveRoute()
  const { stats } = useAppData()

  const route = matchRoute(path)
  const title = SECTION_TITLES[route.name] ?? 'Overview'

  return (
    <div className={cn('app-shell', className)}>
      <MobileNavigation
        isOpen={isMobileNavOpen}
        onOpenChange={setIsMobileNavOpen}
        primaryItems={primaryNavigation}
        secondaryItems={secondaryNavigation}
        primaryCta={primaryCta}
        user={demoUser}
        path={path}
        onNavigate={navigate}
      />

      <Sidebar
        primaryItems={primaryNavigation}
        secondaryItems={secondaryNavigation}
        primaryCta={primaryCta}
        user={demoUser}
        path={path}
        onNavigate={navigate}
      />

      <div className="app-main">
        <TopHeader
          title={title}
          user={demoUser}
          actions={headerActions}
          unreadCount={stats?.unreadNotifications ?? 0}
          onOpenReminders={() => navigate(ROUTES.reminders)}
          onOpenProfile={() => navigate(ROUTES.profile)}
        />

        <main className="app-content" id="main-content">
          <div className="app-content__inner">{children}</div>
        </main>
      </div>
    </div>
  )
}
