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

Registration and login return a JWT in `token` and the sanitized user in `user`. The document checklist functionality is not implemented yet.
