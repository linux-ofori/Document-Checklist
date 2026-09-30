import './marketing.css'
import { Brand } from '../components/navigation/Brand'
import { ThemeToggle } from '../components/ui'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { ROUTES } from '../utils/routes'
import { MARKETING_LINKS } from '../data'

export function MarketingLayout({ children, variant = 'default', className }) {
  const { navigate, path } = useActiveRoute()

  const isLanding = path === ROUTES.landing
  const showHeader = variant !== 'bare'

  return (
    <div className={['marketing-shell', `marketing-shell--${variant}`, className].filter(Boolean).join(' ')}>
      {showHeader ? (
        <header className="marketing-header">
          <div className="marketing-container marketing-header__inner">
            <a
              href={ROUTES.landing}
              className="marketing-header__brand"
              onClick={(event) => {
                event.preventDefault()
                navigate(ROUTES.landing)
              }}
            >
              <Brand />
            </a>

            {isLanding ? (
              <nav className="marketing-header__nav" aria-label="Marketing navigation">
                {MARKETING_LINKS.map((link) => (
                  <a key={link.id} className="marketing-header__link" href={link.href}>
                    {link.label}
                  </a>
                ))}
              </nav>
            ) : null}

            <div className="marketing-header__actions">
              <a
                href={ROUTES.login}
                className="marketing-header__link"
                onClick={(event) => {
                  event.preventDefault()
                  navigate(ROUTES.login)
                }}
              >
                Log in
              </a>
              <a
                href={ROUTES.signup}
                className="ui-btn ui-btn--primary ui-btn--md marketing-header__cta"
                onClick={(event) => {
                  event.preventDefault()
                  navigate(ROUTES.signup)
                }}
              >
                Get started
              </a>

              <ThemeToggle />
            </div>
          </div>
        </header>
      ) : null}

      <main className="marketing-main">{children}</main>
    </div>
  )
}
