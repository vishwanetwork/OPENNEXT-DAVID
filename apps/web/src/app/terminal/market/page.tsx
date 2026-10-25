import { MarketRoute } from '@/features/spot-market/components/MarketRoute';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <MarketRoute />
    </TerminalPage>
  );
}
