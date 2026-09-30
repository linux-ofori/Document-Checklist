import { ArrowRight, Check, CircleCheck, FileText, FolderOpen, ListChecks, Sparkles } from 'lucide-react'
import { MarketingLayout } from '../layouts/MarketingLayout'
import { SiteFooter } from '../components/marketing/SiteFooter'
import { ProgressBar, StatusBadge } from '../components/ui'
import { LANDING_FEATURES, LANDING_PROOF_POINTS, LANDING_STEPS } from '../data'
import { useActiveRoute } from '../hooks/useActiveRoute'
import { ROUTES } from '../utils/routes'

const FEATURE_ICONS = {
  list: ListChecks,
  folder: FolderOpen,
  sparkles: Sparkles,
}

const FEATURE_TONES = {
  list: '',
  folder: 'marketing-feature--accent',
  sparkles: 'marketing-feature--success',
}

const PREVIEW_ROWS = [
  { id: 'ghana-card', label: 'Ghana Card', meta: 'Verified · expires Mar 2031', state: 'done' },
  { id: 'photo', label: 'Passport Photograph', meta: 'In review · 35mm × 45mm', state: 'done' },
  { id: 'birth', label: 'Birth Certificate', meta: 'Missing · upload required', state: 'pending' },
  { id: 'form', label: 'Application Form', meta: 'In progress · signature missing', state: 'progress' },
]

const PREVIEW_STATS = [
  { id: 'apps', value: '4', label: 'Active applications' },
  { id: 'docs', value: '22', label: 'Documents tracked' },
  { id: 'done', value: '61%', label: 'Busiest checklist' },
]

