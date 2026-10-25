import { NotificationsPage } from '@/features/quotes/components/NotificationsPage';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <NotificationsPage />
    </TerminalPage>
  );
}
