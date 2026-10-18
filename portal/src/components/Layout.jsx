import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useConnection } from '../ConnectionContext';
import { PLATFORM_LABELS } from '../constants';
import Icon from './Icon';

// group name, then [path, label, icon]
const groups = [
  ['Overview', [['/', 'Dashboard', 'grid']]],
  [
    'Manage',
    [
      ['/connections', 'Connections', 'link'],
      ['/accounts', 'Accounts', 'list'],
      ['/trial-balance', 'Trial balance', 'chart'],
    ],
  ],
  [
    'Records',
    [
      ['/invoices', 'Invoices', 'file'],
      ['/payments', 'Payments', 'card'],
      ['/customers', 'Customers', 'users'],
    ],
  ],
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
          {groups.map(([group, links]) => (
            <div key={group}>
              <div className="nav-label">{group}</div>
              {links.map(([to, label, icon]) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                >
                  <Icon name={icon} />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {status === 'in' && (
          <div className="side-user">
            <div className="who-row">
              <span className="avatar" aria-hidden="true">
                {(user?.email ?? '?').slice(0, 2).toUpperCase()}
              </span>
              <span className="who">{user?.email}</span>
            </div>
            <button className="btn ghost sm" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
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
        </header>
        {/* key remounts the page so filters and paging reset when the company changes */}
        <main className="content" key={active?.id ?? 'none'}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
