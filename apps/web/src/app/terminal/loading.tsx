import { AsyncFeedback } from '@/components/ui/async-feedback';

/** Stream a page-level fallback while the shared Terminal navigation stays usable. */
export default function Loading() {
  return (
    <div className="page-content" aria-busy="true">
      <AsyncFeedback>Loading workspace…</AsyncFeedback>
    </div>
  );
}
