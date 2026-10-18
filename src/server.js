// Settings are checked before the app loads, so a bad deploy stops at boot
// instead of failing on the first request.

require("dotenv").config();
const { checkEnv } = require("./config/checkEnv");

const { errors, warnings } = checkEnv(process.env);
warnings.forEach((w) => console.warn(`[config] ${w}`));
if (errors.length) {
  errors.forEach((e) => console.error(`[config] ${e}`));
  process.exit(1);
}

const app = require("./app");
const { waitForAuditWrites } = require("./security/auditLogger");

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Middleware API listening on port ${port}`);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  // Give completed requests time to persist their audit batches before a redeploy.
  const deadline = setTimeout(() => process.exit(1), 10_000);
  deadline.unref();
  server.close(async () => {
    await waitForAuditWrites();
    clearTimeout(deadline);
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
