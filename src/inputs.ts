import type { EmailConfig } from './channels/email';
import type { TelegramConfig } from './channels/telegram';

import { resolveFrom, resolveSecurity } from './channels/email';
import { parseList } from './status';

/**
 * Reads one action input. Injected so the parsing logic can be tested without
 * populating `INPUT_*` environment variables.
 */
export type InputReader = (name: string) => string;

export interface ActionInputs {
  status: string;
  notifyOn: string[];
  title: string;
  message: string;
  failOnError: boolean;
  telegram?: TelegramConfig;
  email?: EmailConfig;
}

const DEFAULT_SMTP_PORT = 465;
const MAX_PORT = 65535;

/**
 * An empty value falls back to the default rather than erroring: an input wired
 * to an unset variable, such as `${{ vars.SMTP_PORT }}`, arrives as an empty
 * string and overrides the default declared in `action.yml`.
 */
function parsePort(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_SMTP_PORT;

  const port = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    throw new Error(`\`smtp-port\` must be a port number, got "${raw}".`);
  }
  return port;
}

/**
 * A channel is configured when the inputs that identify its destination are
 * present, so leaving a channel's inputs unset silently skips it.
 */
function readTelegramConfig(get: InputReader): TelegramConfig | undefined {
  const botToken = get('telegram-bot-token');
  const chatId = get('telegram-chat-id');
  if (botToken.length === 0 || chatId.length === 0) return undefined;

  const threadId = get('telegram-thread-id');
  return {
    botToken,
    chatId,
    ...(threadId.length > 0 ? { threadId } : {}),
  };
}

function readEmailConfig(get: InputReader): EmailConfig | undefined {
  const host = get('smtp-server');
  const to = parseList(get('email-to'));
  if (host.length === 0 || to.length === 0) return undefined;

  const port = parsePort(get('smtp-port'));
  const { secure, requireTls } = resolveSecurity(get('smtp-secure'), port);
  const username = get('smtp-username');
  const password = get('smtp-password');

  // Caught here rather than left to nodemailer, which reports the same
  // situation as `Missing credentials for "PLAIN"`. An unset secret is the
  // likeliest cause, so the message says which input to look at.
  if (username.length > 0 && password.length === 0) {
    throw new Error(
      '`smtp-username` is set but `smtp-password` is empty - check that the password secret exists. Leave `smtp-username` empty for a relay that does not authenticate.',
    );
  }

  return {
    to,
    from: resolveFrom(get('email-from'), username),
    host,
    port,
    secure,
    requireTls,
    ...(username.length > 0 ? { auth: { user: username, pass: password } } : {}),
  };
}

export function readInputs(get: InputReader): ActionInputs {
  const notifyOn = parseList(get('notify-on'));

  return {
    status: get('status'),
    notifyOn: notifyOn.length > 0 ? notifyOn : ['failure', 'cancelled'],
    title: get('title'),
    message: get('message'),
    failOnError: get('fail-on-error').trim().toLowerCase() === 'true',
    telegram: readTelegramConfig(get),
    email: readEmailConfig(get),
  };
}
