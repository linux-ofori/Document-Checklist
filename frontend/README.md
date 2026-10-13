# Document Checklist frontend

React and Vite client for the Document Checklist API.

## Local development

1. Copy `.env.example` to `.env.local` and set `VITE_API_BASE_URL` if the API is not at the default local URL.
2. Start the backend with its email and Google OAuth services disabled unless those features are configured.
3. Run `npm run dev` from this directory. The default frontend origin is `http://localhost:5173`.

Frontend configuration is limited to `VITE_API_BASE_URL` in `.env.local`. Backend configuration is separate: set `CORS_ALLOWED_ORIGINS` to the exact frontend origin and configure Google OAuth on the backend with `GOOGLE_OAUTH_ENABLED=true`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `FRONTEND_AUTH_CALLBACK_URL`. For local development, use `http://localhost:3000/api/auth/google/callback` as `GOOGLE_REDIRECT_URI` and register that exact URI with Google; set `FRONTEND_AUTH_CALLBACK_URL` to `http://localhost:5173/auth/google/callback`. Use the corresponding HTTPS origins and callback URLs in production. Never put the client secret in frontend configuration.

## Backend email configuration

Configure `EMAIL_ENABLED` and `EMAIL_FROM` on the backend; `EMAIL_REPLY_TO` is optional. Set `FRONTEND_EMAIL_VERIFICATION_URL` and `FRONTEND_PASSWORD_RESET_URL` to the frontend verification and reset pages (locally, `http://localhost:5173/verify-email` and `http://localhost:5173/reset-password`). Actual email delivery also requires a configured email adapter/provider. The provider is still undecided, so these settings alone do not enable delivery.

The OAuth exchange ticket is read from the URL fragment and removed from browser history before exchange; access tokens are never placed in a URL.

Password recovery uses `POST /api/auth/password-reset/request` and `POST /api/auth/password-reset/confirm`. Request responses do not reveal whether an account exists. The `/reset-password` page removes its one-time token from the address bar before submitting it.

Email verification uses the existing authenticated request and public confirmation endpoints. The `/verify-email` page submits the one-time token and removes it from the address bar. Email is displayed as read-only in the profile; users can request verification there.

The login Remember Me option stores the access token in local storage when selected and in session storage otherwise. Signing out removes it from both stores.

## Validation

- `npm run lint`
- `npm run build`
