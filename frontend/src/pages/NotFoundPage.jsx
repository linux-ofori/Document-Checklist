import { ArrowLeft, Compass, Home, Plus } from 'lucide-react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { SiteFooter } from '../components/marketing/SiteFooter'
import { Button, Card, EmptyState } from '../components/ui'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { ROUTES } from '../utils/routes'

export function NotFoundPage() {
  const { navigate, path } = useActiveRoute()

  return (
    <MarketingLayout>
      <section className="marketing-section">
        <div className="marketing-container">
          <Card padding="spacious" className="not-found">
            <EmptyState
              icon={<Compass size={22} aria-hidden="true" />}
              title="We could not find that page"
              description={
                <>
                  Nothing lives at <code className="not-found__path">{path}</code>. It may have been
                  moved, or the link might be out of date.
                </>
              }
            >
              <div className="not-found__actions">
                <Button
                  variant="ghost"
                  size="md"
                  leadingIcon={<ArrowLeft size={16} aria-hidden="true" />}
                  onClick={() => navigate(ROUTES.landing)}
                >
                  Back to home
                </Button>
                <Button
                  variant="outline"
                  size="md"
                  leadingIcon={<Home size={16} aria-hidden="true" />}
                  onClick={() => navigate(ROUTES.dashboard)}
                >
                  Go to dashboard
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  leadingIcon={<Plus size={16} aria-hidden="true" />}
                  onClick={() => navigate(ROUTES.chooseProcess)}
                >
                  Start new application
                </Button>
              </div>
            </EmptyState>
          </Card>
        </div>
      </section>

      <SiteFooter />
    </MarketingLayout>
  )
}
