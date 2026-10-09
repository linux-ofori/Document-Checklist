# Document-Checklist
A web application that helps users organize and track required documents.

## Authentication backend

The backend is a Node.js and Express API. User, document, application, and notification records are stored in separate local file-backed databases at `data/users.db`, `data/documents.db`, `data/applications.db`, and `data/notifications.db`; passwords are hashed with bcrypt and are never included in API responses.

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

The frontend origin allowed by CORS is configured with `CORS_ALLOWED_ORIGINS`, a comma-separated list of exact origins (scheme, hostname, and optional port only; no path, credentials, wildcard, query, or fragment). Outside production, if unset, it defaults to `http://localhost:5173`. In production it is required, and every configured origin must use HTTPS. For local development, use `CORS_ALLOWED_ORIGINS=http://localhost:5173`. For production, configure the deployment environment with the real frontend origin, for example `CORS_ALLOWED_ORIGINS=https://frontend.example.com`; for multiple frontends, use `CORS_ALLOWED_ORIGINS=https://frontend.example.com,https://admin.example.com`. Set this in the hosting platform's environment configuration rather than committing deployment-specific origins. CORS credentials are not enabled.

The file-backed NeDB databases are intended for one Node.js process using a private persistent data directory; do not share the same database files between clustered processes or instances. On POSIX systems, newly created database files are restricted to the service owner. On Windows, protect the database directory using the service account's inherited filesystem ACLs.

Uploaded document files are stored privately under `data/uploads/` by default. `DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY` can select another private local directory; it is resolved once at startup and is never controlled by request data. Keep that directory persistent and access-restricted.

Email notifications are disabled by default. Phase 1 provides configuration and a provider-neutral service boundary only; it does not send real email. `EMAIL_ENABLED` accepts `true` or `false` and defaults to `false`. If enabled, `EMAIL_FROM` must be a valid email address; `EMAIL_REPLY_TO` is optional and, when set, must also be valid. A real provider, email verification, outbox, and worker are future phases. The `emailChecklistCompletion` notification preference is an explicit opt-in and defaults to `false`.

The Express app applies Helmet security headers before JSON parsing and API routes. Since this backend serves JSON rather than browser pages, Helmet's Content Security Policy header is disabled; a custom CSP is not needed for the API. If browser pages are added to this server later, define a CSP based on their actual scripts, styles, and resources.

### Run tests

Run the integration tests with Node's built-in test runner:

```bash
npm test
```

The tests use temporary user, document, application, and notification databases and upload storage under `data/`, a test-only JWT secret, and an ephemeral local port. Test data is removed when the test run finishes; the development databases, uploads, and `.env` are not used or modified.

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

The default JWT expiration is one day (`JWT_EXPIRES_IN` defaults to `1d`). There is currently no refresh-token endpoint. Logging out invalidates all currently issued access tokens for the account; deleting an account also makes its tokens unusable.

### Validation summary

| Field | Rules |
|---|---|
| `name` for accounts | Required on registration; 2–100 characters after trimming. Optional on profile updates. |
| `email` | Required on registration and login; valid email format, at most 254 characters. Trimmed and lowercased. Optional on profile updates. |
| `password` | Required on registration and login; 8–128 characters and at most 72 UTF-8 bytes. |
| Registration `phone` | Optional; trimmed and must match `^[+()-\s\d]{7,20}$` when non-empty. Omitted or blank values are stored as `null`. |
| Document `name` | Required on create; 1–150 characters after trimming. Optional on update. |
| Document `completed` | Optional on create and update; must be a boolean. Defaults to `false` on create. |
| Document `documentType` | Optional and nullable; otherwise one of `identity-card`, `photograph`, `birth-certificate`, `application-form`, `proof-of-address`, `supporting-document`, `fee-receipt`, `business-registration-certificate`, `company-constitution`, `tax-clearance`, `bank-statement`, `medical-report`, `drivers-licence`, `test-results`, `transcript`, `recommendation-letter`, `old-passport`, `police-clearance`, `marriage-certificate`, or `other`. |
| Document `status` | Optional on create and update; one of `draft`, `in-review`, `verified`, `expiring`, or `expired`. Defaults to `in-review`. |
| Document `applicationId` | Optional and nullable; otherwise a valid application ID owned by the authenticated user. |
| Document `expiresAt` | Optional and nullable; accepts an ISO calendar date or ISO date-time and is normalized to UTC ISO date-time. |
| Document `note` | Optional and nullable; plain text, at most 2,000 characters. |
| Document `id` | Exactly 16 alphanumeric characters. |
| Application `processId` | Required on create; must identify one of the supported static process templates. |
| Application `name` | Optional on create; 1–150 characters after trimming. Defaults to the process name. |
| Application `details` | Optional JSON object on create; defaults to `{}`. Protected identifier/owner keys are rejected. |
| Application `id` | Server-generated, `app-` prefixed identifier. |
| Requirement `status` | Required on update; one of `completed`, `in-progress`, or `missing`. |
| Requirement `documentId` | Optional on update; must identify a document owned by the caller and linked to that application; may be `null` to clear. |
| Document upload | Multipart upload accepts one PDF, JPG/JPEG, or PNG file, up to and including 5 MiB (5 × 1024 × 1024 bytes). |

