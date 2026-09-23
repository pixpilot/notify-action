import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { NotificationPayload } from '../../src/types';

import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { TelegramChannel } from '../../src/channels/telegram';

interface ReceivedRequest {
  url: string;
  method: string;
  contentType: string | undefined;
  params: URLSearchParams;
}

interface TestServer {
  origin: string;
  received: ReceivedRequest[];
  close: () => Promise<void>;
}

type Responder = (request: ReceivedRequest, response: ServerResponse) => void;

/**
 * Starts a stand-in for the Telegram Bot API so the request is built, sent and
 * parsed over a real socket rather than against a mocked `fetch`.
 */
async function startServer(respond: Responder): Promise<TestServer> {
  const received: ReceivedRequest[] = [];

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const entry: ReceivedRequest = {
        url: request.url ?? '',
        method: request.method ?? '',
        contentType: request.headers['content-type'],
        params: new URLSearchParams(Buffer.concat(chunks).toString('utf8')),
      };
      received.push(entry);
      respond(entry, response);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    received,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error !== undefined && error !== null ? reject(error) : resolve(),
        );
      }),
  };
}

const payload: NotificationPayload = {
  status: 'failure',
  emoji: '❌',
  title: 'CI failed on main (pixpilot/notify-action)',
  fields: [{ label: 'Repository', value: 'pixpilot/notify-action' }],
  runUrl: 'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/1',
};

/**
 * Routes the channel's request at the local server. The channel builds the
 * api.telegram.org URL itself, so the host is swapped on the way out while the
 * rest of the request - method, headers, encoded body - is left untouched.
 */
function channelPointedAt(
  origin: string,
  config: { botToken?: string; chatId?: string; threadId?: string } = {},
): TelegramChannel {
  const { botToken = 'BOT:secret', chatId = '-100123', threadId } = config;

  return new TelegramChannel(
    { botToken, chatId, ...(threadId !== undefined ? { threadId } : {}) },
    async (url, init) => fetch(url.replace('https://api.telegram.org', origin), init),
  );
}

describe('telegramChannel over a real HTTP server', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  function ok(_request: ReceivedRequest, response: ServerResponse): void {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }

  it('should post a form-encoded sendMessage request', async () => {
    server = await startServer(ok);

    await channelPointedAt(server.origin).send(payload);

    const request = server.received[0];
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('/botBOT:secret/sendMessage');
    expect(request?.contentType).toBe('application/x-www-form-urlencoded');
  });

  it('should round-trip the message text through url encoding', async () => {
    server = await startServer(ok);

    await channelPointedAt(server.origin).send({
      ...payload,
      message: 'a & b <c> 100% ✅\nsecond line',
    });

    const text = server.received[0]?.params.get('text') ?? '';
    expect(text).toContain('a &amp; b &lt;c&gt; 100% ✅');
    expect(text).toContain('second line');
    expect(text).toContain('<pre>');
  });

  it('should send the chat id and thread id', async () => {
    server = await startServer(ok);

    await channelPointedAt(server.origin, { threadId: '7' }).send(payload);

    expect(server.received[0]?.params.get('chat_id')).toBe('-100123');
    expect(server.received[0]?.params.get('message_thread_id')).toBe('7');
  });

  it('should reject when the api reports an error', async () => {
    server = await startServer((_request, response) => {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }),
      );
    });

    await expect(channelPointedAt(server.origin).send(payload)).rejects.toThrow(
      'Bad Request: chat not found',
    );
  });

  it('should reject on an html error page from a proxy', async () => {
    server = await startServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>502 Bad Gateway</html>');
    });

    await expect(channelPointedAt(server.origin).send(payload)).rejects.toThrow(
      'non-JSON response',
    );
  });

  it('should keep the bot token out of the error when the server echoes it', async () => {
    server = await startServer((request, response) => {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end(`no route for ${request.url}`);
    });

    const error = await channelPointedAt(server.origin)
      .send(payload)
      .catch((caught: unknown) => caught);

    expect(String(error)).toContain('***');
    expect(String(error)).not.toContain('BOT:secret');
  });
});
