const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");

// All routes are read-only GET endpoints, per FR-10.
// Company scoping uses a connectionId query param for now (temporary,
// pending team decision — see API design doc open item 1).

router.get("/customers", async (req, res, next) => {
  try {
    res.json(await dataService.getCustomers(req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/invoices", async (req, res, next) => {
  try {
    res.json(await dataService.getInvoices(req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/payments", async (req, res, next) => {
  try {
    res.json(await dataService.getPayments(req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/accounts", async (req, res, next) => {
  try {
    res.json(await dataService.getAccounts(req.query));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
