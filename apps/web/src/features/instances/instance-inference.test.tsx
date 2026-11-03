import { beforeEach, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import { InstanceInference } from './components/instance-inference';

const status = {
  preset_id: 'deepseek-r1-distill-7b',
  state: 'downloading',
  billing_start: 'gpu_delivery',
  version: 1,
  model_gpu_count: 1,
  downloaded_bytes: 2 ** 30,
  total_bytes: 2 ** 31,
};

beforeEach(() => signIn());

it('shows preparation progress without claiming a usable endpoint', async () => {
  mockFetch(() => json(200, { status, connection: null }));
  renderTerminal(<InstanceInference id="rental-1" ended={false} />);
  expect(await screen.findByText('Downloading model files')).toBeInTheDocument();
  expect(screen.getByRole('progressbar', { name: 'Model download' })).toHaveAttribute(
    'value',
    String(2 ** 30),
  );
  expect(screen.queryByLabelText('Inference Base URL')).not.toBeInTheDocument();
  expect(screen.getByText(/paid GPU time/)).toBeInTheDocument();
  expect(screen.getByText(/The model uses 1 GPU/)).toBeInTheDocument();
});

it('reveals the customer key on request and never embeds it in the example command', async () => {
  mockFetch(() =>
    json(200, {
      status: { ...status, state: 'ready' },
      connection: {
        baseUrl: 'https://r-example.gpu.test/v1',
        model: status.preset_id,
        apiKey: 'customer-key',
        keyVersion: 0,
      },
    }),
  );
  renderTerminal(<InstanceInference id="rental-2" ended={false} />);
  const key = await screen.findByLabelText('API key');
  expect(key).toHaveAttribute('type', 'password');
  fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
  expect(key).toHaveAttribute('type', 'text');
  const example = screen.getByText(/curl/);
  expect(example).toHaveTextContent('$INFERENCE_API_KEY');
  expect(example).not.toHaveTextContent('customer-key');
  expect(example.textContent).not.toMatch(/\n\+/);
});
