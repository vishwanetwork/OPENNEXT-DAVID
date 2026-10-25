import { BillingPage } from '@/features/billing';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <BillingPage />
    </TerminalPage>
  );
}
