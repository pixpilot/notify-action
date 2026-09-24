import type { FetchLike } from '../../src/channels/telegram';
import type { NotificationPayload } from '../../src/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildInlineKeyboard,
  escapeHtml,
  renderTelegramMessage,
  TelegramChannel,
} from '../../src/channels/telegram';

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    status: 'failure',
    emoji: '❌',
    title: 'CI failed on main (pixpilot/notify-action)',
    fields: [
      { label: 'Repository', value: 'pixpilot/notify-action' },
      { label: 'Status', value: 'failure' },
    ],
    runUrl: 'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/1',
    actionsUrl: 'https://github.com/pixpilot/notify-action/actions',
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async (): Promise<string> => JSON.stringify(body),
  };
}

describe('escapeHtml', () => {
  it('should escape the characters Telegram reads as markup', () => {
    expect(escapeHtml('<b> & </b>')).toBe('&lt;b&gt; &amp; &lt;/b&gt;');
  });

  it('should not double-escape the entities it introduces', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('should leave ordinary text untouched', () => {
    expect(escapeHtml('all good')).toBe('all good');
  });
});

describe('renderTelegramMessage', () => {
  it('should render a bold heading and a preformatted body', () => {
    const message = renderTelegramMessage(makePayload());

    expect(
      message.startsWith('❌ <b>CI failed on main (pixpilot/notify-action)</b>'),
    ).toBe(true);
    expect(message).toContain('<pre>Repository: pixpilot/notify-action');
    expect(message.endsWith('</pre>')).toBe(true);
  });

  it('should escape markup coming from the title and body', () => {
    const message = renderTelegramMessage(
      makePayload({ title: '<script>', message: 'a & b' }),
    );

    expect(message).toContain('&lt;script&gt;');
    expect(message).toContain('a &amp; b');
    expect(message).not.toContain('<script>');
  });

  it('should truncate an oversized message to the Telegram limit', () => {
    const message = renderTelegramMessage(makePayload({ message: 'x'.repeat(8000) }));

    expect(message.length).toBe(4096);
    expect(message).toContain('…(truncated)');
  });

  it('should keep the markup well formed when truncating', () => {
    const message = renderTelegramMessage(makePayload({ message: 'x'.repeat(8000) }));

    expect(message.endsWith('</pre>')).toBe(true);
    expect(message.split('<pre>')).toHaveLength(2);
  });

  it('should not truncate a message that fits', () => {
    const message = renderTelegramMessage(makePayload());

    expect(message).not.toContain('…(truncated)');
  });
});

describe('buildInlineKeyboard', () => {
  it('should link to the run and the repository actions in one row', () => {
    expect(buildInlineKeyboard(makePayload())).toEqual({
      inline_keyboard: [
        [
          {
            text: '🔎 View run',
            url: 'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/1',
          },
          {
            text: '⚙️ Repo actions',
            url: 'https://github.com/pixpilot/notify-action/actions',
          },
        ],
      ],
    });
  });

  it('should drop a button that has no url', () => {
    const keyboard = buildInlineKeyboard(makePayload({ runUrl: '' }));

    expect(keyboard?.inline_keyboard).toEqual([
      [
        {
          text: '⚙️ Repo actions',
          url: 'https://github.com/pixpilot/notify-action/actions',
        },
      ],
    ]);
  });

  it('should return undefined when there is nothing to link to', () => {
    expect(
      buildInlineKeyboard(makePayload({ runUrl: '', actionsUrl: '' })),
    ).toBeUndefined();
  });
});

describe('telegramChannel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
  });

  function channel(config: Partial<{ threadId: string }> = {}): TelegramChannel {
    return new TelegramChannel(
      { botToken: 'BOT:secret', chatId: '-100123', ...config },
      fetchMock as unknown as FetchLike,
    );
  }

  it('should be named telegram', () => {
    expect(channel().name).toBe('telegram');
  });

  it('should post to the sendMessage endpoint for the configured bot', async () => {
    await channel().send(makePayload());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.telegram.org/botBOT:secret/sendMessage',
    );
  });

  it('should send the rendered message as form-encoded parameters', async () => {
    const payload = makePayload();
    await channel().send(payload);

    const init = fetchMock.mock.calls[0]?.[1] as { method: string; body: string };
    const body = new URLSearchParams(init.body);

    expect(init.method).toBe('POST');
    expect(body.get('chat_id')).toBe('-100123');
    expect(body.get('parse_mode')).toBe('HTML');
    expect(body.get('disable_web_page_preview')).toBe('true');
    expect(body.get('text')).toBe(renderTelegramMessage(payload));
  });

  it('should attach the link buttons as reply markup', async () => {
    const payload = makePayload();
    await channel().send(payload);

    const body = new URLSearchParams(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );

    expect(JSON.parse(body.get('reply_markup') ?? '')).toEqual(
      buildInlineKeyboard(payload),
    );
  });

  it('should omit the reply markup when there are no links', async () => {
    await channel().send(makePayload({ runUrl: '', actionsUrl: '' }));

    const body = new URLSearchParams(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );

    expect(body.has('reply_markup')).toBe(false);
  });

  it('should include the thread id only when configured', async () => {
    await channel().send(makePayload());
    const withoutThread = new URLSearchParams(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );
    expect(withoutThread.has('message_thread_id')).toBe(false);

    fetchMock.mockClear();
    await channel({ threadId: '7' }).send(makePayload());
    const withThread = new URLSearchParams(
      (fetchMock.mock.calls[0]?.[1] as { body: string }).body,
    );
    expect(withThread.get('message_thread_id')).toBe('7');
  });

  it('should resolve when the api reports success', async () => {
    await expect(channel().send(makePayload())).resolves.toBeUndefined();
  });

  it('should reject with the api description when the request is refused', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ok: false, description: 'Bad Request: chat not found' }),
    );

    await expect(channel().send(makePayload())).rejects.toThrow(
      'Telegram API rejected the request: Bad Request: chat not found',
    );
  });

  it('should reject on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, description: 'Unauthorized' },
        { ok: false, status: 401 },
      ),
    );

    await expect(channel().send(makePayload())).rejects.toThrow(
      'Telegram API responded 401',
    );
  });

  it('should reject when the response is not json', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async (): Promise<string> => '<html>gateway timeout</html>',
    });

    await expect(channel().send(makePayload())).rejects.toThrow(
      'Telegram API returned a non-JSON response',
    );
  });

  it('should describe an empty error body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async (): Promise<string> => '',
    });

    await expect(channel().send(makePayload())).rejects.toThrow(
      'Telegram API responded 502: (empty response)',
    );
  });

  it('should fall back to the raw body when the api gives no description', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }));

    await expect(channel().send(makePayload())).rejects.toThrow(
      'Telegram API rejected the request: {"ok":false}',
    );
  });

  it('should redact the bot token from error messages', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async (): Promise<string> =>
        'Not Found: https://api.telegram.org/botBOT:secret/sendMessage',
    });

    const error = await channel()
      .send(makePayload())
      .catch((caught: unknown) => caught);

    expect(String(error)).not.toContain('BOT:secret');
    expect(String(error)).toContain('***');
  });

  it('should propagate a transport-level failure', async () => {
    fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(channel().send(makePayload())).rejects.toThrow('getaddrinfo ENOTFOUND');
  });
});
