import { SellerActivitiesPage } from '@/features/seller/components/SellerActivitiesPage';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <SellerActivitiesPage />
    </TerminalPage>
  );
}
