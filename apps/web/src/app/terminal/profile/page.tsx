import { ProfilePage } from '@/features/account/components/ProfilePage';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <ProfilePage />
    </TerminalPage>
  );
}
