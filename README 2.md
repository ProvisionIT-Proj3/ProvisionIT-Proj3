# ProvisionIT Middleware API

Read-only Node.js/Express API serving accounting data (customers, invoices, payments) to the admin portal.

## Structure
- `src/app.js` — entry point, error handling
- `src/routes/api.js` — the three GET endpoints
- `src/services/dataService.js` — validation, pagination, response formatting
- `src/data/mockStore.js` — placeholder data (swap for real DB once ready)

## Run it
```
npm install
node src/app.js
```
Then try: http://localhost:3000/api/v1/customers

## Xero OAuth 2.0

The Xero connection uses the server-side OAuth 2.0 authorization-code flow. Create a
Xero **Web app** with the Auth Code grant and add the callback URL to its redirect-URI
allowlist. Configure these environment variables before starting the API:

```powershell
$env:XERO_CLIENT_ID = "your-client-id"
$env:XERO_CLIENT_SECRET = "your-client-secret"
$env:XERO_REDIRECT_URI = "http://localhost:3000/auth/xero/callback"
# Optional: overrides the minimum default scopes
$env:XERO_SCOPES = "offline_access accounting.contacts.read accounting.invoices.read accounting.payments.read"
```

Start the flow at `GET /api/v1/auth/xero/connect`. After consent, the callback exchanges
the code and discovers the authorised organisations. `GET /api/v1/auth/xero/connections`
returns their non-sensitive metadata.

Tokens and OAuth state are currently stored only in process memory; connections disappear
when the API restarts. Replace `src/auth/xero/connectionStore.js` with encrypted
durable storage before using this outside local development.

## Status
Mock data only. Waiting on:
- Canonical field confirmation from Chris
- Confirmation on who writes data into the database (see open questions in API design doc)
