# Deploying ProvisionIT

```
Browser -> Portal (Vercel, static React app)
              |  Authorization: Bearer <Supabase token>
              v
           API (Railway, Node/Express)  ->  Supabase Postgres (DATABASE_URL)
              |                          ->  Supabase Auth (checks tokens)
              +-> Xero / QuickBooks (OAuth, live fetch on sync)
```

The API and the portal live in one repo. The API is the repo root (`npm start`), the portal is the
`portal/` folder.

## 1. Before you start (do not skip)

- [ ] Staging first: a separate Supabase project, Railway service and Vercel project from production.
      Production uses its own OAuth apps and its own `TOKEN_ENCRYPTION_KEY`. Never copy secrets from staging.
- [ ] Tests pass: `npm test` in the repo root and `npm test` in `portal/`. Three backend tests write
      temporary rows to the `DATABASE_URL` database, so run them against a dev or staging database.
- [ ] Production OAuth apps approved for each platform going live (Xero Demo Company and the QuickBooks
      Intuit sandbox have been run end to end; production apps are untested; there is no MYOB connector).
- [ ] The portal login page (Giorgio's `gio/admin-portal` branch) is merged. It is needed before
      `AUTH_REQUIRED=true` (section 4, step 8).
- [ ] Client sign-off on the demo.
- [ ] Everyone knows who may call a rollback (section 7).

## 2. Environment variables

**Railway (the API).** The API connects to Postgres directly with `DATABASE_URL`. It does not use
`SUPABASE_SERVICE_ROLE_KEY`, so do not set it.

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (the API refuses to start without `DATABASE_URL` and `TOKEN_ENCRYPTION_KEY`) |
| `DATABASE_URL` | Supabase > Project Settings > Database > connection string (see "Connection string" below) |
| `TOKEN_ENCRYPTION_KEY` | base64 32 byte key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Losing it makes stored tokens unreadable, keep a copy somewhere safe. |
| `TOKEN_ENCRYPTION_KEY_VERSION` | `1` |
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` | production Xero app |
| `XERO_REDIRECT_URI` | `https://<api-domain>/auth/xero/callback` (must match Xero exactly) |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET`, `QUICKBOOKS_REDIRECT_URI` | only if QuickBooks goes live; `QUICKBOOKS_ENVIRONMENT=production` |
| `AUTH_REQUIRED` | `false` for the first deploy, `true` once the portal login is merged (section 4, step 8) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase > Project Settings > API (used to check login tokens) |
| `CORS_ORIGINS` | the portal's address, e.g. `https://your-portal.vercel.app` (no trailing slash, no path) |
| `PORT` | set by Railway, leave it |

**Vercel (the portal).** These are public, they end up inside the JavaScript. Anon key only.

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://<api-domain>/api/v1` |
| `VITE_SUPABASE_URL` | the Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | the anon (public) key, never the service role key |

Vite reads these at build time, so changing one means a new deployment.

**Connection string.** Railway needs a reachable Postgres address. Use the Supabase pooler or the
direct string depending on what Railway can reach (the direct host may be IPv6 only). Whichever you
use, it must log in as the `postgres` role. Put the Supabase project in the region closest to Railway.

## 3. Platform settings

**Railway** (settings in the dashboard, Railway's config-as-code files are deprecated)
- Source: this repo. Leave Root Directory empty (the API is at the repo root).
- Start command: `npm start`
- Healthcheck path: `/health` (returns `{"status":"ok"}`, needs no login and no database)
- Watch paths: `/src/**`, `/db/**`, `/package.json`, `/package-lock.json`, so portal-only changes do not redeploy the API.
- Run a single instance. The OAuth `state` values are kept in memory, so with two instances the Xero
  callback can land on the one that did not start the login.

**Vercel**
- Root Directory: `portal`
- Framework preset: Vite, build `npm run build`, output `dist` (the defaults)
- `portal/vercel.json` rewrites every path to `index.html` so refreshing `/accounts` works.
- Check the project's Git settings so API-only commits do not trigger a portal build, or accept the extra builds.

## 4. Deployment sequence

The API and the portal need each other's address, so the order matters.

1. **Database.** Back up first. Apply the migrations in `db/migrations/` in order (`001`, `002`,
   `003_enable_rls.sql`, `004`, `005`, `006_create_security_audit_log.sql`,
   `007_protect_security_audit_log.sql`; read the comment at the top of 003 before running it) to the target
   Supabase project. Compare the migration history with staging, do not eyeball it.
   Migration 006 creates the audit table and enables RLS in the same transaction.
   Keep 007 for older review environments that created the table without RLS.
   If a review build already applied `003_create_security_audit_log.sql` or
   `006_protect_security_audit_log.sql`, record their new names in your migration history.
   The renamed SQL is safe to run again; do not drop the existing audit table or its records.
2. **Deploy the API on Railway** with all variables except `CORS_ORIGINS`. Wait for the healthcheck.
   Open `https://<api-domain>/health`. Note the API address.
3. **Deploy the portal on Vercel** with `VITE_API_URL` pointing at the API. Note the portal address.
4. **Set `CORS_ORIGINS`** on Railway to the portal address and let it redeploy.
5. **Redirect URIs.** In each platform's developer portal, add the production callback
   (`https://<api-domain>/auth/xero/callback`). A mismatch fails as an OAuth error, check it by hand.
6. **Connect the companies.** With `AUTH_REQUIRED=true` the connect link needs an admin Bearer token,
   which a browser address bar cannot send. So connect while `AUTH_REQUIRED=false`: open
   `https://<api-domain>/auth/<provider>/connect` for each platform, approve, then call Sync.
   Use sandbox or demo companies only while the API is open to anyone.
7. **Create the first admin** (section 5).
8. **Turn on login.** Once the portal login is merged and the admin exists, set `AUTH_REQUIRED=true` on
   Railway and let it redeploy.
9. **Domain.** No custom domain has been chosen. Use the `*.vercel.app` and `*.up.railway.app`
   addresses for now. When a domain is chosen, update DNS, then update `CORS_ORIGINS`,
   `VITE_API_URL`, the redirect URIs and `XERO_REDIRECT_URI` together.

## 5. Create the first admin user

1. Supabase > Authentication > Users > Add user (email and password).
2. In the Supabase SQL editor give that user a role in `user_profiles` (roles: `admin` or `user`):

```sql
insert into user_profiles (user_id, role)
select id, 'admin' from auth.users where email = 'admin@example.com'
on conflict (user_id) do update set role = excluded.role, updated_at = now();
```

An `admin` can read everything, sync and manage connections. A `user` can only read the companies
they are granted, one row per company in `user_connection_access`:

```sql
insert into user_connection_access (user_id, connection_id)
select id, '<connection-id>' from auth.users where email = 'person@example.com'
on conflict do nothing;
```

A user with no `user_profiles` row gets 403 `USER_PROFILE_REQUIRED`.

## 6. Post-deployment checks

Check the real workflow, not just that the build went green.

- [ ] `curl https://<api-domain>/health` returns `{"status":"ok"}`
- [ ] After step 8: `curl https://<api-domain>/api/v1/accounts?connectionId=x` returns 401 (the API is locked)
- [ ] The portal asks for a login, the admin can sign in, a wrong password is refused
- [ ] A company is connected and synced (section 4, step 6). The callback currently answers with raw
      JSON, that is expected.
- [ ] In the portal: the company appears, Sync works, Accounts and Trial balance show data
- [ ] Railway logs contain no tokens, secrets or full connection strings (NFR-02 spot check on real logs)
- [ ] After an authenticated request, check `security_audit_log` for its authentication and
      authorization events. They are written together after the response finishes.
- [ ] Monitor Railway logs for `AUDIT_WRITE_FAILED`. A write gets one retry with the same
      event IDs, so a lost database reply cannot create duplicates. Persistent failure logs
      a safe warning and does not change the API response. Investigate warnings immediately.
- [ ] Anon key cannot read tables directly:
      `curl "$SUPABASE_URL/rest/v1/connections?select=*" -H "apikey: $SUPABASE_ANON_KEY"` returns `[]` or an error, never rows

## 7. Rollback

- **Decide in advance who can call it.** Any NFR-01 or NFR-02 problem found live (a token or secret
  visible in a log, the API or the UI) means an immediate rollback, no debate.
- **API:** Railway > Deployments > redeploy a previous build. History is kept.
- **Portal:** Vercel > Deployments > promote a previous deployment to production. Near instant.
- **Database:** take a backup right before step 1. The migrations are safe to re-run, but they are
  not automatically reversible. Restore from the backup if a migration goes wrong.
- Because the repo holds both, roll the API and portal back together if the API response shape changed.

## 8. Known limits

- Xero (Demo Company) and QuickBooks (Intuit sandbox) have been run end to end. Production OAuth apps are untested, and MYOB has no connector.
- Connecting a company needs `AUTH_REQUIRED=false`, unless the portal calls the connect route with `Accept: application/json` and attaches its token (see the Access control section of the README). The portal's Connect button does this.
- Invoices, Payments and Customers pages show sample data (the client dropped them from scope).
- Login is email and password only. There is no sign-up page, users are created in Supabase.
- The Xero callback returns JSON instead of sending the admin back to the portal.
- OAuth `state` is in memory, so one API instance only.
- Audit logging is best-effort, not a durable queue. API request events are batched into one
  background INSERT after the response (or connection close), using a separate pool of at most
  two connections with two-second connection/query timeouts. One retry is attempted.
  OAuth lifecycle events still await their writes. Normal SIGTERM/SIGINT shutdown waits for
  pending audit writes, with a ten-second overall shutdown limit. A hard crash or prolonged
  database outage can still lose events; do not treat this as guaranteed compliance logging.
- "Last synced" times can show the wrong hour on a laptop that is not on UTC (a separate small fix).
