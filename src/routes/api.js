const express = require("express");
const router = express.Router();
const dataService = require("../services/dataService");

// All routes are read-only GET endpoints, per FR-10.
// Company scoping (connectionId) will be added once the team confirms
// the approach (see open question in API design doc).

router.get("/customers", (req, res, next) => {
  try {
    res.json(dataService.getCustomers(req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/invoices", (req, res, next) => {
  try {
    res.json(dataService.getInvoices(req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/payments", (req, res, next) => {
  try {
    res.json(dataService.getPayments(req.query));
  } catch (err) {
    next(err);
  }
});

router.get("/accounts", (req, res, next) => {
  try { res.json(dataService.getAccounts(req.query)); } catch (err) { next(err); }
});

module.exports = router;
