const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");

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

router.get("/customers", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);

    const result = await dataService.getCustomers(
      connectionId,
      req.query
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/invoices", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);

    const result = await dataService.getInvoices(
      connectionId,
      req.query
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/payments", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);

    const result = await dataService.getPayments(
      connectionId,
      req.query
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/accounts", async (req, res, next) => {
  try {
    const connectionId = getConnectionId(req);
    const result = await dataService.getAccounts(
      connectionId,
      req.query
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;