const developmentOrigin = 'http://localhost:5173';

function configuredCorsOrigins(environment = process.env) {
  const isProduction = environment.NODE_ENV === 'production';
  const configuredOrigins = environment.CORS_ALLOWED_ORIGINS;

  if (configuredOrigins === undefined) {
    if (isProduction) {
      throw new Error('CORS_ALLOWED_ORIGINS must be configured in production.');
    }

    return [developmentOrigin];
  }

  if (typeof configuredOrigins !== 'string' || configuredOrigins.trim() === '') {
    throw new Error('CORS_ALLOWED_ORIGINS must contain one or more exact origins.');
  }

  const origins = configuredOrigins.split(',').map((origin) => origin.trim());
  if (origins.some((origin) => !origin)) {
    throw new Error('CORS_ALLOWED_ORIGINS must contain one or more exact origins.');
  }

  return origins.map((origin) => {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error('CORS_ALLOWED_ORIGINS must contain valid exact origins.');
    }

    if (origin.includes('*')
        || !['http:', 'https:'].includes(parsedOrigin.protocol)
        || !parsedOrigin.hostname
        || parsedOrigin.username
        || parsedOrigin.password
        || parsedOrigin.pathname !== '/'
        || parsedOrigin.search
        || parsedOrigin.hash
        || parsedOrigin.origin !== origin) {
      throw new Error('CORS_ALLOWED_ORIGINS must contain exact origins without paths, credentials, or wildcards.');
    }

    if (isProduction && parsedOrigin.protocol !== 'https:') {
      throw new Error('CORS_ALLOWED_ORIGINS must use HTTPS in production.');
    }

    return origin;
  });
}

function createCorsOptions(environment = process.env) {
  const origins = configuredCorsOrigins(environment);

  return {
    origin: (origin, callback) => {
      callback(null, origins.includes(origin) ? origin : false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
  };
}

module.exports = { createCorsOptions, configuredCorsOrigins };
