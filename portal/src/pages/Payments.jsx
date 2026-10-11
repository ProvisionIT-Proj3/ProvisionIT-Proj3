import { useState } from 'react';
import { api } from '../api';
import { PAGE_SIZE } from '../constants';
import { formatDate, formatMoney } from '../format';
import { useList } from '../hooks';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import RequireConnection from '../components/RequireConnection';
import SampleBanner from '../components/SampleBanner';

function PaymentList({ connection }) {
  const [page, setPage] = useState(1);
  const list = useList(
    () => api.listPayments({ connectionId: connection.id, page, pageSize: PAGE_SIZE }),
    [connection.id, page],
  );

  return (
    <DataTable
      columns={['Payment', 'Invoice', 'Amount', 'Method', 'Date']}
      list={list}
      onPage={setPage}
      emptyMessage="No payments recorded for this company."
      renderRow={(p) => (
        <tr key={p.id}>
          <td>{p.id}</td>
          <td>{p.invoiceId ?? '—'}</td>
          <td>{formatMoney(p.amount)}</td>
          <td>{p.method ?? '—'}</td>
          <td>{formatDate(p.date)}</td>
        </tr>
      )}
    />
  );
}

export default function Payments() {
  return (
    <>
      <PageHeader title="Payments" subtitle="Payments received for the selected company" />
      <SampleBanner path="/payments">Sample data. The API has no payments route yet, this shows what the page will look like.</SampleBanner>
      <RequireConnection>{(connection) => <PaymentList connection={connection} />}</RequireConnection>
    </>
  );
}
