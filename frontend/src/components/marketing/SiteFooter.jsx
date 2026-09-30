import { Brand } from '../navigation/Brand'
import { LANDING_FOOTER_LINKS } from '../../data'

export function SiteFooter() {
  return (
    <footer className="marketing-footer">
      <div className="marketing-container">
        <div className="marketing-footer__grid">
          <div className="marketing-footer__brand">
            <Brand />
            <p className="marketing-footer__tagline">
              A personal documentation assistant that tells you what you need, keeps track of what you
              have, and warns you before anything expires.
            </p>
          </div>

          {LANDING_FOOTER_LINKS.map((column) => (
            <nav key={column.id} className="marketing-footer__column" aria-label={column.title}>
              <p className="marketing-footer__title">{column.title}</p>
              <ul className="marketing-footer__links">
                {column.links.map((link) => (
                  <li key={link.id}>
                    <a className="marketing-footer__link" href={link.href}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="marketing-footer__bottom">
          <span>© 2026 Smart Document Checklist. All rights reserved.</span>
          <span>Built for people who are tired of missing paperwork.</span>
        </div>
      </div>
    </footer>
  )
}
