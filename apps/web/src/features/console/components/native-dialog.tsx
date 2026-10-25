/**
 * `<dialog>` wrapper used by the server-backed console pages (price sources, leads, top-ups,
 * marketplace inbox). Escape closes it like every other dialog (the legacy console swallowed
 * Escape); outside clicks close it too.
 */
export { NativeDialog } from '@/components/ui/dialog';
