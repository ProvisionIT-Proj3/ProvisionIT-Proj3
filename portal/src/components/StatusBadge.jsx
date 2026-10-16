import { labelFor, statusTone } from '../format';

// a coloured dot plus the word, so the state never relies on colour alone
export default function StatusBadge({ status }) {
  return (
    <span className={`badge ${statusTone(status)}`}>
      <span className="dot" aria-hidden="true" />
      {labelFor(status)}
    </span>
  );
}
