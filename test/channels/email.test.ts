import type { Transporter } from 'nodemailer';

import type { EmailConfig, TransportFactory } from '../../src/channels/email';
import type { NotificationPayload } from '../../src/types';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailChannel, resolveFrom, resolveSecurity } from '../../src/channels/email';

const payload: NotificationPayload = {
  status: 'failure',
  emoji: '❌',
  title: 'CI failed on main (pixpilot/notify-action)',
  fields: [{ label: 'Repository', value: 'pixpilot/notify-action' }],
  runUrl: 'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/1',
  actionsUrl: 'https://github.com/pixpilot/notify-action/actions',
};

const config: EmailConfig = {
  to: ['team@example.com', 'oncall@example.com'],
  from: 'CI <ci@example.com>',
  host: 'smtp.example.com',
  port: 465,
  secure: true,
  requireTls: true,
};

describe('resolveFrom', () => {
  it('should keep a bare address', () => {
    expect(resolveFrom('ci@example.com', 'user@example.com')).toBe('ci@example.com');
  });

  it('should keep a name and address pair', () => {
    expect(resolveFrom('CI <ci@example.com>', '')).toBe('CI <ci@example.com>');
  });

  it('should combine a display name with the smtp username', () => {
    expect(resolveFrom('GitHub Actions', 'ci@example.com')).toBe(
      'GitHub Actions <ci@example.com>',
    );
  });

  it('should fall back to the smtp username when no sender is given', () => {
    expect(resolveFrom('', 'ci@example.com')).toBe('ci@example.com');
  });

  it('should reject when there is no sender at all', () => {
    expect(() => resolveFrom('', '')).toThrow('No sender');
  });

  it('should reject a display name when there is no username to borrow', () => {
    expect(() => resolveFrom('GitHub Actions', '')).toThrow('is not an address');
  });
});

describe('resolveSecurity', () => {
  it('should use implicit tls on port 465 when auto', () => {
    expect(resolveSecurity('auto', 465)).toEqual({ secure: true, requireTls: true });
  });

  it('should use starttls on other ports when auto', () => {
    expect(resolveSecurity('auto', 587)).toEqual({ secure: false, requireTls: true });
    expect(resolveSecurity('', 25)).toEqual({ secure: false, requireTls: true });
  });

  it('should force implicit tls', () => {
    for (const value of ['true', 'tls', 'ssl', 'TRUE']) {
      expect(resolveSecurity(value, 587)).toEqual({ secure: true, requireTls: true });
    }
  });

  it('should force starttls', () => {
    for (const value of ['false', 'starttls']) {
      expect(resolveSecurity(value, 465)).toEqual({ secure: false, requireTls: true });
    }
  });

  it('should allow an unencrypted relay', () => {
    expect(resolveSecurity('none', 25)).toEqual({ secure: false, requireTls: false });
    expect(resolveSecurity('plain', 25)).toEqual({ secure: false, requireTls: false });
  });

  it('should reject an unrecognised value', () => {
    expect(() => resolveSecurity('maybe', 465)).toThrow('Unknown `smtp-secure` value');
  });
});

describe('emailChannel', () => {
  let sendMail: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let createTransport: TransportFactory;

  beforeEach(() => {
    sendMail = vi.fn().mockResolvedValue({ messageId: '<1@example.com>' });
    close = vi.fn();
    createTransport = vi.fn(() => ({ sendMail, close }) as unknown as Transporter);
  });

  it('should be named email', () => {
    expect(new EmailChannel(config, createTransport).name).toBe('email');
  });

  it('should send the payload as a plain-text message', async () => {
    await new EmailChannel(config, createTransport).send(payload);

    expect(sendMail).toHaveBeenCalledOnce();
    const sent = sendMail.mock.calls[0]?.[0] as Record<string, string>;

    expect(sent.from).toBe('CI <ci@example.com>');
    expect(sent.to).toBe('team@example.com, oncall@example.com');
    expect(sent.subject).toBe('CI failed on main (pixpilot/notify-action)');
    expect(sent.text).toContain('Repository: pixpilot/notify-action');
    expect(sent.text).toContain(payload.runUrl);
  });

  it('should build the transport from the resolved configuration', async () => {
    await new EmailChannel(config, createTransport).send(payload);

    expect(createTransport).toHaveBeenCalledWith(config);
  });

  it('should close the transport after sending', async () => {
    await new EmailChannel(config, createTransport).send(payload);

    expect(close).toHaveBeenCalledOnce();
  });

  it('should close the transport even when sending fails', async () => {
    sendMail.mockRejectedValue(new Error('535 authentication failed'));

    await expect(new EmailChannel(config, createTransport).send(payload)).rejects.toThrow(
      '535 authentication failed',
    );
    expect(close).toHaveBeenCalledOnce();
  });
});
