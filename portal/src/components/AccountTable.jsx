import { useMemo, useState } from 'react';
import { accountsToCsv, downloadCsv } from '../csv';
import { formatMoney } from '../format';
import BalanceCheck from './BalanceCheck';
import DataTable from './DataTable';

const has = (value, query) => String(value ?? '').toLowerCase().includes(query);
const matches = (a, query) => has(a.code, query) || has(a.name, query) || has(a.type, query);

// Keeps each header row with the accounts under it, so a section can be searched and collapsed as one.
function groupSections(items) {
  const sections = [];
  let current = null;
  for (const a of items) {
    if (a.isHeader || !current) {
      current = { header: a.isHeader ? a : null, rows: [] };
      sections.push(current);
    }
    if (!a.isHeader) current.rows.push(a);
  }
  return sections;
}

export function visibleRows(items, query, collapsed) {
  const q = query.trim().toLowerCase();
  return groupSections(items).flatMap(({ header, rows }) => {
    if (q) {
      // a section whose own name matches shows all its accounts
      const shown = header && matches(header, q) ? rows : rows.filter((a) => matches(a, q));
      if (shown.length === 0) return [];
      return header ? [header, ...shown] : shown;
    }
    if (header && collapsed.has(header.id)) return [header];
    return header ? [header, ...rows] : rows;
  });
}

export default function AccountTable({ list, onPage, emptyMessage, actions, fileName = 'accounts' }) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const searching = query.trim() !== '';

  const rows = useMemo(() => visibleRows(list.items, query, collapsed), [list.items, query, collapsed]);
  const accountCount = list.items.filter((a) => !a.isHeader).length;
  const shownCount = rows.filter((a) => !a.isHeader).length;

  const toggle = (id) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const exportCsv = () => downloadCsv(`${fileName}.csv`, accountsToCsv(list.items));

  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          className="search"
          aria-label="Search accounts"
          placeholder="Search by code, name or type"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="spacer" />
        {actions}
        <button className="btn" onClick={exportCsv} disabled={list.items.length === 0}>
          Export CSV
        </button>
      </div>

      <BalanceCheck items={list.items} pagination={list.pagination} />
      <p className="result-count" role="status">
        {searching ? `${shownCount} of ${accountCount} accounts` : ''}
      </p>

      <div className="table-wrap">
        <DataTable
          columns={['Code', 'Account', 'Type', 'Dr/Cr', 'Balance']}
          columnClasses={['', '', 'hide-sm', '', 'num']}
          list={{ ...list, items: rows }}
          onPage={onPage}
          emptyMessage={searching ? `No accounts match "${query.trim()}".` : emptyMessage}
          renderRow={(a, i) =>
            a.isHeader ? (
              <tr key={a.id ?? i} className="row-header">
                <td />
                <th scope="row" colSpan={3}>
                  <button
                    className="section-toggle"
                    aria-expanded={searching || !collapsed.has(a.id)}
                    disabled={searching}
                    onClick={() => toggle(a.id)}
                  >
                    {a.name}
                  </button>
                </th>
                <td className="num">{a.value == null ? '' : formatMoney(a.value)}</td>
              </tr>
            ) : (
              <tr key={a.id ?? i}>
                <td className="code">{a.code || '—'}</td>
                <td>{a.name}</td>
                <td className="hide-sm soft">{a.type ?? '—'}</td>
                <td className="soft">{a.drCr ?? '—'}</td>
                <td className="num">{a.value == null ? '' : formatMoney(a.value)}</td>
              </tr>
            )
          }
        />
      </div>
    </div>
  );
}
