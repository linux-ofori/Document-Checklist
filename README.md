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

### Authentication endpoints

- `POST /api/auth/register` with `{ "name": "A User", "email": "user@example.com", "password": "at-least-8-chars" }`
- `POST /api/auth/login` with `{ "email": "user@example.com", "password": "at-least-8-chars" }`
- `GET /api/auth/me` with `Authorization: Bearer <token>`
- `PUT /api/auth/me` with `Authorization: Bearer <token>` and one or both editable profile fields, such as `{ "name": "Updated Name", "email": "updated@example.com" }`
- `DELETE /api/auth/me` with `Authorization: Bearer <token>`

Registration and login return a JWT in `token` and the sanitized user in `user`. The document checklist functionality is not implemented yet.

The profile endpoint accepts `name` (2-100 characters) and `email` (a valid email address up to 254 characters). It rejects other fields and returns the updated sanitized user in `user`. Deleting the account returns `{ "message": "Account deleted successfully." }`. Both profile endpoints act only on the account associated with the Bearer token.
