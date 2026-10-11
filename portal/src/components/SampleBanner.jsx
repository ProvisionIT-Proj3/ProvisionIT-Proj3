import { isSample } from '../api/sample';

// shown when a page is running on sample data instead of the real API
export default function SampleBanner({ path, children }) {
  if (!isSample(path)) return null;
  return (
    <div className="banner info" role="note">
      <span>{children ?? 'Showing sample data.'}</span>
    </div>
  );
}