Profile updates must include at least one of `name` or `email`. Document updates must include at least one editable document field. These update endpoints reject unknown fields. Document create/update also reject client-supplied IDs, owner fields, timestamps, upload metadata, and storage information. Registration and login validate their named fields but do not reject additional fields.

### Authentication endpoints

#### `POST /api/auth/register`

**Authentication:** Not required. Creates an account.

Required JSON fields: `name`, `email`, `password`. Optional field: `phone`, a trimmed phone number matching `^[+()-\s\d]{7,20}$`.

```json
{
	"name": "A User",
	"email": "user@example.com",
	"password": "CorrectHorse12!",
	"phone": "+233 24 000 0000"
}
```

**Success:** `201 Created`

```json
{
	"user": {
		"id": "generated-user-id",
		"name": "A User",
		"email": "user@example.com",
		"phone": "+233 24 000 0000",
		"createdAt": "2026-10-07T12:00:00.000Z",
		"updatedAt": "2026-10-07T12:00:00.000Z"
	},
	"token": "<jwt>"
}
```

Omitted or blank phone values are stored and returned as `null`. The sanitized user response may contain `phone`, but does not include the password or internal account fields. Possible errors: `400` validation error, `409` duplicate email, `429` registration rate limit, or a shared request/server error below.

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

#### `POST /api/auth/logout`

**Authentication:** Required. Invalidates all currently issued access tokens for the authenticated account. This is effectively “sign out everywhere” for the account. A subsequent login issues a new valid token. No request body.

**Success:** `200 OK`

```json
{ "message": "Logged out successfully." }
```

Possible errors: `401` authentication error, `404` authenticated user no longer exists, or a shared server error below.

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

**Authentication:** Required. Deletes the authenticated account and all documents and applications owned by that account. No request body.

**Success:** `200 OK`

```json
{ "message": "Account deleted successfully." }
```

Possible errors: `401` authentication error, `404` authenticated user no longer exists, or a shared server error below. The deleted account's token can no longer authenticate.

### Application endpoints

All application endpoints require authentication. Applications are stored separately in `data/applications.db` (configurable with `DOCUMENT_CHECKLIST_APPLICATIONS_DB_PATH`) and scoped to the authenticated user. Application IDs are generated by the server with an `app-` prefix. A missing application and an application owned by another user both return `404 Application not found.` Public application objects never include `ownerId`.

The supported static process IDs are `passport`, `business-registration`, `drivers-licence`, `university-application`, `national-id`, and `other-services`. Requirement definitions (`key`, `name`, `type`, `description`, `guidance`, and `isRequired`) are maintained by the backend and cannot be created by clients. Applications store per-application requirement state only.

#### `POST /api/applications`

**Authentication:** Required. Creates an application from a supported process template.

Required JSON field: `processId`. Optional fields: `name` (1–150 characters after trimming) and `details` (a JSON object). No other fields are accepted. `details` is process-specific opaque data; it is not interpreted by the API, and protected identifier/owner keys are rejected.

```json
{
	"processId": "passport",
	"name": "Passport Application",
	"details": {
		"fullName": "A User"
	}
}
```

**Success:** `201 Created`

Returns `{ "application": { ... } }` with a server-generated ID and reference, `status: "in-progress"`, timestamps, `dueDate: null`, the process authority, the initial next step, the supplied details, and all static requirements initialized with `status: "missing"`, `documentId: null`, and `completedAt: null`. Each requirement also includes its catalog `key`, `name`, `type`, `description`, `guidance`, and `isRequired`.

Possible errors: `400` validation error, `401` authentication error, or a shared server error below.

