import { BillingPage } from '@/features/billing';
import { TerminalPage } from '@/features/terminal';

export default function Page() {
  return (
    <TerminalPage>
      <BillingPage />
    </TerminalPage>
  );
}
