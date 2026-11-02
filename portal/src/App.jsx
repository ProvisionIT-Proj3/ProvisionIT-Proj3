import { Outlet, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import { ConnectionProvider } from './ConnectionContext';
import Layout from './components/Layout';
import Accounts from './pages/Accounts';
import Activity from './pages/Activity';
import Connections from './pages/Connections';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
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
            <Route index element={<Dashboard />} />
            <Route path="connections" element={<Connections />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="trial-balance" element={<TrialBalance />} />
            <Route path="activity" element={<Activity />} />
            <Route path="*" element={<p className="muted">Page not found.</p>} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
