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

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Middleware API listening on port ${port}`);
});
