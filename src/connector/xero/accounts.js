const { xeroRequest } = require("./xeroClient");

async function getAccounts(connectionId) {
  const data = await xeroRequest(
    connectionId,
    "Accounts"
  );

  return data.Accounts ?? [];
}

module.exports = { getAccounts };