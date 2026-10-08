require('dotenv').config();

const net = require('node:net');
const jwt = require('jsonwebtoken');
const jwtSecret = process.env.JWT_SECRET;
if (typeof jwtSecret !== 'string' || jwtSecret.trim().length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 non-whitespace characters.');
}
if (jwtSecret.trim() === 'replace-this-with-a-random-secret-at-least-32-characters') {
  throw new Error('JWT_SECRET must not use the published example placeholder.');
}

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1d';
try {
  const token = jwt.sign({ iat: 1700000000 }, jwtSecret, { expiresIn: jwtExpiresIn });
  const payload = jwt.decode(token);
  if (!payload || !Number.isFinite(payload.exp) || payload.exp <= payload.iat) {
    throw new Error('JWT expiration must be positive.');
  }
} catch {
  throw new Error('JWT_EXPIRES_IN must be a valid expiration value that produces a positive lifetime.');
}

function configuredTrustedProxyIps(value) {
  if (value === undefined) {
    return [];
  }

  const entries = value.split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    const [address, prefix, extra] = entry.split('/');
    const family = net.isIP(address);
    if (!entry || family === 0 || extra !== undefined) {
      throw new Error('TRUSTED_PROXY_IPS must contain only comma-separated IP addresses or CIDRs.');
    }

    if (prefix !== undefined) {
      const prefixLength = Number(prefix);
      const maximumPrefix = family === 4 ? 32 : 128;
      if (!/^\d+$/.test(prefix) || prefixLength < 1 || prefixLength > maximumPrefix) {
        throw new Error('TRUSTED_PROXY_IPS must contain only valid IP addresses or CIDRs.');
      }
    }
  }

  return entries;
}

const trustedProxyIps = configuredTrustedProxyIps(process.env.TRUSTED_PROXY_IPS);
if (process.env.NODE_ENV === 'production' && trustedProxyIps.length === 0) {
  throw new Error('TRUSTED_PROXY_IPS must identify the HTTPS-terminating proxy in production.');
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createCorsOptions } = require('./config/cors');
const authRoutes = require('./routes/authRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const documentRoutes = require('./routes/documentRoutes');
require('./config/database');

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.set('trust proxy', trustedProxyIps.length > 0 ? trustedProxyIps : false);
if (process.env.NODE_ENV === 'production') {
  app.use((request, response, next) => {
    if (!request.secure) {
      return response.status(403).json({ error: 'HTTPS is required.' });
    }

    return next();
  });
}
app.use(cors(createCorsOptions()));
app.use(express.json({ limit: '10kb' }));
app.use('/api/auth', authRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/documents', documentRoutes);

app.use('/api', (request, response) => {
  return response.status(404).json({ error: 'Route not found.' });
});

app.use((error, request, response, next) => {
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'Request body is too large.' });
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return response.status(400).json({ error: 'Request body must contain valid JSON.' });
  }

  if (error.type === 'charset.unsupported' || error.type === 'encoding.unsupported') {
    return response.status(415).json({ error: 'Unsupported request encoding.' });
  }

  if (error.type === 'request.aborted' || error.type === 'request.size.invalid') {
    return response.status(400).json({ error: 'Invalid request body.' });
  }

  console.error(error);
  return response.status(500).json({ error: 'An unexpected server error occurred.' });
});

if (require.main === module) {
  authRoutes.recoverPendingAccountDeletions()
    .then(() => {
      app.listen(port, () => {
        console.log(`Document Checklist API listening on http://localhost:${port}`);
      });
    })
    .catch((error) => {
      console.error('Unable to recover pending account deletions before startup.', error);
      process.exitCode = 1;
    });
}

module.exports = app;
