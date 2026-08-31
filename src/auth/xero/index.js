const router = require("./router");

// Connector contract: use this internal service, never an HTTP token endpoint.
// Example: xeroOAuth.request(connectionId, "https://api.xero.com/api.xro/2.0/Contacts").
module.exports = { router, xeroOAuth: router.xeroOAuth };
