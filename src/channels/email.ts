import type { Transporter } from 'nodemailer';

import type { Channel, NotificationPayload } from '../types';

import nodemailer from 'nodemailer';

import { renderPlainTextBody } from '../payload';

export interface EmailAuth {
  user: string;
  pass: string;
}

export interface EmailConfig {
  to: string[];
  /** Fully resolved `From` header, for example `CI <ci@example.com>`. */
  from: string;
  host: string;
  port: number;
  /** Implicit TLS (port 465 style) rather than STARTTLS. */
  secure: boolean;
  /** Reject the connection when TLS cannot be negotiated. */
  requireTls: boolean;
  /**
   * Credentials, or absent for a relay that does not authenticate. Both halves
   * travel together because nodemailer refuses a user with an empty password.
   */
  auth?: EmailAuth;
}

export type TransportFactory = (config: EmailConfig) => Transporter;

/**
 * Resolves the `From` header. A bare display name such as `GitHub Actions` is
 * combined with the authenticated username, which is the address the provider
 * would rewrite the envelope to anyway.
 */
export function resolveFrom(from: string, username: string): string {
  const candidate = from.length > 0 ? from : username;

  if (candidate.length === 0) {
    throw new Error(
      'No sender. Set `email-from`, or `smtp-username` for it to fall back to.',
    );
  }

  const isAddress = candidate.includes('@');
  const hasAngleBrackets = candidate.includes('<') && candidate.includes('>');
  if (isAddress || hasAngleBrackets) return candidate;

  if (username.length === 0) {
    throw new Error(
      `\`email-from\` is "${candidate}", which is not an address, and \`smtp-username\` is empty.`,
    );
  }

  return `${candidate} <${username}>`;
}

/** Port conventionally reserved for SMTP over implicit TLS. */
const IMPLICIT_TLS_PORT = 465;

/**
 * Chooses implicit TLS versus STARTTLS. `auto` follows the convention that
 * port 465 is implicit TLS and everything else upgrades.
 */
export function resolveSecurity(
  smtpSecure: string,
  port: number,
): { secure: boolean; requireTls: boolean } {
  switch (smtpSecure.trim().toLowerCase()) {
    case '':
    case 'auto':
      return { secure: port === IMPLICIT_TLS_PORT, requireTls: true };
    case 'true':
    case 'tls':
    case 'ssl':
      return { secure: true, requireTls: true };
    case 'false':
    case 'starttls':
      return { secure: false, requireTls: true };
    case 'none':
    case 'plain':
      return { secure: false, requireTls: false };
    default:
      throw new Error(
        `Unknown \`smtp-secure\` value "${smtpSecure}". Use auto, true, false or none.`,
      );
  }
}

const defaultTransportFactory: TransportFactory = (config) =>
  nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ...(config.auth !== undefined ? { auth: config.auth } : {}),
  });

export class EmailChannel implements Channel {
  public readonly name = 'email';

  private readonly config: EmailConfig;
  private readonly createTransport: TransportFactory;

  public constructor(config: EmailConfig, createTransport?: TransportFactory) {
    this.config = config;
    this.createTransport = createTransport ?? defaultTransportFactory;
  }

  public async send(payload: NotificationPayload): Promise<void> {
    const transport = this.createTransport(this.config);

    try {
      await transport.sendMail({
        from: this.config.from,
        to: this.config.to.join(', '),
        subject: payload.title,
        text: renderPlainTextBody(payload),
      });
    } finally {
      transport.close();
    }
  }
}
