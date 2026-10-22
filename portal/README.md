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
| `GET /auth/<provider>/connect` | Connect buttons on Connections | admin only, sent with `Accept: application/json` it returns `{ data: { authorizationUrl } }` and the browser goes there |
| `DELETE /auth/<provider>/connections/<id>` | Disconnect button on Connections | admin only, removes the company and its saved accounts |

Invoices, Payments and Customers are not in the portal because the API has no routes for them yet.
Their page code was removed. The helpers for them are still in `src/api` (`listInvoices`, `listPayments`,
`listCustomers` and the sample data), ready for when the routes exist.

Errors are read from `{ error: { code, message } }`.

Field names (`amount` or `total`, `name` or `displayName`, snake_case or camelCase) are mapped in
`src/api/normalize.js`. If the response shape changes, that is the only file to touch.

## Not built yet

- Activity log. The API writes an audit log but has no route to read it yet.
- After an admin approves a company on Xero or QuickBooks the API callback answers with JSON,
  so you come back to the Connections page by hand and press Refresh.
- Invoices, Payments and Customers on real data (see above).

## Deploying

The dev proxy only exists in dev. For a hosted build either serve the portal and the API from the
same domain, or set `VITE_API_URL` to the API address and turn on CORS in the middleware.
