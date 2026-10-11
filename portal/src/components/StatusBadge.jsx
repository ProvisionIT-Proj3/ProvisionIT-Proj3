import { labelFor, statusTone } from '../format';

export default function StatusBadge({ status }) {
  return <span className={`badge ${statusTone(status)}`}>{labelFor(status)}</span>;
}
