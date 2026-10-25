import { ProfilePage } from '@/features/account';
import { TerminalPage } from '@/features/terminal';

export default function Page() {
  return (
    <TerminalPage>
      <ProfilePage />
    </TerminalPage>
  );
}
