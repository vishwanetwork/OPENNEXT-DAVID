import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AsyncButton, AsyncFeedback } from './async-feedback';

describe('shared asynchronous feedback', () => {
  it('announces progress and prevents duplicate actions until completion', () => {
    const click = vi.fn();
    const view = render(
      <>
        <AsyncFeedback>Saving…</AsyncFeedback>
        <AsyncButton busy busyLabel="Saving…" onClick={click}>
          Save
        </AsyncButton>
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
    view.rerender(<AsyncButton onClick={click}>Save</AsyncButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(click).toHaveBeenCalledOnce();
  });
});
