-- DEMO DATA ONLY. Sample accounts for the Riverbend Cafe test connection,
-- matching the shape buildXeroAccounts() produces from a Xero trial balance.
-- Lets the /accounts endpoint be tested end to end before the real sync
-- writes accounts. Safe to run more than once.

INSERT INTO accounts
  (connection_id, source_id, code, name, type, dr_cr, is_header, level, value, tax_code, sort_order, report_date)
VALUES
  ('5adce2dd-1331-4700-8600-c226221d89da', 'header:Bank',    'HDR-1', 'Bank',                  'Bank',    'Dr', true,  1, 25000.00, NULL,  1, '2026-08-31'),
  ('5adce2dd-1331-4700-8600-c226221d89da', 'acc_090',        '090',   'Business Bank Account', 'BANK',    'Dr', false, 2, 25000.00, 'N-T', 2, '2026-08-31'),
  ('5adce2dd-1331-4700-8600-c226221d89da', 'header:Revenue', 'HDR-2', 'Revenue',               'Revenue', 'Cr', true,  1, 40000.00, NULL,  3, '2026-08-31'),
  ('5adce2dd-1331-4700-8600-c226221d89da', 'acc_200',        '200',   'Sales',                 'REVENUE', 'Cr', false, 2, 40000.00, 'GST', 4, '2026-08-31')
ON CONFLICT (connection_id, source_id) DO NOTHING;