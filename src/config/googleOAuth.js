const { configuredCorsOrigins } = require('./cors');

function parseCallbackUrl(value, name, environment) {
  if (typeof value !== 'string' || !value.trim() || /[\s\\]/.test(value)) {
    throw new Error(`${name} must be a valid absolute callback URL.`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute callback URL.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
      || !parsed.hostname) {
    throw new Error(`${name} must not contain credentials, a query, or a fragment.`);
  }

  if (parsed.protocol !== 'https:') {
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    if (environment.NODE_ENV === 'production' || !localHosts.has(parsed.hostname)) {
      throw new Error(`${name} must use HTTPS except for a local development callback.`);
    }
  }

  return parsed;
}

function loadGoogleOAuthConfig(environment = process.env) {
  const enabledValue = environment.GOOGLE_OAUTH_ENABLED;
  if (enabledValue !== undefined && enabledValue !== 'true' && enabledValue !== 'false') {
    throw new Error('GOOGLE_OAUTH_ENABLED must be either true or false.');
  }

  if (enabledValue !== 'true') {
    return {
      enabled: false,
      clientId: null,
      clientSecret: null,
      redirectUri: null,
      frontendCallbackUrl: null
    };
  }

  const clientId = typeof environment.GOOGLE_CLIENT_ID === 'string'
    ? environment.GOOGLE_CLIENT_ID.trim()
    : '';
  const clientSecret = typeof environment.GOOGLE_CLIENT_SECRET === 'string'
    ? environment.GOOGLE_CLIENT_SECRET.trim()
    : '';

  if (!clientId || /[\r\n]/.test(clientId)) {
    throw new Error('GOOGLE_CLIENT_ID must be configured when Google OAuth is enabled.');
  }
  if (!clientSecret || /[\r\n]/.test(clientSecret)) {
    throw new Error('GOOGLE_CLIENT_SECRET must be configured when Google OAuth is enabled.');
  }

  const redirect = parseCallbackUrl(
    environment.GOOGLE_REDIRECT_URI,
    'GOOGLE_REDIRECT_URI',
    environment
  );
  if (redirect.pathname !== '/api/auth/google/callback') {
    throw new Error('GOOGLE_REDIRECT_URI must use the configured Google callback path.');
  }

  const frontendCallback = parseCallbackUrl(
    environment.FRONTEND_AUTH_CALLBACK_URL,
    'FRONTEND_AUTH_CALLBACK_URL',
    environment
  );
  if (!configuredCorsOrigins(environment).includes(frontendCallback.origin)) {
    throw new Error('FRONTEND_AUTH_CALLBACK_URL origin must be included in CORS_ALLOWED_ORIGINS.');
  }

  return {
    enabled: true,
    clientId,
    clientSecret,
    redirectUri: redirect.toString(),
    frontendCallbackUrl: frontendCallback.toString()
  };
}

module.exports = { loadGoogleOAuthConfig };
