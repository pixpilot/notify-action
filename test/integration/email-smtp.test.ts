import type { ParsedMail } from 'mailparser';

import type { AddressInfo } from 'node:net';

import type { EmailConfig } from '../../src/channels/email';
import type { NotificationPayload } from '../../src/types';

import { simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it } from 'vitest';

import { EmailChannel } from '../../src/channels/email';

interface ReceivedMail {
  parsed: ParsedMail;
  recipients: string[];
  username?: string;
}

interface TestServer {
  port: number;
  received: ReceivedMail[];
  close: () => Promise<void>;
}

/**
 * Starts a real SMTP server on a free port. This exercises nodemailer and the
 * wire format for real, which mocking `sendMail` cannot.
 */
async function startServer(
  options: { credentials?: { user: string; pass: string } } = {},
): Promise<TestServer> {
  const received: ReceivedMail[] = [];

  const server = new SMTPServer({
    // The test server speaks plaintext, so authentication has to be permitted
    // over an unencrypted connection and STARTTLS must not be advertised.
    disabledCommands: ['STARTTLS'],
    authOptional: options.credentials === undefined,
    allowInsecureAuth: true,
    onAuth(auth, _session, callback) {
      const expected = options.credentials;
      if (expected === undefined) {
        callback(null, { user: auth.username });
        return;
      }
      if (auth.username === expected.user && auth.password === expected.pass) {
        callback(null, { user: auth.username });
        return;
      }
      callback(new Error('Invalid username or password'));
    },
    onData(stream, session, callback) {
      simpleParser(stream)
        .then((parsed) => {
          received.push({
            parsed,
            recipients: session.envelope.rcptTo.map((rcpt) => rcpt.address),
            username: session.user ?? undefined,
          });
          callback();
        })
        .catch((error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)));
        });
    },
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.server.address() as AddressInfo;

  return {
    port,
    received,
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(resolve);
      }),
  };
}

const payload: NotificationPayload = {
  status: 'failure',
  emoji: '❌',
  title: 'CI failed on main (pixpilot/notify-action)',
  fields: [
    { label: 'Repository', value: 'pixpilot/notify-action' },
    { label: 'Status', value: 'failure' },
  ],
  runUrl: 'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/1',
  actionsUrl: 'https://github.com/pixpilot/notify-action/actions',
  message: 'Deploy step exited 1',
};

function configFor(port: number, overrides: Partial<EmailConfig> = {}): EmailConfig {
  return {
    to: ['team@example.com'],
    from: 'CI <ci@example.com>',
    host: '127.0.0.1',
    port,
    secure: false,
    requireTls: false,
    ...overrides,
  };
}

describe('emailChannel over a real SMTP server', () => {
  let server: TestServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('should deliver a message that parses as valid mail', async () => {
    server = await startServer();

    await new EmailChannel(configFor(server.port)).send(payload);

    expect(server.received).toHaveLength(1);
    const mail = server.received[0]?.parsed;

    expect(mail?.subject).toBe('CI failed on main (pixpilot/notify-action)');
    // mailparser re-serialises the display name with quotes, so assert on the
    // parsed address rather than the formatted header.
    expect(mail?.from?.value[0]).toMatchObject({
      name: 'CI',
      address: 'ci@example.com',
    });
    expect(mail?.text).toContain('Repository: pixpilot/notify-action');
    expect(mail?.text).toContain(payload.runUrl);
    expect(mail?.text).toContain('Deploy step exited 1');
  });

  it('should address every recipient in the envelope', async () => {
    server = await startServer();

    await new EmailChannel(
      configFor(server.port, { to: ['team@example.com', 'oncall@example.com'] }),
    ).send(payload);

    expect(server.received[0]?.recipients).toEqual([
      'team@example.com',
      'oncall@example.com',
    ]);
  });

  it('should authenticate when credentials are configured', async () => {
    server = await startServer({
      credentials: { user: 'ci@example.com', pass: 'app-pw' },
    });

    await new EmailChannel(
      configFor(server.port, { auth: { user: 'ci@example.com', pass: 'app-pw' } }),
    ).send(payload);

    expect(server.received).toHaveLength(1);
    expect(server.received[0]?.username).toBe('ci@example.com');
  });

  it('should reject when the credentials are refused', async () => {
    server = await startServer({
      credentials: { user: 'ci@example.com', pass: 'app-pw' },
    });

    await expect(
      new EmailChannel(
        configFor(server.port, { auth: { user: 'ci@example.com', pass: 'wrong' } }),
      ).send(payload),
    ).rejects.toThrow(/Invalid username or password/u);

    expect(server.received).toHaveLength(0);
  });

  it('should survive a subject and body that need encoding', async () => {
    server = await startServer();

    await new EmailChannel(configFor(server.port)).send({
      ...payload,
      title: 'Déploiement annulé — прод',
      message: 'Uñicode ✅ line\nsecond line',
    });

    const mail = server.received[0]?.parsed;
    expect(mail?.subject).toBe('Déploiement annulé — прод');
    expect(mail?.text).toContain('Uñicode ✅ line');
    expect(mail?.text).toContain('second line');
  });

  it('should reject when nothing is listening', async () => {
    server = await startServer();
    const { port } = server;
    await server.close();
    server = undefined;

    await expect(new EmailChannel(configFor(port)).send(payload)).rejects.toThrow(
      /ECONNREFUSED/u,
    );
  });

  it('should reject when TLS is required but unavailable', async () => {
    server = await startServer();

    await expect(
      new EmailChannel(configFor(server.port, { requireTls: true })).send(payload),
    ).rejects.toThrow();
    expect(server.received).toHaveLength(0);
  });
});
