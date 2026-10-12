import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useConnection } from '../ConnectionContext';
import { PLATFORM_LABELS } from '../constants';

const links = [
  ['/connections', 'Connections'],
  ['/accounts', 'Accounts'],
  ['/trial-balance', 'Trial balance'],
  ['/invoices', 'Invoices'],
  ['/payments', 'Payments'],
  ['/customers', 'Customers'],
];

export default function Layout() {
  const { connections, active, select } = useConnection();
  const { status, user, signOut } = useAuth();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          ProvisionIT<span>Admin Portal</span>
        </div>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <label className="company-picker">
            <span>Company</span>
            <select
              aria-label="Active company"
              value={active?.id ?? ''}
              onChange={(e) => select(e.target.value)}
              disabled={!connections.length}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.companyName} ({PLATFORM_LABELS[c.platform] ?? c.platform})
                </option>
              ))}
              {!connections.length && <option value="">No companies</option>}
            </select>
          </label>
          {status === 'in' && (
            <div className="user-box">
              <span>{user?.email}</span>
              <button className="btn ghost sm" onClick={signOut}>
                Sign out
              </button>
            </div>
          )}
        </header>
        {/* key remounts the page so filters and paging reset when the company changes */}
        <main className="content" key={active?.id ?? 'none'}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
