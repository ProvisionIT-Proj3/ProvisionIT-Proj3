export const PLATFORM_LABELS = { xero: 'Xero', myob: 'MYOB', quickbooks: 'QuickBooks' };

// same values as the invoices.status column
export const INVOICE_STATUSES = ['draft', 'awaiting_payment', 'paid', 'overdue'];

export const PAGE_SIZE = 10;

// the platforms the API can connect and disconnect
export const CONNECT_PLATFORMS = ['xero', 'quickbooks'];

// audit_log.action values, in plain words for the Activity page
export const ACTION_LABELS = {
  'connection.created': 'Company connected',
  'connection.disconnected': 'Company disconnected',
  'connection.reauthorization_required': 'Needs authorising again',
  'oauth.completed': 'Authorisation approved',
  'oauth.failed': 'Authorisation failed',
  'token.refreshed': 'Access token refreshed',
  'sync.completed': 'Accounts synced',
  'sync.failed': 'Sync failed',
  'authentication.failed': 'Sign-in failed',
  'authorization.denied': 'Permission denied',
  'connection.access.denied': 'Company access denied',
  'connection.access.failed': 'Company access check failed',
  'connection.list.denied': 'Company list denied',
  'connection.list.failed': 'Company list failed',
  'authentication.succeeded': 'Signed in',
  'authorization.granted': 'Permission check passed',
  'connection.access.granted': 'Company access granted',
  'connection.list.granted': 'Company list viewed',
};
