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

In production, expose the API only through an HTTPS-terminating reverse proxy and set `NODE_ENV=production` and `TRUSTED_PROXY_IPS` to the proxy's exact IP addresses or narrow CIDRs. The application trusts forwarded protocol information only from those configured addresses and rejects requests that do not arrive as HTTPS through a trusted proxy. Do not use broad proxy ranges or trust arbitrary forwarded headers. Local development does not require HTTPS.

The file-backed NeDB databases are intended for one Node.js process using a private persistent data directory; do not share the same database files between clustered processes or instances. On POSIX systems, newly created database files are restricted to the service owner. On Windows, protect the database directory using the service account's inherited filesystem ACLs.

The Express app applies Helmet security headers before JSON parsing and API routes. Since this backend serves JSON rather than browser pages, Helmet's Content Security Policy header is disabled; a custom CSP is not needed for the API. If browser pages are added to this server later, define a CSP based on their actual scripts, styles, and resources.

### Run tests

Run the integration tests with Node's built-in test runner:

```bash
npm test
```

The tests use temporary user and document databases under `data/`, a test-only JWT secret, and an ephemeral local port. Test data is removed when the test run finishes; the development databases and `.env` are not used or modified.

## API reference

### Base URL and requests

The default base URL is [http://localhost:3000](http://localhost:3000/). Append the routes below to this URL. Send JSON request bodies with:

```http
Content-Type: application/json
```

### Authentication

Registration and login return a JWT in the `token` response field. Include it on every protected request using this header:

```http
Authorization: Bearer <token>
```

The default JWT expiration is one day (`JWT_EXPIRES_IN` defaults to `1d`). There is currently no refresh-token endpoint or logout endpoint. Deleting an account also makes its token unusable.

### Validation summary

| Field | Rules |
|---|---|
| `name` for accounts | Required on registration; 2–100 characters after trimming. Optional on profile updates. |
| `email` | Required on registration and login; valid email format, at most 254 characters. Trimmed and lowercased. Optional on profile updates. |
| `password` | Required on registration and login; 8–128 characters and at most 72 UTF-8 bytes. |
| Document `name` | Required on create; 1–150 characters after trimming. Optional on update. |
| Document `completed` | Optional on create and update; must be a boolean. Defaults to `false` on create. |
| Document `id` | Exactly 16 alphanumeric characters. |

Profile updates must include at least one of `name` or `email`. Document updates must include at least one of `name` or `completed`. These update endpoints reject unknown fields. Document create/update also reject client-supplied IDs and owner fields. Registration and login validate their named fields but do not reject additional fields.

### Authentication endpoints

#### `POST /api/auth/register`

**Authentication:** Not required. Creates an account.

Required JSON fields: `name`, `email`, `password`.

```json
{
	"name": "A User",
	"email": "user@example.com",
	"password": "CorrectHorse12!"
}
```

**Success:** `201 Created`

```json
{
	"user": {
		"id": "generated-user-id",
		"name": "A User",
		"email": "user@example.com",
		"createdAt": "2026-10-07T12:00:00.000Z",
		"updatedAt": "2026-10-07T12:00:00.000Z"
	},
	"token": "<jwt>"
}
```

The user object is sanitized and does not include the password. Possible errors: `400` validation error, `409` duplicate email, `429` registration rate limit, or a shared request/server error below.

#### `POST /api/auth/login`

**Authentication:** Not required. Verifies credentials and returns a JWT.

Required JSON fields: `email`, `password`.

```json
{
	"email": "user@example.com",
	"password": "CorrectHorse12!"
}
```

**Success:** `200 OK`; response has the same `user` and `token` shape as registration. Possible errors: `400` validation error, `401` invalid email or password, `429` login rate limit, or a shared request/server error below.

#### `GET /api/auth/me`

**Authentication:** Required. Returns the account associated with the Bearer token. No request body.

**Success:** `200 OK`

```json
{
	"user": {
		"id": "generated-user-id",
		"name": "A User",
		"email": "user@example.com",
		"createdAt": "2026-10-07T12:00:00.000Z",
		"updatedAt": "2026-10-07T12:00:00.000Z"
	}
}
```

Possible errors: `401` authentication error or a shared server error below.

#### `PUT /api/auth/me`

**Authentication:** Required. Updates the account associated with the Bearer token.

Provide one or both optional fields, `name` and `email`; at least one must be present. Their validation rules are in the summary above. Other fields are rejected.

```json
{
	"name": "Updated Name",
	"email": "updated@example.com"
}
```

**Success:** `200 OK`, returning `{ "user": { ... } }` with the updated sanitized user. Possible errors: `400` validation error, `401` authentication error, `404` authenticated user no longer exists, `409` duplicate email, or a shared server error below.

#### `DELETE /api/auth/me`

**Authentication:** Required. Deletes the authenticated account and all documents owned by that account. No request body.

**Success:** `200 OK`

```json
{ "message": "Account deleted successfully." }
```

Possible errors: `401` authentication error, `404` authenticated user no longer exists, or a shared server error below. The deleted account's token can no longer authenticate.

### Document endpoints

All document endpoints require a Bearer token. Documents are stored separately in `data/documents.db` and are scoped to the authenticated user. A user cannot access another user's documents; attempts to get, update, or delete one return `404` with `Document not found.`

#### `POST /api/documents`

**Authentication:** Required. Creates a document owned by the authenticated user.

Required JSON field: `name`. Optional field: `completed` (defaults to `false`).

```json
{
	"name": "Passport",
	"completed": false
}
```

**Success:** `201 Created`

```json
{
	"document": {
		"id": "a1b2c3d4e5f6g7h8",
		"name": "Passport",
		"completed": false,
		"createdAt": "2026-10-07T12:00:00.000Z",
		"updatedAt": "2026-10-07T12:00:00.000Z"
	}
}
```

Possible errors: `400` validation error, `401` authentication error, or a shared request/server error below.

#### `GET /api/documents`

**Authentication:** Required. Lists documents owned by the authenticated user, newest first. No request body.

**Success:** `200 OK`

```json
{
	"documents": [
		{
			"id": "a1b2c3d4e5f6g7h8",
			"name": "Passport",
			"completed": false,
			"createdAt": "2026-10-07T12:00:00.000Z",
			"updatedAt": "2026-10-07T12:00:00.000Z"
		}
	]
}
```

Possible errors: `401` authentication error or a shared server error below.

#### `GET /api/documents/:id`

**Authentication:** Required. Gets one document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters. No request body.

**Success:** `200 OK`, returning `{ "document": { ... } }` with the document shape shown above. Possible errors: `400` invalid document ID, `401` authentication error, `404` document not found, or a shared server error below.

#### `PUT /api/documents/:id`

**Authentication:** Required. Updates one document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters.

Provide at least one of the optional JSON fields `name` or `completed`. Their validation rules are in the summary above; other fields are rejected.

```json
{ "completed": true }
```

**Success:** `200 OK`, returning `{ "document": { ... } }` with the updated document. Possible errors: `400` invalid ID or validation error, `401` authentication error, `404` document not found, or a shared request/server error below.

#### `DELETE /api/documents/:id`

**Authentication:** Required. Deletes one document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters. No request body.

**Success:** `200 OK`

```json
{ "message": "Document deleted successfully." }
```

Possible errors: `400` invalid document ID, `401` authentication error, `404` document not found, or a shared server error below.

### Error responses

Errors are JSON. Most use `{ "error": "message" }`; validation errors also include a `details` array:

```json
{
	"error": "Validation failed.",
	"details": ["Document name must be between 1 and 150 characters."]
}
```

| Status | Meaning and representative response |
|---|---|
| `400` | Invalid fields: `{ "error": "Validation failed.", "details": ["..."] }`. Malformed JSON: `{ "error": "Request body must contain valid JSON." }`. Invalid document ID: `{ "error": "Invalid document ID." }`. |
| `401` | Missing token: `{ "error": "A Bearer token is required." }`. Invalid or expired token: `{ "error": "The token is invalid or expired." }`. |
| `404` | Unknown API route or unsupported method: `{ "error": "Route not found." }`. Missing or non-owned document: `{ "error": "Document not found." }`. |
| `409` | Duplicate account email: `{ "error": "An account with that email already exists." }`. |
| `413` | Request body exceeds the 10 KB JSON limit: `{ "error": "Request body is too large." }`. |
| `429` | Rate limit exceeded; see rate limiting below. |
| `500` | Unexpected server error: `{ "error": "An unexpected server error occurred." }`. |

An authenticated account that no longer exists also receives `401` when the token is checked; profile update or deletion can return `404` if the account disappears after that check.

### Rate limiting

Login and registration have independent per-client-IP limits. Each defaults to 5 requests per 15-minute window. Configure each limit with positive integer values using these environment variables:

| Endpoint | Maximum requests | Window in milliseconds |
|---|---|---|
| `POST /api/auth/login` | `LOGIN_RATE_LIMIT_MAX` | `LOGIN_RATE_LIMIT_WINDOW_MS` |
| `POST /api/auth/register` | `REGISTRATION_RATE_LIMIT_MAX` | `REGISTRATION_RATE_LIMIT_WINDOW_MS` |

Exceeding a limit returns `429` with the corresponding JSON error:

```json
{ "error": "Too many login attempts. Please try again later." }
```

For registration, the message is `Too many registration attempts. Please try again later.` Standard rate-limit headers are enabled; legacy headers are disabled.

Express `trust proxy` is not enabled by default. Behind a reverse proxy or load balancer, configure trust only for known proxy addresses or a verified hop count that matches the deployment topology. Do not blindly trust forwarded headers: clients able to spoof `X-Forwarded-For` could evade IP-based limits. With proxy trust disabled, requests may all appear to come from the proxy IP. The default in-memory limiter is per process; deployments with multiple instances should configure a shared rate-limit store to enforce one quota across instances.

### Current API limitations

- There is no health-check endpoint.
- Document listing has no pagination.
- There is no refresh-token endpoint.
- There is no logout endpoint.
