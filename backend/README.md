# pgweb2 backend

FastAPI + asyncpg. Saved connections and users live in SQLite (`PGWEB_DATA_DIR`); target databases are reached with encrypted stored credentials.

## Run

```bash
uv sync
alembic upgrade head                         # always, after pulling: schema changes ship as migrations
python -m app.cli create-user you@example.com   # first user becomes admin and adopts any pre-existing connections
PGWEB_COOKIE_SECURE=false uvicorn app.main:app --port 8000   # false only for plain-http local dev
```

Or set `PGWEB_BOOTSTRAP_ADMIN_EMAIL` / `PGWEB_BOOTSTRAP_ADMIN_PASSWORD` to create the first admin on startup (Docker), then remove the password. See `.env.example` for every setting.

**Run a single worker.** Manual transactions pin a database connection in this process's memory, so
`uvicorn --workers N` (or multiple replicas without sticky routing) would lose track of them.

## Security model

- **Accounts:** email + Argon2 password. No public signup; admins create users. Lockout after repeated failures; a deactivation or password reset ends that user's sessions immediately.
- **Sessions:** opaque random token in an HttpOnly, `SameSite=strict`, Secure cookie. Only its SHA-256 is stored. Absolute and idle expiry (`PGWEB_SESSION_TTL_DAYS`, `PGWEB_SESSION_IDLE_MINUTES`).
- **CSRF:** `SameSite=strict` plus a required `X-Requested-With: pgweb2` header on every state-changing request.
- **Connections:** private to their owner unless an admin marks them *shared* (members can use a shared connection but never see its password). Unauthorised ids return 404, not 403. Passwords are Fernet-encrypted at rest; set `PGWEB_SECRET_KEY` from a secret store so the key doesn't sit beside the database, and never lose it.
- **Read-only by default:** read-only connections run `default_transaction_read_only`, and table browsing is always read-only.
- **Audit log:** every query, table browse, transaction event, login and admin change, with the SQL text as typed (so it may contain sensitive values). Admins read it at `GET /api/audit`; entries are pruned after `PGWEB_AUDIT_RETENTION_DAYS`.
- **Network:** put the API behind HTTPS on the same origin as the UI (the cookie is `SameSite=strict`), set `PGWEB_ALLOWED_HOSTS` to the database hosts users may register, and run uvicorn with `--proxy-headers` behind a reverse proxy so audit entries record real client IPs.

## Manual transactions

`POST /api/connections/{id}/transactions` pins a connection and opens a transaction; run statements with `POST /api/transactions/{tx}/query`, then `/commit` or `/rollback`.

- Each statement runs in a savepoint, so a failed statement is undone but the transaction stays usable.
- `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT` statements are rejected; use the endpoints.
- Idle transactions roll back after `PGWEB_TX_IDLE_TIMEOUT_SECONDS` (default 10 min), and none lives past `PGWEB_TX_MAX_AGE_SECONDS`. Postgres' own `idle_in_transaction_session_timeout` backs this up if the API process dies.
- At most `PGWEB_MAX_OPEN_TX_PER_USER` per user. Not available on read-only connections.
- Deleting a connection, deactivating a user, or shutting down rolls back open transactions first.

## Tests

```bash
uv run pytest
```

Integration tests run against a real throwaway Postgres (pip-packaged, no Docker needed) and a fresh SQLite database migrated with Alembic.
