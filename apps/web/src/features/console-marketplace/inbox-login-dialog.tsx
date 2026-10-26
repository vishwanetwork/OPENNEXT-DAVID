import { AdminLoginForm, NativeDialog } from '@/features/console';

export function InboxLoginDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => Promise<void>;
}) {
  return (
    <NativeDialog className="market-console-dialog" onClose={onClose}>
      <header>
        <h2>Administrator session</h2>
        <button type="button" className="btn" onClick={onClose} aria-label="Close dialog">
          ×
        </button>
      </header>
      <AdminLoginForm
        intro={<p>Use the server administrator token to create an HTTP-only session.</p>}
        inputClassName="field"
        onConnected={onConnected}
      />
    </NativeDialog>
  );
}
