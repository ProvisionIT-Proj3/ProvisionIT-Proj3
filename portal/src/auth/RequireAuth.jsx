import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function RequireAuth({ children }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <p className="muted auth-loading">Loading…</p>;
  if (status === 'out') return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
