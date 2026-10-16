import { api } from '../api';
import { useList } from '../hooks';
import AccountTable from '../components/AccountTable';
import PageHeader from '../components/PageHeader';
import RequireConnection from '../components/RequireConnection';
import SampleBanner from '../components/SampleBanner';

function Report({ connection }) {
  const list = useList(() => api.getTrialBalance(connection.id), [connection.id]);
  return (
    <AccountTable
      list={list}
      fileName={`${connection.companyName}-trial-balance`.replace(/[^\w-]+/g, '-').toLowerCase()}
      emptyMessage="No trial balance yet. Sync this company's accounts first."
    />
  );
}

export default function TrialBalance() {
  return (
    <>
      <PageHeader title="Trial balance" subtitle="Account balances for the selected company" />
      <SampleBanner path="/trial-balance">Sample data. Turn off VITE_USE_MOCK to read from the API.</SampleBanner>
      <RequireConnection>{(connection) => <Report connection={connection} />}</RequireConnection>
    </>
  );
}
