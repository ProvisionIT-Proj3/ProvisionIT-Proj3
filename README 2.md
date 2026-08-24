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

## Status
Mock data only. Waiting on:
- Canonical field confirmation from Chris
- Confirmation on who writes data into the database (see open questions in API design doc)
