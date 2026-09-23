import type { ActionInputs } from './inputs';
import type { Channel, DeliveryReport, NotificationPayload } from './types';

import { EmailChannel } from './channels/email';
import { TelegramChannel } from './channels/telegram';

/**
 * Builds the channels the inputs configured. Adding a channel means adding one
 * branch here and one module under `channels/`.
 */
export function createChannels(inputs: ActionInputs): Channel[] {
  const channels: Channel[] = [];
  if (inputs.telegram !== undefined) channels.push(new TelegramChannel(inputs.telegram));
  if (inputs.email !== undefined) channels.push(new EmailChannel(inputs.email));
  return channels;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends to every channel and reports what happened. One channel failing never
 * prevents another from being tried, and this never rejects: a broken
 * notification channel should not hide the failure it was reporting.
 */
export async function dispatch(
  channels: readonly Channel[],
  payload: NotificationPayload,
): Promise<DeliveryReport> {
  // Each task resolves with its own outcome rather than rejecting, which keeps
  // the channel paired with its result without indexing back into the array.
  const outcomes = await Promise.all(
    channels.map(async (channel) => {
      try {
        await channel.send(payload);
        return { channel: channel.name, error: undefined };
      } catch (error) {
        return { channel: channel.name, error: toMessage(error) };
      }
    }),
  );

  const report: DeliveryReport = { delivered: [], failed: [] };

  for (const outcome of outcomes) {
    if (outcome.error === undefined) report.delivered.push(outcome.channel);
    else report.failed.push({ channel: outcome.channel, error: outcome.error });
  }

  return report;
}
