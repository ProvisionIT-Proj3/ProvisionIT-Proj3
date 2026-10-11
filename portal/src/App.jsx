import { Navigate, Route, Routes } from 'react-router-dom';
import { ConnectionProvider } from './ConnectionContext';
import Layout from './components/Layout';
import Accounts from './pages/Accounts';
import Connections from './pages/Connections';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Payments from './pages/Payments';
import TrialBalance from './pages/TrialBalance';

export default function App() {
  return (
    <ConnectionProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/connections" replace />} />
          <Route path="connections" element={<Connections />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="trial-balance" element={<TrialBalance />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="payments" element={<Payments />} />
          <Route path="customers" element={<Customers />} />
          <Route path="*" element={<p className="muted">Page not found.</p>} />
        </Route>
      </Routes>
    </ConnectionProvider>
  );
}
