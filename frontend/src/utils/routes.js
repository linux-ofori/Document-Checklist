export const ROUTES = {
  landing: '/',
  login: '/login',
  signup: '/signup',
  dashboard: '/dashboard',
  applications: '/applications',
  chooseProcess: '/applications/new',
  application: '/applications/:id',
  documents: '/documents',
  reminders: '/reminders',
  profile: '/profile',
  settings: '/settings',
}

export const NAVIGATION_ROUTES = [
  ROUTES.landing,
  ROUTES.login,
  ROUTES.signup,
  ROUTES.dashboard,
  ROUTES.applications,
  ROUTES.chooseProcess,
  ROUTES.documents,
  ROUTES.reminders,
  ROUTES.profile,
  ROUTES.settings,
]

const ROUTE_DEFINITIONS = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
  { name: 'dashboard', path: '/dashboard' },
  { name: 'applications', path: '/applications' },
  { name: 'chooseProcess', path: '/applications/new' },
  { name: 'application', path: '/applications/:id' },
  { name: 'documents', path: '/documents' },
  { name: 'reminders', path: '/reminders' },
  { name: 'profile', path: '/profile' },
  { name: 'settings', path: '/settings' },
]

function normalisePath(path) {
  if (!path) return '/'
  const withoutTrailingSlash = path.length > 1 ? path.replace(/\/+$/, '') : path
  return withoutTrailingSlash || '/'
}

function matchDefinition(definition, target) {
  if (!definition.path.includes(':')) {
    return target === definition.path ? {} : null
  }

  const keys = []
  const pattern = definition.path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment
      keys.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')

  const match = new RegExp(`^${pattern}$`).exec(target)
  if (!match) return null

  const params = {}
  keys.forEach((key, index) => {
    params[key] = decodeURIComponent(match[index + 1])
  })

  return params
}

export function matchRoute(path) {
  const target = normalisePath(path)

  for (const definition of ROUTE_DEFINITIONS) {
    const params = matchDefinition(definition, target)
    if (params) return { name: definition.name, params }
  }

  return { name: 'notFound', params: {} }
}

export function isNavigationPath(path) {
  return NAVIGATION_ROUTES.includes(normalisePath(path))
}

export function toRoutePath(routeName, params = {}) {
  const definition = ROUTE_DEFINITIONS.find((entry) => entry.name === routeName)
  if (!definition) return ROUTES.dashboard

  return normalisePath(
    definition.path.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
      const value = params[key]
      return value === undefined || value === null ? '' : String(value)
    }),
  )
}
