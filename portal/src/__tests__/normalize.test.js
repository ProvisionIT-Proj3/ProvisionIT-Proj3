import { describe, expect, it } from 'vitest';
import { normalizeConnection, normalizeInvoice, normalizePayment } from '../api/normalize';

describe('normalizers', () => {
  it('reads db-style and canonical invoices the same way', () => {
    const fromDb = { invoice_id: 'i1', source_id: 'INV-1', amount: '540.00', status: 'overdue', due_date: '2026-08-18', customer_name: 'Acme' };
    const canonical = { id: 'i1', invoiceNumber: 'INV-1', total: 540, status: 'overdue', dueDate: '2026-08-18', customerName: 'Acme' };
    const a = normalizeInvoice(fromDb);
    const b = normalizeInvoice(canonical);
    expect(a).toMatchObject({ id: 'i1', number: 'INV-1', total: 540, dueDate: '2026-08-18', customerName: 'Acme' });
    expect(b).toMatchObject({ id: 'i1', number: 'INV-1', total: 540, dueDate: '2026-08-18', customerName: 'Acme' });
  });

  it('leaves missing fields as null instead of throwing', () => {
    expect(normalizeInvoice({ id: 'x' })).toMatchObject({ total: null, dueDate: null, customerName: null });
    expect(normalizePayment({})).toMatchObject({ amount: null, date: null });
  });

  it('reads a connection row', () => {
    const c = normalizeConnection({ connection_id: 'c1', company_name: 'Riverbend Cafe', platform: 'xero', status: 'active', last_synced_at: null });
    expect(c).toMatchObject({ id: 'c1', companyName: 'Riverbend Cafe', platform: 'xero', lastSyncedAt: null });
  });
});