#### `GET /api/applications`

**Authentication:** Required. Lists only the caller's applications, ordered by most recently updated first. No request body.

**Success:** `200 OK`, `{ "applications": [ ... ] }`, with each entry using the public application shape described above.

#### `GET /api/applications/:id`

**Authentication:** Required. Returns one application owned by the caller. The ID must use the server's `app-`-prefixed identifier format.

**Success:** `200 OK`, `{ "application": { ... } }`. Possible errors: `400` invalid application ID, `401` authentication error, `404` missing or non-owned application, or a shared server error below.

#### `PATCH /api/applications/:id/requirements/:key`

**Authentication:** Required. Updates the application-specific state for a requirement key in that application's static process template. `status` is required and must be `completed`, `in-progress`, or `missing`. Optional `documentId` must refer to a document owned by the authenticated user, associated with this application, and with a `documentType` matching the selected requirement template's `type`; send `null` to clear it. Linking or relinking a requirement to a document pending deletion is rejected with `409`; explicitly unlinking it by sending `documentId: null` is allowed. Other invalid document relationships are rejected with a `400` validation error. A linked document's `documentType` or `applicationId` cannot be changed to a value that would invalidate any requirement link. `completedAt` is server-controlled and cannot be supplied by the client. Setting status to `completed` assigns a UTC timestamp if the requirement was not already completed; setting it to `missing` or `in-progress` clears that timestamp.

```json
{
	"status": "completed",
	"documentId": "a1b2c3d4e5f6g7h8"
}
```

**Success:** `200 OK`, `{ "application": { ... } }` with the updated application. When a completion notification is persisted for a transition to `completed`, the response also includes `"notification": { ... }`; otherwise that property is omitted. Possible errors: `400` validation error or a document linked to another application, `401` authentication error, `404` missing/non-owned application, unknown requirement key, or missing/non-owned document, or a shared server error below.

There is no application delete, general application update, submission, or reviewer workflow endpoint.

### Notification endpoints

All notification endpoints require authentication. Notifications are stored separately in `data/notifications.db`; configure another private database path with `DOCUMENT_CHECKLIST_NOTIFICATIONS_DB_PATH`. Each notification is scoped to its owner. Listing returns only the authenticated user's notifications, newest first. Public responses include an `id` but never expose the internal `_id` or `ownerId`.

#### `GET /api/notifications`

**Authentication:** Required. Lists the authenticated user's notifications. No request body.

**Success:** `200 OK`

```json
{
	"notifications": [
		{
			"id": "a1b2c3d4e5f6g7h8",
			"kind": "application",
			"title": "Checklist requirement completed",
			"body": "Ghana Card for Passport Application is complete.",
			"severity": "success",
			"isRead": false,
			"applicationId": "app-generated-application-id",
			"documentId": "a1b2c3d4e5f6g7h8",
			"dueDate": null,
			"createdAt": "2026-10-07T12:00:00.000Z"
		}
	]
}
```

#### `PATCH /api/notifications/:id/read`

**Authentication:** Required. Marks one notification owned by the caller as read. Repeating the operation succeeds with the same notification representation. The ID must be exactly 16 alphanumeric characters. No request body fields are accepted.

**Success:** `200 OK`, `{ "notification": { ... } }` using the public notification shape above. Possible errors: `400` malformed ID or unexpected body field, `401` authentication error, `404` missing or non-owned notification, or a shared server error below.

#### `POST /api/notifications/read-all`

**Authentication:** Required. Marks only the caller's unread notifications as read. No request body fields are accepted.

**Success:** `200 OK`, `{ "updatedCount": 2 }`; an account with no unread notifications receives `{ "updatedCount": 0 }`. Possible errors: `400` unexpected body field, `401` authentication error, or a shared server error below.

When an application requirement transitions from `missing` or `in-progress` to `completed`, the backend best-effort persists a new application notification. Repeated completion does not create another notification; reopening and completing the requirement later creates a new one. The notification content and application/document references are generated from server-side records. If notification persistence fails, the requirement update still succeeds and the failure is logged.

### Document endpoints

When document creation or a legacy `applicationId` update names an application, it must exist and belong to the authenticated user; missing and non-owned applications both return `404 Application not found.` `applicationId: null` remains allowed. Documents can be associated with multiple owned applications; `applicationIds` is canonical, while `applicationId` remains the legacy primary association. Document creation, updates, reads, and deletion remain owner-scoped. The `completed` and `status` fields remain independent; application requirement status does not change either document field.

