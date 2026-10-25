import { PendingFeaturePage } from '@/features/terminal/placeholders';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <PendingFeaturePage title="Notifications" feature="quote-preview" />
    </TerminalPage>
  );
}