export function LandingPage() {
  const { navigate } = useActiveRoute()

  return (
    <MarketingLayout>
      <section className="marketing-hero" id="about">
        <div className="marketing-container marketing-hero__inner">
          <div className="marketing-hero__content">
            <span className="marketing-eyebrow">
              <Sparkles size={14} aria-hidden="true" />
              Personal documentation assistant
            </span>

            <h1 className="marketing-hero__title">Know what you need, before you need it.</h1>

            <p className="marketing-hero__lead">
              Smart Document Checklist turns paperwork into a checklist you can finish. Pick the process
              you are applying for, see exactly which documents the office expects, upload each one
              once, and get warned long before anything expires.
            </p>

            <div className="marketing-hero__actions">
              <a
                href={ROUTES.signup}
                className="ui-btn ui-btn--primary ui-btn--lg"
                onClick={(event) => {
                  event.preventDefault()
                  navigate(ROUTES.signup)
                }}
              >
                Get started free
                <ArrowRight size={17} aria-hidden="true" />
              </a>

              <a
                href={ROUTES.dashboard}
                className="ui-btn ui-btn--outline ui-btn--lg"
                onClick={(event) => {
                  event.preventDefault()
                  navigate(ROUTES.dashboard)
                }}
              >
                Learn more
              </a>
            </div>

            <ul className="marketing-hero__proof">
              {LANDING_PROOF_POINTS.map((point) => (
                <li key={point}>
                  <CircleCheck size={16} aria-hidden="true" />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="marketing-hero__visual">
            <div className="marketing-preview">
              <div className="marketing-preview__head">
                <span className="marketing-preview__title">Passport Application</span>
                <StatusBadge status="pending">In progress</StatusBadge>
              </div>

              <div>
                <ProgressBar value={36} label="Overall progress" variant="primary" />
              </div>

              {PREVIEW_ROWS.map((row) => (
                <div key={row.id} className="marketing-preview__row">
                  <span
                    className={`marketing-preview__icon marketing-preview__icon--${row.state}`}
                    aria-hidden="true"
                  >
                    {row.state === 'done' ? <Check size={15} /> : <FileText size={15} />}
                  </span>
                  <span className="marketing-preview__body">
                    <span className="marketing-preview__label">{row.label}</span>
                    <span className="marketing-preview__meta">{row.meta}</span>
                  </span>
                </div>
              ))}

              <div className="marketing-preview__stats">
                {PREVIEW_STATS.map((stat) => (
                  <div key={stat.id} className="marketing-preview__stat">
                    <span className="marketing-preview__stat-value">{stat.value}</span>
                    <span className="marketing-preview__stat-label">{stat.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="marketing-section" id="features">
        <div className="marketing-container">
          <div className="marketing-section__head">
            <span className="ui-eyebrow">What you get</span>
            <h2 className="marketing-section__title">
              Everything paperwork asks of you, in one place
            </h2>
            <p className="marketing-section__lead">
              No more guessing which certificate the immigration office wants, or realising a tax
              clearance expired the week you needed it.
            </p>
          </div>

          <div className="marketing-grid">
            {LANDING_FEATURES.map((feature) => {
              const Icon = FEATURE_ICONS[feature.icon] ?? ListChecks

              return (
                <article
                  key={feature.id}
                  className={`marketing-feature ${FEATURE_TONES[feature.icon] ?? ''}`}
                >
                  <span className="marketing-feature__icon" aria-hidden="true">
                    <Icon size={20} />
                  </span>
                  <h3 className="marketing-feature__title">{feature.title}</h3>
                  <p className="marketing-feature__body">{feature.description}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="marketing-section marketing-section--tinted" id="how-it-works">
        <div className="marketing-container">
          <div className="marketing-section__head">
            <span className="ui-eyebrow">How it works</span>
            <h2 className="marketing-section__title">Four steps, then you are done</h2>
            <p className="marketing-section__lead">
              Most people finish a checklist in under ten minutes once the list is in front of them.
            </p>
          </div>

          <ol className="marketing-steps">
            {LANDING_STEPS.map((step, index) => (
              <li key={step.id} className="marketing-step">
                <span className="marketing-step__number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="marketing-step__title">{step.title}</h3>
                <p className="marketing-step__body">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="marketing-section" id="reminders">
        <div className="marketing-container">
          <div className="marketing-section__head">
            <span className="ui-eyebrow">Smart guidance</span>
            <h2 className="marketing-section__title">Reminders that arrive before the problem does</h2>
            <p className="marketing-section__lead">
              We watch every date on every document you upload, and every gap in every checklist you
              are working on.
            </p>
          </div>

          <div className="marketing-grid">
            <article className="marketing-feature">
              <span className="marketing-feature__icon" aria-hidden="true">
                <CircleCheck size={20} />
              </span>
              <h3 className="marketing-feature__title">Expiry reminders</h3>
              <p className="marketing-feature__body">
                Sixty, thirty and seven days before a document runs out, with a note about which
                application depends on it.
              </p>
            </article>

            <article className="marketing-feature marketing-feature--accent">
              <span className="marketing-feature__icon" aria-hidden="true">
                <ListChecks size={20} />
              </span>
              <h3 className="marketing-feature__title">Missing document alerts</h3>
              <p className="marketing-feature__body">
                A clear list of what is still missing, ordered by how soon you need it, so nothing is
                discovered at the counter.
              </p>
            </article>

            <article className="marketing-feature marketing-feature--success">
              <span className="marketing-feature__icon" aria-hidden="true">
                <Sparkles size={20} />
              </span>
              <h3 className="marketing-feature__title">Ask AI</h3>
              <p className="marketing-feature__body">
                Ask what is left, which document expires first, or what you can submit today, and get
                an answer built from your own checklists.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="marketing-cta">
        <div className="marketing-container marketing-cta__inner">
          <h2 className="marketing-cta__title">Start your first checklist in two minutes</h2>
          <p className="marketing-cta__lead">
            Create an account, pick the process you are applying for, and you will have a full document
            list with every requirement before you finish your coffee.
          </p>

          <div className="marketing-hero__actions">
            <a
              href={ROUTES.signup}
              className="ui-btn ui-btn--primary ui-btn--lg"
              onClick={(event) => {
                event.preventDefault()
                navigate(ROUTES.signup)
              }}
            >
              Get started free
              <ArrowRight size={17} aria-hidden="true" />
            </a>

            <a
              href={ROUTES.login}
              className="ui-btn ui-btn--outline ui-btn--lg"
              onClick={(event) => {
                event.preventDefault()
                navigate(ROUTES.login)
              }}
            >
              I already have an account
            </a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </MarketingLayout>
  )
}