All document endpoints require a Bearer token. Documents are stored separately in `data/documents.db` and are scoped to the authenticated user. A user cannot access another user's documents; attempts to get, update, or delete one return `404` with `Document not found.`

#### `POST /api/documents`

**Authentication:** Required. Creates a document owned by the authenticated user.

For JSON creation, required field: `name`. Optional fields: `completed` (defaults to `false`), `documentType`, `status` (defaults to `in-review`), `applicationId`, `expiresAt`, and `note`. The JSON request must contain an object and may contain only these fields. Optional nullable fields can be omitted or set to `null`. `completed` and `status` are independent: setting either one never changes the other. `status` accepts `draft`, `in-review`, `verified`, `expiring`, or `expired`; clients may set these values, but this API does not implement a reviewer/role system or a review workflow. A non-null `applicationId` must identify an application owned by the authenticated user; it is not validated against application requirements.

The same endpoint also accepts `multipart/form-data` with exactly one `file` part and optional document metadata fields: `name` (required), `completed`, `documentType`, `status`, `applicationId`, `expiresAt`, and `note`. The multipart request is authenticated like JSON requests; if `applicationId` is present, the application must belong to the caller. File size is limited to 5 MiB (5 × 1024 × 1024 bytes), including a file exactly at that limit. Supported formats are PDF (`.pdf`), JPEG (`.jpg`/`.jpeg`), and PNG (`.png`). The server checks extension, declared MIME type, and file signatures. Unsupported, mismatched, missing, multiple, malformed, or oversized file input is rejected; oversized uploads return `413`, and other upload validation errors return `400`.

File bytes are stored in private local storage under `data/uploads/` by default; the directory can be configured with `DOCUMENT_CHECKLIST_UPLOADS_DIRECTORY`. It is not exposed through static file serving. The original filename is sanitized for display only; the server generates the storage key and calculates `fileSizeKb` and `uploadedAt`. Clients cannot submit file metadata or storage keys, and the public document response does not expose storage keys or filesystem paths. JSON-only document creation remains supported without a file, in which case `fileName`, `fileSizeKb`, and `uploadedAt` are `null`.

```json
{
	"name": "Passport",
	"completed": false,
	"documentType": "identity-card",
	"status": "in-review",
	"applicationId": "app-passport-2026",
	"expiresAt": "2028-05-01",
	"note": "Renew before travel."
}
```

**Success:** `201 Created`

```json
{
	"document": {
		"id": "a1b2c3d4e5f6g7h8",
		"name": "Passport",
		"completed": false,
		"documentType": "identity-card",
		"status": "in-review",
		"applicationId": "app-passport-2026",
		"applicationIds": ["app-passport-2026"],
		"fileName": null,
		"fileSizeKb": null,
		"uploadedAt": null,
		"expiresAt": "2028-05-01T00:00:00.000Z",
		"note": "Renew before travel.",
		"createdAt": "2026-10-07T12:00:00.000Z",
		"updatedAt": "2026-10-07T12:00:00.000Z"
	}
}
```

Missing optional metadata is returned as `null`. `applicationIds` is the canonical list of associated applications; the legacy `applicationId` field remains the primary association for existing clients. Clients cannot set `applicationIds` directly; use the association endpoints below. For JSON-only documents, file metadata remains `null`; multipart uploads populate it from the validated file. File size in bytes, storage keys/paths, IDs, owner fields, and timestamps are rejected if supplied in request metadata.

`GET /api/documents` returns `{ "documents": [...] }` and `GET /api/documents/:id` returns `{ "document": { ... } }`, using this same complete public document representation. List results contain only the authenticated user's documents, omit documents with deletion pending, and are ordered newest first. `PUT /api/documents/:id` accepts partial updates to `name`, `completed`, `documentType`, `status`, `applicationId`, `expiresAt`, and `note`; at least one recognized field is required. A legacy `applicationId` update changes or clears only the current primary association and preserves other associations. It is rejected if the change would invalidate an existing checklist requirement link. Setting either `completed` or `status` does not alter the other. Nullable metadata can be cleared with `null`.

