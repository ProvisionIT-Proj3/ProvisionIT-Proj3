# Xero OAuth integration contract

This module owns Xero OAuth 2.0 for the ProvisionIT MVP. It maps one Xero
connection to the canonical `Company.connectionId` and never exposes OAuth tokens
through an HTTP response.

## HTTP routes

- `GET /auth/xero/connect` - starts the user-consent flow.
- `GET /auth/xero/callback` - Xero callback; returns non-sensitive connection metadata.
- `GET /api/v1/auth/xero/connections` - lists connected companies for the portal.
- `DELETE /api/v1/auth/xero/connections/:connectionId` - disconnects a company from Xero.

`/api/v1/auth/...` is supported for all routes. The non-versioned `/auth/...` path
is retained because it is the Xero redirect URI used in local development.

## Connector hand-off

Connector code uses the internal service, not an HTTP token endpoint:

```js
const { xeroOAuth } = require("../auth/xero");
const response = await xeroOAuth.request(
  company.connectionId,
  "https://api.xero.com/api.xro/2.0/Contacts",
);
```

The service applies `Authorization: Bearer ...` and `xero-tenant-id`, and refreshes
tokens within 60 seconds of expiry.

## Database hand-off

`connectionStore.js` is an in-memory development adapter. The database owner must
replace it with an encrypted durable adapter implementing:

```text
save(connection)
getByConnectionId(connectionId)
updateTokens(connectionId, tokens)
deleteByConnectionId(connectionId)
list()
```

Persist `connectionId`, `tenantId`, `tenantName`, `tenantType`, `accessToken`,
`refreshToken`, and `expiresAt`. Encrypt tokens at rest; never return or log them.
