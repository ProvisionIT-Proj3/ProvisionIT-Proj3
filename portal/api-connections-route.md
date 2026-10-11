# GET /connections for the portal

Add this to `src/routes/api.js` (the portal's company picker needs it).

Near the top, with the other requires:

```js
const persistence = require("../persistence");
```

Above `module.exports = router;`:

```js
// Connected companies for the admin portal. No tokens, only display fields.
router.get("/connections", async (req, res, next) => {
  try {
    const rows = await persistence.listConnections();
    res.json({
      data: rows.map((r) => ({
        connectionId: r.connection_id,
        companyName: r.company_name,
        platform: r.platform,
        status: r.status,
        dateConnected: r.date_connected,
        lastSyncedAt: r.last_synced_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});
```
