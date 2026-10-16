import { NavLink, Outlet } from 'react-router-dom';
import { useConnection } from '../ConnectionContext';
import { PLATFORM_LABELS } from '../constants';

// The API only serves accounts for now, so the sample-data pages (invoices, payments,
// customers) stay reachable by URL but are kept out of the menu.
const links = [
  ['/connections', 'Connections'],
  ['/accounts', 'Accounts'],
  ['/trial-balance', 'Trial balance'],
];

export default function Layout() {
  const { connections, active, select } = useConnection();

  return (
    <div className="shell">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className="topbar">
        <div className="brand">ProvisionIT</div>
        <nav className="nav" aria-label="Main">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              {label}
            </NavLink>
          ))}
        </nav>
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
      <main className="content" id="content" key={active?.id ?? 'none'}>
        <Outlet />
      </main>
    </div>
  );
}
