export function formatMoney(value) {
  const n = Number(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function labelFor(value) {
  if (!value) return '—';
  const text = String(value).replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TONES = {
  paid: 'good',
  active: 'good',
  completed: 'good',
  overdue: 'bad',
  failed: 'bad',
  draft: 'warn',
  awaiting_payment: 'warn',
  unpaid: 'warn',
  pending: 'warn',
  token_expiring: 'warn',
  token_expired: 'warn',
};

export function statusTone(value) {
  return TONES[String(value ?? '').toLowerCase()] ?? 'muted';
}
