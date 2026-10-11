import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ConnectionProvider } from './ConnectionContext';
import Layout from './components/Layout';
import Accounts from './pages/Accounts';
import Connections from './pages/Connections';
import Customers from './pages/Customers';
import Invoices from './pages/Invoices';
import Login from './pages/Login';
import Payments from './pages/Payments';
import TrialBalance from './pages/TrialBalance';

// Nothing under here (and so no API call) runs until the user is signed in.
function Gate({ children }) {
  const { status } = useAuth();
  if (status === 'loading') return <p className="gate-note">Checking your session...</p>;
  if (status === 'signedOut') return <Login />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate>
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
      </Gate>
    </AuthProvider>
  );
}
