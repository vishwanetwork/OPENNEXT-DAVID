import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { json, mockFetch, renderTerminal, signIn } from '@/test/render';
import { initialWorkspace, useWorkspaceStore } from '@/terminal-kit';
import {
  InstanceAutopilot,
  autopilotSummary,
  parseVariables,
} from './components/instance-autopilot';

const waiting = {
  state: 'waiting',
  onSuccess: 'end',
  onFailure: 'keep',
  startedAt: null,
  stopRequested: false,
  outcome: null,
} as const;

beforeEach(() => {
  window.localStorage.clear();
  useWorkspaceStore.setState({ ...initialWorkspace() });
  signIn();
});

describe('Instance autopilot', () => {
  it('parses NAME=value lines and rejects reserved or invalid names', () => {
    expect(parseVariables('# comment\nEPOCHS=3\n\nURL=https://x/?a=b')).toEqual({
      EPOCHS: '3',
      URL: 'https://x/?a=b',
    });
    expect(() => parseVariables('1BAD=x')).toThrow(/valid name/);
    expect(() => parseVariables('SPOTBOT_ATTEMPT=1')).toThrow(/valid name/);
    expect(() => parseVariables('A=1\nA=2')).toThrow(/twice/);
    expect(() => parseVariables('A=')).toThrow(/no value/);
  });

  it('describes each state in one sentence', () => {
    expect(autopilotSummary(null)).toBe('No autopilot task is set.');
    expect(autopilotSummary(waiting)).toMatch(/when it fails the server keeps running/);
    expect(
      autopilotSummary({
        ...waiting,
        state: 'failed',
        outcome: { state: 'failed', exitCode: 2, action: 'end', finishedAt: null },
      }),
    ).toBe('The task failed with exit code 2. The server is ending, as you chose.');
  });

  it('requires a failure choice, saves the task and never shows secrets again', async () => {
    const posts: unknown[] = [];
    mockFetch((path, init) => {
      if (path.endsWith('/api/marketplace/instances/rental-1/autopilot')) {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          posts.push(body);
          return json(200, {
            task: {
              version: 1,
              script: body.script,
              env: body.env,
              secretNames: Object.keys(body.secrets),
              onSuccess: body.onSuccess,
              onFailure: body.onFailure,
              onReplacement: body.onReplacement,
              maxMinutes: body.maxMinutes,
            },
            status: waiting,
            logTail: '',
          });
        }
        return json(200, { task: null, status: null, logTail: '' });
      }
      return json(200, {});
    });
    renderTerminal(<InstanceAutopilot id="rental-1" ended={false} />);
    expect(await screen.findByText('No autopilot task is set.')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/git clone/), {
      target: { value: 'python train.py' },
    });
    fireEvent.change(screen.getByPlaceholderText('EPOCHS=3'), { target: { value: 'EPOCHS=3' } });
    fireEvent.change(screen.getByPlaceholderText('HF_TOKEN=hf_…'), {
      target: { value: 'HF_TOKEN=hf_secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save autopilot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/when the task fails/);
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByLabelText('Keep the server running so I can investigate'));
    fireEvent.click(screen.getByRole('button', { name: 'Save autopilot' }));
    await waitFor(() =>
      expect(posts).toEqual([
        {
          script: 'python train.py',
          env: { EPOCHS: '3' },
          secrets: { HF_TOKEN: 'hf_secret' },
          onSuccess: 'end',
          onFailure: 'keep',
          onReplacement: 'rerun',
          maxMinutes: null,
        },
      ]),
    );
    expect(await screen.findByText(/Waiting for the server/)).toBeInTheDocument();
    expect(screen.getByLabelText('Keep HF_TOKEN')).toBeChecked();
    expect(screen.queryByDisplayValue(/hf_secret/)).toBeNull();
  });

  it('shows the log and stops a running task', async () => {
    let stopped = false;
    mockFetch((path, init) => {
      if (path.endsWith('/autopilot/stop') && init?.method === 'POST') stopped = true;
      if (path.includes('/api/marketplace/instances/rental-1/autopilot'))
        return json(200, {
          task: {
            version: 1,
            script: 'python train.py',
            env: {},
            secretNames: [],
            onSuccess: 'end',
            onFailure: 'end',
            onReplacement: 'rerun',
            maxMinutes: null,
          },
          status: { ...waiting, state: 'running', stopRequested: stopped },
          logTail: 'epoch 1/3\n',
        });
      return json(200, {});
    });
    renderTerminal(<InstanceAutopilot id="rental-1" ended={false} />);
    expect(await screen.findByText('The task is running.')).toBeInTheDocument();
    expect(screen.getByText(/epoch 1\/3/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save autopilot' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop task' }));
    expect(await screen.findByText('Stopping the task…')).toBeInTheDocument();
    expect(stopped).toBe(true);
  });
});
