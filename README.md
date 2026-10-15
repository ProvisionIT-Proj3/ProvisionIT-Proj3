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

Apply the SQL files in `db/migrations/` to your database in filename order
(001 accounts, 002 OAuth persistence, 004 user profiles, 005 user connection access).

`npm test` runs the backend tests. Three of them (`persistenceDates`,
`persistenceTransaction`, `userConnectionAccess`) use the real `DATABASE_URL`
and write temporary rows, so point it at a development database.

## Project layout

```
src/routes/          the HTTP routes under /api/v1
src/services/        dataService (sync and read), canonicalMapper, validation
src/connector/       one connector per platform (xero, quickbooks) behind connectorFactory
src/mappers/         turn each platform's raw data into the canonical account shape
src/auth/            OAuth for Xero and QuickBooks, encrypted token storage
src/middleware/      login and role checks (auth.js)
src/persistence.js   all database access
portal/              the admin portal (see portal/README.md)
db/migrations/       SQL for the database, applied in order
test/                backend tests
```

## Endpoints (`/api/v1`)

| Method | Path | What it does |
|---|---|---|
| GET | `/accounts?connectionId=<uuid>&page=1&pageSize=100` | Stored accounts in report order |
| POST | `/sync?connectionId=<uuid>` | Fetch from the accounting system and replace the stored snapshot |
| GET | `/trial-balance?connectionId=<uuid>` | Live trial balance, same canonical list as `/accounts` (fetched from the accounting system, not stored) |
| GET | `/connections` | Connected companies for the portal (display fields only, no tokens). A `user` sees only their assigned connections |

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

Off by default. Set `AUTH_REQUIRED=true` (plus `SUPABASE_URL` and either
`SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`) and protected calls must send
`Authorization: Bearer <Supabase access token>`. The user's role is read from
`user_profiles`; create that table with
`db/migrations/004_create_user_profiles.sql`.

| Who | Can do |
|---|---|
| `user` | Read accounts and trial balance only for assigned connections; list assigned connections |
| `admin` | the above, plus sync and all connection-management routes |
| OAuth callback | Open to the provider redirect, but protected by single-use OAuth state |

An authenticated admin starts OAuth with `GET /auth/<provider>/connect`. A
normal browser request receives a redirect. A portal request with
`Accept: application/json` receives `{ "data": { "authorizationUrl": "..." } }`
so the portal can attach its Bearer token and then navigate to the returned URL.

User-to-company access is resolved through `persistence.hasUserConnectionAccess`
and `persistence.listConnectionsForUser`. A denied connection lookup returns 404
so users cannot discover another company's connection ID.

| Status | Code | When |
|---|---|---|
| 401 | `AUTHENTICATION_REQUIRED` / `INVALID_ACCESS_TOKEN` | no token, or a bad / expired one |
| 403 | `USER_PROFILE_REQUIRED` / `INSUFFICIENT_PERMISSION` | user has no role, or lacks the required permission |
| 503 | `AUTHENTICATION_SERVICE_UNAVAILABLE` | the login service could not be reached |
| 503 | `AUTHORIZATION_SERVICE_UNAVAILABLE` | the role database could not be reached |
| 500 | `AUTH_CONFIGURATION_ERROR` | auth is on but the Supabase settings are missing |

All of the token checking is in `src/middleware/auth.js`. If the login system
changes, only `verifyToken()` there needs replacing.
