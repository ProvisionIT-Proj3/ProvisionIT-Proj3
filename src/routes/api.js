const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");
const { getAccounts: getQuickBooksAccounts } = require(
  "../connector/quickbooks/accounts"
);
const { getTrialBalance: getQuickBooksTrialBalance } = require(
  "../connector/quickbooks/trialBalance"
);
function getConnectionId(req) {
  const connectionId = req.query.connectionId;

  if (!connectionId) {
    const err = new Error("connectionId is required.");
    err.status = 400;
    err.code = "MISSING_CONNECTION_ID";
    throw err;
  }

  return connectionId;
}

router.get("/accounts", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    const result = await dataService.getAccounts(connectionId);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/trial-balance", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    const result = await dataService.getTrialBalance(connectionId);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/quickbooks-test/accounts", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);

    const accounts = await getQuickBooksAccounts(connectionId);

    res.json({
      data: accounts,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/quickbooks-test/trial-balance", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);

    const trialBalance = await getQuickBooksTrialBalance(connectionId);

    res.json({
      data: trialBalance,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
