import { useState } from 'react';
import { api } from '../api';
import { INVOICE_STATUSES, PAGE_SIZE } from '../constants';
import { formatDate, formatMoney, labelFor } from '../format';
import { useDebounced, useList } from '../hooks';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import RequireConnection from '../components/RequireConnection';
import SampleBanner from '../components/SampleBanner';
import StatusBadge from '../components/StatusBadge';

function InvoiceList({ connection }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);

  const list = useList(
    () => api.listInvoices({ connectionId: connection.id, page, pageSize: PAGE_SIZE, status, search: q }),
    [connection.id, page, status, q],
  );

  return (
    <>
      <div className="filters">
        <input
          type="search"
          aria-label="Search customer"
          placeholder="Search customer name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {labelFor(s)}
            </option>
          ))}
        </select>
      </div>
      <DataTable
        columns={['Invoice', 'Customer', 'Amount', 'Status', 'Issued', 'Due']}
        list={list}
        onPage={setPage}
        emptyMessage="No invoices match these filters."
        renderRow={(inv) => (
          <tr key={inv.id}>
            <td>{inv.number}</td>
            <td>{inv.customerName ?? inv.customerId ?? '—'}</td>
            <td>{formatMoney(inv.total)}</td>
            <td>
              <StatusBadge status={inv.status} />
            </td>
            <td>{formatDate(inv.issueDate)}</td>
            <td>{formatDate(inv.dueDate)}</td>
          </tr>
        )}
      />
    </>
  );
}

export default function Invoices() {
  return (
    <>
      <PageHeader title="Invoices" subtitle="Search and filter the selected company's invoices" />
      <SampleBanner path="/invoices">Sample data. The API has no invoices route yet, this shows what the page will look like.</SampleBanner>
      <RequireConnection>{(connection) => <InvoiceList connection={connection} />}</RequireConnection>
    </>
  );
}
