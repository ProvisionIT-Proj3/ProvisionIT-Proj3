-- Creates the accounts table for canonical Account data (Chris's ACCOUNT_SCHEMA).
--
-- Accounts are not a single Xero entity: they are built by buildXeroAccounts()
-- from GET /Accounts plus GET /Reports/TrialBalance, with synthesised header
-- rows per report section. This table stores the built result so the REST API
-- can read it like any other entity.
--
-- Columns beyond the canonical model:
--   sort_order   report order (header row, then its detail rows). A database
--                does not preserve insertion order, so this is required to
--                return the report in the right sequence.
--   report_date  as-of date of the trial balance. `value` is a balance for a
--                reporting period, so the period has to be recorded.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS accounts (
  account_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES connections(connection_id) ON DELETE CASCADE,
  source_id     varchar NOT NULL,
  code          varchar,
  name          varchar NOT NULL,
  type          varchar,
  dr_cr         varchar CHECK (dr_cr IN ('Dr', 'Cr')),
  is_header     boolean NOT NULL,
  level         integer NOT NULL,
  value         numeric,
  tax_code      varchar,
  sort_order    integer NOT NULL,
  report_date   date,
  created_at    timestamp NOT NULL DEFAULT now(),
  updated_at    timestamp NOT NULL DEFAULT now(),
  UNIQUE (connection_id, source_id)
);

CREATE INDEX IF NOT EXISTS accounts_connection_order_idx
  ON accounts (connection_id, sort_order);