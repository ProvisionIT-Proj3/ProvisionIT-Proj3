import { useState } from 'react';
import { api } from '../api';
import { PAGE_SIZE } from '../constants';
import { useList } from '../hooks';
import DataTable from '../components/DataTable';
import PageHeader from '../components/PageHeader';
import RequireConnection from '../components/RequireConnection';
import SampleBanner from '../components/SampleBanner';
import StatusBadge from '../components/StatusBadge';

function CustomerList({ connection }) {
  const [page, setPage] = useState(1);
  const list = useList(
    () => api.listCustomers({ connectionId: connection.id, page, pageSize: PAGE_SIZE }),
    [connection.id, page],
  );

  return (
    <DataTable
      columns={['Name', 'Email', 'Phone', 'Status']}
      list={list}
      onPage={setPage}
      emptyMessage="No customers synced for this company yet."
      renderRow={(c) => (
        <tr key={c.id}>
          <td>{c.name}</td>
          <td>{c.email ?? '—'}</td>
          <td>{c.phone ?? '—'}</td>
          <td>{c.status ? <StatusBadge status={c.status} /> : '—'}</td>
        </tr>
      )}
    />
  );
}

export default function Customers() {
  return (
    <>
      <PageHeader title="Customers" subtitle="Customers synced from the accounting platform" />
      <SampleBanner path="/customers">Sample data. The API has no customers route yet, this shows what the page will look like.</SampleBanner>
      <RequireConnection>{(connection) => <CustomerList connection={connection} />}</RequireConnection>
    </>
  );
}
