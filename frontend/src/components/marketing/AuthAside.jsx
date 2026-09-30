import { Brand } from '../navigation/Brand'
import { useActiveRoute } from '../../hooks/useActiveRoute'
import { ROUTES } from '../../utils/routes'

const POINTS = [
  'Personal checklists for every process you are applying to',
  'One document library reused across applications',
  'Reminders before anything expires or goes missing',
]

export function AuthBrand({ className }) {
  const { navigate } = useActiveRoute()

  return (
    <a
      href={ROUTES.landing}
      className={className}
      onClick={(event) => {
        event.preventDefault()
        navigate(ROUTES.landing)
      }}
    >
      <Brand />
    </a>
  )
}

export function AuthAside({ headline, lead }) {
  return (
    <aside className="marketing-auth__aside">
      <AuthBrand className="marketing-auth__brand" />

      <div>
        <h2 className="marketing-auth__headline">{headline}</h2>
        <p className="marketing-auth__lead">{lead}</p>

        <ul className="marketing-auth__points">
          {POINTS.map((point) => (
            <li key={point} className="marketing-auth__point">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="m5 13 4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="marketing-auth__quote">
        “I stopped keeping passports and certificates in three different photo albums. Now I open one
        page and I know exactly what is left.”
      </p>
    </aside>
  )
}

export function AuthMobileBrand() {
  return (
    <div className="marketing-auth__mobile-brand">
      <AuthBrand className="marketing-auth__brand" />
    </div>
  )
}
