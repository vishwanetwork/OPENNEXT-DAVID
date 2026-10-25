import { CollectionPage } from '@/features/terminal/components/CollectionPage';
import { TerminalPage } from '@/features/terminal/TerminalPage';

export default function Page() {
  return (
    <TerminalPage>
      <CollectionPage type="saved" />
    </TerminalPage>
  );
}
