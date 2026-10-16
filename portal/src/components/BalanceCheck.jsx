import { formatMoney } from '../format';

const round2 = (n) => Math.round(n * 100) / 100;

// A trial balance should have equal debits and credits. Only meaningful when every
// account is on screen, so it stays quiet when the list is split over several pages.
export default function BalanceCheck({ items, pagination }) {
  if (pagination && pagination.totalPages > 1) return null;

  const rows = items.filter((a) => !a.isHeader && (a.drCr === 'Dr' || a.drCr === 'Cr') && a.value != null);
  if (rows.length === 0) return null;

  const total = (side) => round2(rows.filter((a) => a.drCr === side).reduce((sum, a) => sum + Number(a.value), 0));
  const debits = total('Dr');
  const credits = total('Cr');
  const difference = round2(debits - credits);
  const balanced = difference === 0;

  return (
    <p className="check" data-state={balanced ? 'ok' : 'off'}>
      <span className="dot" aria-hidden="true" />
      <span>
        Debits {formatMoney(debits)}, credits {formatMoney(credits)}.{' '}
        {balanced ? 'In balance.' : `Out of balance by ${formatMoney(Math.abs(difference))}.`}
      </span>
    </p>
  );
}
