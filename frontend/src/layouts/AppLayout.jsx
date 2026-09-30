import { PageHeader } from '../components/ui'
import { AppShell } from '../components/layout'

export function AppLayout({ title, subtitle, actions, headerActions, children }) {
  const hasHeader = Boolean(title || subtitle || actions)

  return (
    <AppShell headerActions={headerActions}>
      {hasHeader ? <PageHeader title={title} subtitle={subtitle} actions={actions} /> : null}
      {children}
    </AppShell>
  )
}