Possible errors: `400` validation error or invalid document ID, `401` authentication error, `404` missing or non-owned document, or a shared request/server error below. `DELETE /api/documents/:id` returns `200 { "message": "Document deleted successfully." }` when an owned document is deleted.

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
			"documentType": "identity-card",
			"status": "in-review",
			"applicationId": "app-passport-2026",
			"applicationIds": ["app-passport-2026"],
			"fileName": null,
			"fileSizeKb": null,
			"uploadedAt": null,
			"expiresAt": "2028-05-01T00:00:00.000Z",
			"note": "Renew before travel.",
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

#### `GET /api/documents/:id/file`

**Authentication:** Required. Retrieves the stored file for a document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters. No request body.

**Success:** `200 OK` with the file bytes, a PDF/JPEG/PNG `Content-Type`, and `Content-Disposition: inline` using the stored display filename. The internal storage key and filesystem path are not returned. Metadata-only documents and documents whose physical file is missing return `404 Document file not found.` A non-owned document is also reported as not found.

#### `POST /api/documents/:id/applications`

**Authentication:** Required. Associates an owned document with an application owned by the authenticated user. The document ID must be exactly 16 alphanumeric characters.

```json
{ "applicationId": "app-passport-2026" }
```

**Success:** `200 OK`, returning `{ "document": { ... } }` with the updated public document. Repeating an existing association is idempotent and does not create duplicate links. Invalid IDs return `400`; missing or non-owned documents/applications return `404`; a document with permanent deletion pending returns `409`.

#### `DELETE /api/documents/:id/applications/:applicationId`

**Authentication:** Required. Detaches an owned document from one application owned by the authenticated user. This does not delete the document record or stored file. If a checklist requirement in that application still references the document, the request returns `409` and leaves the association intact. Repeating a successful detach is idempotent.

**Success:** `200 OK`, returning `{ "document": { ... } }` with the updated public document. Invalid IDs return `400`; missing or non-owned documents/applications return `404`; a requirement-linked or deletion-pending document returns `409`.

#### `PUT /api/documents/:id`

**Authentication:** Required. Updates one document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters.

Provide at least one editable field: `name`, `completed`, `documentType`, `status`, `applicationId`, `expiresAt`, or `note`. Their validation rules are in the summary above; other fields are rejected. Nullable optional metadata can be cleared with `null`.

```json
{ "completed": true }
```

**Success:** `200 OK`, returning `{ "document": { ... } }` with the updated document. Possible errors: `400` invalid ID or validation error, `401` authentication error, `404` document not found, or a shared request/server error below.

#### `PUT /api/documents/:id/file`

**Authentication:** Required. Replaces the stored file for a document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters. Send `multipart/form-data` containing exactly one `file` part and no document metadata fields. The upload uses the same supported formats, signature checks, and 5 MiB maximum as document creation.

**Success:** `200 OK`, returning `{ "document": { ... } }`. The document ID and all non-file metadata remain unchanged; `fileName`, `fileSizeKb`, and `uploadedAt` are generated from the replacement file. The old file is removed after the database record points to the new file. If database updating fails, the previous file remains authoritative and the staged file is cleaned up where possible. If removing the old file fails after a successful update, the replacement still succeeds and the document remains pointed at the new file; the cleanup failure is logged.

#### `DELETE /api/documents/:id`

**Authentication:** Required. Deletes one document owned by the authenticated user. The `id` path parameter must be exactly 16 alphanumeric characters. No request body.

**Success:** `200 OK`

```json
{ "message": "Document deleted successfully." }
```

Permanent deletion marks the document as pending, clears matching application requirement references, removes the stored file, then removes the document record. If the pending marker is persisted but a later cleanup step fails, the endpoint returns the shared `500` response and startup recovery retries the pending cleanup; retrying this `DELETE` endpoint also attempts to resume it. Pending documents are hidden from normal document reads. Association changes, metadata updates, and file replacement are rejected with `409` while deletion is pending; linking or relinking a requirement to the pending document is also rejected, but explicitly unlinking a requirement remains allowed. This endpoint permanently deletes the document and its file; use the association `DELETE` endpoint to detach it from only one application.

Possible errors: `400` invalid document ID, `401` authentication error, `404` document not found, or a shared server error below. `409` applies to operations blocked because deletion is pending, not necessarily to a repeated permanent-deletion request.

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
| `404` | Unknown API route or unsupported method: `{ "error": "Route not found." }`. Missing or non-owned document: `{ "error": "Document not found." }`. Missing file content: `{ "error": "Document file not found." }`. |
| `409` | Duplicate account email, an operation blocked because document deletion is pending, or an attempt to detach a document still linked to a requirement. |
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
