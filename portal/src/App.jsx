import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import { ConnectionProvider } from './ConnectionContext';
import Layout from './components/Layout';
import Accounts from './pages/Accounts';
import Connections from './pages/Connections';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Login from './pages/Login';
import Payments from './pages/Payments';
import TrialBalance from './pages/TrialBalance';

// companies only load once the user is signed in
function Protected() {
  return (
    <RequireAuth>
      <ConnectionProvider>
        <Outlet />
      </ConnectionProvider>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route element={<Protected />}>
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
        </Route>
      </Routes>
    </AuthProvider>
  );
}
