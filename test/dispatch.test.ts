import type { ActionInputs } from '../src/inputs';
import type { Channel, NotificationPayload } from '../src/types';

import { describe, expect, it, vi } from 'vitest';

import { createChannels, dispatch } from '../src/dispatch';

const payload: NotificationPayload = {
  status: 'failure',
  emoji: '❌',
  title: 'CI failed',
  fields: [],
  runUrl: '',
  actionsUrl: '',
};

function baseInputs(overrides: Partial<ActionInputs> = {}): ActionInputs {
  return {
    status: 'failure',
    notifyOn: ['failure'],
    title: '',
    message: '',
    failOnError: false,
    ...overrides,
  };
}

function stubChannel(name: string, behaviour: () => Promise<void>): Channel {
  return { name, send: vi.fn(behaviour) };
}

describe('createChannels', () => {
  it('should create nothing when no channel is configured', () => {
    expect(createChannels(baseInputs())).toEqual([]);
  });

  it('should create only the telegram channel', () => {
    const channels = createChannels(
      baseInputs({ telegram: { botToken: 'BOT:secret', chatId: '1' } }),
    );

    expect(channels.map((channel) => channel.name)).toEqual(['telegram']);
  });

  it('should create only the email channel', () => {
    const channels = createChannels(
      baseInputs({
        email: {
          to: ['a@example.com'],
          from: 'ci@example.com',
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          requireTls: true,
        },
      }),
    );

    expect(channels.map((channel) => channel.name)).toEqual(['email']);
  });

  it('should create both channels when both are configured', () => {
    const channels = createChannels(
      baseInputs({
        telegram: { botToken: 'BOT:secret', chatId: '1' },
        email: {
          to: ['a@example.com'],
          from: 'ci@example.com',
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          requireTls: true,
        },
      }),
    );

    expect(channels.map((channel) => channel.name)).toEqual(['telegram', 'email']);
  });
});

describe('dispatch', () => {
  it('should report every channel that delivered', async () => {
    const channels = [
      stubChannel('telegram', async () => undefined),
      stubChannel('email', async () => undefined),
    ];

    const report = await dispatch(channels, payload);

    expect(report).toEqual({ delivered: ['telegram', 'email'], failed: [] });
  });

  it('should pass the payload to each channel', async () => {
    const channel = stubChannel('telegram', async () => undefined);

    await dispatch([channel], payload);

    expect(channel.send).toHaveBeenCalledWith(payload);
  });

  it('should report a failing channel without affecting the others', async () => {
    const channels = [
      stubChannel('telegram', async () => {
        throw new Error('chat not found');
      }),
      stubChannel('email', async () => undefined),
    ];

    const report = await dispatch(channels, payload);

    expect(report.delivered).toEqual(['email']);
    expect(report.failed).toEqual([{ channel: 'telegram', error: 'chat not found' }]);
  });

  it('should never reject, even when every channel fails', async () => {
    const channels = [
      stubChannel('telegram', async () => {
        throw new Error('chat not found');
      }),
      stubChannel('email', async () => {
        throw new Error('535 authentication failed');
      }),
    ];

    const report = await dispatch(channels, payload);

    expect(report.delivered).toEqual([]);
    expect(report.failed).toEqual([
      { channel: 'telegram', error: 'chat not found' },
      { channel: 'email', error: '535 authentication failed' },
    ]);
  });

  it('should describe a non-Error rejection', async () => {
    const channels = [
      stubChannel('telegram', async () => {
        // eslint-disable-next-line no-throw-literal -- a non-Error rejection is the case under test
        throw 'socket hang up';
      }),
    ];

    const report = await dispatch(channels, payload);

    expect(report.failed).toEqual([{ channel: 'telegram', error: 'socket hang up' }]);
  });

  it('should send to all channels concurrently', async () => {
    const started: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const channels = [
      stubChannel('telegram', async () => {
        started.push('telegram');
        await firstBlocked;
      }),
      stubChannel('email', async () => {
        started.push('email');
      }),
    ];

    const pending = dispatch(channels, payload);
    await Promise.resolve();
    releaseFirst();
    await pending;

    // The second channel started before the first resolved.
    expect(started).toEqual(['telegram', 'email']);
  });

  it('should return an empty report for no channels', async () => {
    expect(await dispatch([], payload)).toEqual({ delivered: [], failed: [] });
  });
});
