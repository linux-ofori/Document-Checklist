# Document-Checklist
A web application that helps users organize and track required documents.

## Authentication backend

The backend is a Node.js and Express API. User records are stored in the local file-backed database at `data/users.db`; passwords are hashed with bcrypt and are never included in API responses.

### Run locally

1. Install Node.js 18 or newer.
2. Install dependencies:

	```bash
	npm install
	```

3. Copy `.env.example` to `.env` and replace `JWT_SECRET` with a random secret of at least 32 characters.
4. Start the API:

	```bash
	npm start
	```

The API listens on `http://localhost:3000` by default. Use `npm run dev` for Node's watch mode.

The Express app applies Helmet security headers before JSON parsing and API routes. Since this backend serves JSON rather than browser pages, Helmet's Content Security Policy header is disabled; a custom CSP is not needed for the API. If browser pages are added to this server later, define a CSP based on their actual scripts, styles, and resources.

### Run tests

Run the integration tests with Node's built-in test runner:

```bash
npm test
```

The tests use temporary user and document databases under `data/`, a test-only JWT secret, and an ephemeral local port. Test data is removed when the test run finishes; the development databases and `.env` are not used or modified.

### Authentication endpoints

- `POST /api/auth/register` with `{ "name": "A User", "email": "user@example.com", "password": "at-least-8-chars" }`
- `POST /api/auth/login` with `{ "email": "user@example.com", "password": "at-least-8-chars" }`
- `GET /api/auth/me` with `Authorization: Bearer <token>`
- `PUT /api/auth/me` with `Authorization: Bearer <token>` and one or both editable profile fields, such as `{ "name": "Updated Name", "email": "updated@example.com" }`
- `DELETE /api/auth/me` with `Authorization: Bearer <token>`

Registration and login return a JWT in `token` and the sanitized user in `user`.

Login and registration requests are each limited to 5 per client IP in a 15-minute window, with independent quotas. Configure `LOGIN_RATE_LIMIT_MAX` and `LOGIN_RATE_LIMIT_WINDOW_MS` to override the login limit, and `REGISTRATION_RATE_LIMIT_MAX` and `REGISTRATION_RATE_LIMIT_WINDOW_MS` to override the registration limit. Values must be positive integers. Exceeding either limit returns HTTP `429` with a JSON error.

The application does not enable Express `trust proxy` by default. If it runs behind a reverse proxy or load balancer, configure trust only for the known proxy addresses or a verified hop count that matches the deployment topology. Do not blindly trust forwarded headers: clients that can spoof `X-Forwarded-For` could evade IP-based limits. With proxy trust disabled, requests may all appear to come from the proxy IP. The default in-memory limiter is per process; deployments with multiple instances should configure a shared rate-limit store to enforce one quota across instances.

The profile endpoint accepts `name` (2-100 characters) and `email` (a valid email address up to 254 characters). It rejects other fields and returns the updated sanitized user in `user`. Deleting the account returns `{ "message": "Account deleted successfully." }`. Both profile endpoints act only on the account associated with the Bearer token.

### Document endpoints

All document endpoints require `Authorization: Bearer <token>`. In Postman, set **Authorization** to **Bearer Token** and use the token returned by registration or login. Documents are stored separately in `data/documents.db` and are always scoped to the authenticated user.

- `POST /api/documents` creates a document. The JSON body requires `name` (1-150 characters) and optionally accepts `completed` (boolean, defaults to `false`). Example body: `{ "name": "Passport", "completed": false }`.
- `GET /api/documents` lists only the authenticated user's documents.
- `GET /api/documents/:id` gets one document owned by the authenticated user.
- `PUT /api/documents/:id` updates `name`, `completed`, or both. Example body: `{ "completed": true }`.
- `DELETE /api/documents/:id` deletes a document owned by the authenticated user.

Create and update requests reject other fields, including document IDs and owner IDs. A successful create returns `201` with `{ "document": { "id": "...", "name": "Passport", "completed": false, "createdAt": "...", "updatedAt": "..." } }`. Listing returns `{ "documents": [...] }`; get and update return `{ "document": { ... } }`; delete returns `{ "message": "Document deleted successfully." }`. Invalid IDs return `400`; missing or non-owned documents return `404`.
