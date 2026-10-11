import { formatMoney } from '../format';
import DataTable from './DataTable';

export default function AccountTable({ list, onPage, emptyMessage }) {
  return (
    <DataTable
      columns={['Code', 'Account', 'Type', 'Dr/Cr', 'Balance']}
      list={list}
      onPage={onPage}
      emptyMessage={emptyMessage}
      renderRow={(a, i) => (
        <tr key={a.id ?? i} className={a.isHeader ? 'row-header' : ''}>
          <td>{a.code || '—'}</td>
          <td style={{ paddingLeft: 12 + Math.min(a.level, 4) * 18 }}>{a.name}</td>
          <td>{a.isHeader ? '' : (a.type ?? '—')}</td>
          <td>{a.drCr ?? '—'}</td>
          <td className="num">{a.value == null ? '' : formatMoney(a.value)}</td>
        </tr>
      )}
    />
  );
}
