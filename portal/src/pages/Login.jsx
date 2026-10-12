import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

function loginMessage(err) {
  if (err?.status === 400 || /invalid login/i.test(err?.message ?? '')) return 'Wrong email or password.';
  if (/fetch|network/i.test(err?.message ?? '')) return "Can't reach Supabase. Check your internet and the URL in .env.";
  return "Couldn't sign in. Try again.";
}

export default function Login() {
  const { status, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (status === 'off') return <Navigate to="/" replace />;
  if (status === 'in') return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(loginMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          ProvisionIT<span>Admin Portal</span>
        </div>
        <h1>Sign in</h1>
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy || status === 'loading'}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
