# ProvisionIT admin portal

React + Vite frontend for the middleware API.

## Run it

```
cd portal
npm install
npm run dev
```

Opens on http://localhost:5173. In dev, `/api` is proxied to the middleware on
http://localhost:3000 (see `vite.config.js`), so start that first (`node src/app.js` in the repo root).

No backend handy? Run on sample data:

```
VITE_USE_MOCK=true npm run dev
```

## Other commands

- `npm test` runs the tests
- `npm run build` makes a production build in `dist/`

## What it expects from the API

All under `/api/v1` (set `VITE_API_URL` if the middleware mounts it somewhere else):

| Call | Used by | Notes |
|---|---|---|
| `GET /connections` | company picker, Connections page | `{ data: [...] }`, needs the small route in `api-connections-route.md` |
| `GET /accounts` | Accounts page | needs `?connectionId=`, takes `page` and `pageSize` |
| `GET /trial-balance` | Trial balance page | needs `?connectionId=` |
| `POST /sync` | Sync button on Accounts | `?connectionId=`, admin only on the server |

Invoices, Payments and Customers have no API route yet. Those three pages always run on sample data
and show a yellow "Sample data" banner, so nobody mistakes them for live numbers. When a route is
added, take its path out of `SAMPLE_ONLY` in `src/api/sample.js`.

Errors are read from `{ error: { code, message } }`.

Field names (`amount` or `total`, `name` or `displayName`, snake_case or camelCase) are mapped in
`src/api/normalize.js`. If the response shape changes, that is the only file to touch.

## Not built yet

- Login and roles. `setTokenProvider` in `src/api/http.js` is where the Supabase token plugs in,
  the portal then sends it as `Authorization: Bearer <token>`.
- Create / disconnect connection, needs write endpoints on the backend first.
- Dashboard and activity log, they need endpoints that return totals and log rows.
- Invoices, Payments and Customers on real data (see above).

## Deploying

The dev proxy only exists in dev. For a hosted build either serve the portal and the API from the
same domain, or set `VITE_API_URL` to the API address and turn on CORS in the middleware.
