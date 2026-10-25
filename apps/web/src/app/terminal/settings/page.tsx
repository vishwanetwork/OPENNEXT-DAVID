import { SettingsPage } from '@/features/terminal/components/SettingsPage';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <SettingsPage />
    </TerminalPage>
  );
}
