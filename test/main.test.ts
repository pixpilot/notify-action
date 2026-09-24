import * as core from '@actions/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vitest resolves this to __mocks__/@actions/core.ts
vi.mock('@actions/core');

const { run } = await import('../src/main');

/**
 * Exercises `run` end to end - real inputs parsing, real channel construction
 * and real dispatch - with only the network boundary and `@actions/core`
 * replaced.
 */
function withInputs(values: Record<string, string>): void {
  vi.mocked(core.getInput).mockImplementation((name: string) => values[name] ?? '');
}

function outputs(): Record<string, string> {
  return Object.fromEntries(
    vi.mocked(core.setOutput).mock.calls.map(([name, value]) => [name, value as string]),
  );
}

const telegramInputs = {
  status: 'failure',
  'telegram-bot-token': 'BOT:secret',
  'telegram-chat-id': '-100123',
};

describe('main.ts', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('GITHUB_REPOSITORY', 'pixpilot/notify-action');
    vi.stubEnv('GITHUB_WORKFLOW', 'CI');
    vi.stubEnv('GITHUB_JOB', 'build');
    vi.stubEnv('GITHUB_REF_NAME', 'main');
    vi.stubEnv('GITHUB_SHA', 'd5049a9c0ffee1234567890abcdef');
    vi.stubEnv('GITHUB_ACTOR', 'mdoaie');
    vi.stubEnv('GITHUB_EVENT_NAME', 'push');
    vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
    vi.stubEnv('GITHUB_RUN_ID', '42');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '1');

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async (): Promise<string> => JSON.stringify({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    withInputs({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  describe('when the status is not one to notify on', () => {
    it('should do nothing and report that it did not notify', async () => {
      withInputs({
        ...telegramInputs,
        status: 'success',
        'notify-on': 'failure, cancelled',
      });

      await run();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(outputs()).toEqual({
        notified: 'false',
        channels: '',
        'failed-channels': '',
        status: 'success',
      });
      expect(vi.mocked(core.info)).toHaveBeenCalledWith(
        'Status "success" is not in "failure, cancelled", nothing to notify.',
      );
    });

    it('should notify on every outcome by default', async () => {
      withInputs({ ...telegramInputs, status: 'success' });

      await run();

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(outputs().notified).toBe('true');
    });
  });

  describe('when no channel is configured', () => {
    it('should warn rather than fail', async () => {
      withInputs({ status: 'failure' });

      await run();

      expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
        expect.stringContaining('No notification channel is configured'),
      );
      expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
      expect(outputs().notified).toBe('false');
    });
  });

  describe('when a channel delivers', () => {
    it('should report the delivery in the outputs', async () => {
      withInputs(telegramInputs);

      await run();

      expect(outputs()).toEqual({
        notified: 'true',
        channels: 'telegram',
        'failed-channels': '',
        status: 'failure',
      });
      expect(vi.mocked(core.info)).toHaveBeenCalledWith(
        'Notification delivered via telegram.',
      );
      expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
    });

    it('should send a message built from the workflow context', async () => {
      withInputs(telegramInputs);

      await run();

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const text = new URLSearchParams(init.body).get('text') ?? '';

      expect(text).toContain('CI failed on main (pixpilot/notify-action)');
      expect(text).toContain('Commit:     d5049a9c0ffe');
      expect(text).toContain(
        'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/1',
      );
    });

    it('should apply a custom title and message', async () => {
      withInputs({
        ...telegramInputs,
        title: 'Nightly broke',
        message: 'check the logs',
      });

      await run();

      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const text = new URLSearchParams(init.body).get('text') ?? '';

      expect(text).toContain('Nightly broke');
      expect(text).toContain('check the logs');
    });
  });

  describe('when a channel fails', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        text: async (): Promise<string> =>
          JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }),
      });
    });

    it('should warn and keep the step green by default', async () => {
      withInputs(telegramInputs);

      await run();

      expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
        'telegram notification failed: Telegram API rejected the request: Bad Request: chat not found',
      );
      expect(vi.mocked(core.setFailed)).not.toHaveBeenCalled();
      expect(outputs()).toEqual({
        notified: 'false',
        channels: '',
        'failed-channels': 'telegram',
        status: 'failure',
      });
    });

    it('should fail the step when fail-on-error is set', async () => {
      withInputs({ ...telegramInputs, 'fail-on-error': 'true' });

      await run();

      expect(vi.mocked(core.error)).toHaveBeenCalledWith(
        expect.stringContaining('telegram notification failed'),
      );
      expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
        'Failed to notify via: telegram.',
      );
    });

    it('should still publish the outputs when failing', async () => {
      withInputs({ ...telegramInputs, 'fail-on-error': 'true' });

      await run();

      expect(outputs()['failed-channels']).toBe('telegram');
    });
  });

  describe('when the inputs are invalid', () => {
    it('should fail with the validation message', async () => {
      withInputs({
        status: 'failure',
        'smtp-server': 'smtp.example.com',
        'email-to': 'team@example.com',
        'smtp-port': 'not-a-port',
      });

      await run();

      expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
        expect.stringContaining('`smtp-port` must be a port number'),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should fail with a stringified non-Error throw', async () => {
      vi.mocked(core.getInput).mockImplementation(() => {
        // eslint-disable-next-line no-throw-literal -- a non-Error throw is the case under test
        throw 'input backend exploded';
      });

      await run();

      expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith('input backend exploded');
    });

    it('should fail when the sender cannot be resolved', async () => {
      withInputs({
        status: 'failure',
        'smtp-server': 'smtp.example.com',
        'email-to': 'team@example.com',
      });

      await run();

      expect(vi.mocked(core.setFailed)).toHaveBeenCalledWith(
        expect.stringContaining('No sender'),
      );
    });
  });
});
