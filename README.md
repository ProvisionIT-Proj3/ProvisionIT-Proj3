# ProvisionIT-Proj3

Read-only middleware and REST API over Xero, MYOB and QuickBooks. It turns each
platform's data into one canonical format for the admin portal.

## How accounts flow

Accounts are stored in our database, not fetched on every request.

```
POST /api/v1/sync      accounting system -> connector + mapper -> saveAccounts -> DB
GET  /api/v1/accounts  DB -> canonical mapper -> portal
```

The trial balance is still fetched live (`GET /api/v1/trial-balance`).

## Run it

```
npm install
cp .env.example .env     # then fill it in
npm start                # http://localhost:3000
npm test
```

Create the accounts table once (see `db/migrations/001_create_accounts.sql`).

## Endpoints (`/api/v1`)

| Method | Path | What it does |
|---|---|---|
| GET | `/accounts?connectionId=<uuid>&page=1&pageSize=100` | Stored accounts in report order |
| POST | `/sync?connectionId=<uuid>` | Fetch from the accounting system and replace the stored snapshot |
| GET | `/trial-balance?connectionId=<uuid>` | Live trial balance |

`GET /accounts` returns:

```json
{
  "data": [{ "id": "acc_200", "sourceSystem": "xero", "code": "200", "name": "Sales",
             "type": "REVENUE", "drCr": "Cr", "isHeader": false, "level": 2,
             "value": 40000, "taxCode": "GST" }],
  "pagination": { "page": 1, "pageSize": 100, "totalItems": 4, "totalPages": 1 },
  "meta": { "lastSyncedAt": "2026-09-01T00:00:00.000Z", "reportDate": "2026-08-31" }
}
```

`pageSize` defaults to 100 and is capped at 500. Before the first sync, `data` is empty.

## Errors

Every failure uses the same shape:

```json
{ "error": { "code": "INVALID_PARAMETER", "message": "connectionId must be a valid UUID." } }
```

| Status | Code | When |
|---|---|---|
| 400 | `MISSING_CONNECTION_ID` | no `connectionId` |
| 400 | `INVALID_PARAMETER` | bad UUID, or `page` / `pageSize` not a positive whole number |
| 404 | `CONNECTION_NOT_FOUND` | unknown `connectionId` |

## Access control

Off by default. Set `AUTH_REQUIRED=true` (plus `SUPABASE_URL` and `SUPABASE_ANON_KEY`)
and every call must send `Authorization: Bearer <Supabase access token>`.
The user's role is read from `user_profiles`.

| Who | Can do |
|---|---|
| any role | `GET /accounts`, `GET /trial-balance`, `GET /auth/<provider>/connections` |
| `ADMIN_ROLE` (default `admin`) | the above, plus `POST /sync` and `DELETE /auth/<provider>/connections/:id` |
| nobody (open on purpose) | `/auth/<provider>/connect` and `/callback`, because the browser is redirected through them |

| Status | Code | When |
|---|---|---|
| 401 | `UNAUTHENTICATED` / `INVALID_TOKEN` | no token, or a bad / expired one |
| 403 | `NO_ROLE` / `FORBIDDEN` | user has no role, or is not an admin |
| 503 | `AUTH_UNAVAILABLE` | the login service could not be reached |
| 500 | `AUTH_NOT_CONFIGURED` | auth is on but the Supabase settings are missing |

All of the token checking is in `src/middleware/auth.js`. If the login system
changes, only `verifyToken()` there needs replacing.
