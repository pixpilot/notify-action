import type { Channel, NotificationPayload } from '../types';

import { renderPlainTextBody } from '../payload';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  /** `message_thread_id`, for groups with topics enabled. */
  threadId?: string;
}

/** Telegram rejects a message longer than 4096 characters. */
const MAX_MESSAGE_LENGTH = 4096;
const TRUNCATION_NOTICE = '\n…(truncated)';

/**
 * Escapes the three characters Telegram's HTML parse mode treats as markup.
 * The ampersand has to be replaced first or it would double-escape the
 * entities introduced by the other two.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
}

/**
 * Renders the payload as Telegram-flavoured HTML, truncating the body rather
 * than the closing tag so the markup stays well-formed.
 */
export function renderTelegramMessage(payload: NotificationPayload): string {
  const heading = `${payload.emoji} <b>${escapeHtml(payload.title)}</b>`;
  const body = escapeHtml(renderPlainTextBody(payload));

  const wrap = (content: string): string => `${heading}\n\n<pre>${content}</pre>`;

  const full = wrap(body);
  if (full.length <= MAX_MESSAGE_LENGTH) return full;

  const overflow = full.length - MAX_MESSAGE_LENGTH + TRUNCATION_NOTICE.length;
  return wrap(body.slice(0, Math.max(0, body.length - overflow)) + TRUNCATION_NOTICE);
}

export interface InlineKeyboardButton {
  text: string;
  url: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

/**
 * Builds a single row of link buttons under the message. Buttons without a
 * URL are dropped, and `undefined` is returned when none remain, because
 * Telegram rejects an empty keyboard.
 */
export function buildInlineKeyboard(
  payload: NotificationPayload,
): InlineKeyboardMarkup | undefined {
  const buttons = [
    { text: '🔎 View run', url: payload.runUrl },
    { text: '⚙️ Repo actions', url: payload.actionsUrl },
  ].filter((button) => button.url.length > 0);

  return buttons.length > 0 ? { inline_keyboard: [buttons] } : undefined;
}

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
}

export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class TelegramChannel implements Channel {
  public readonly name = 'telegram';

  private readonly config: TelegramConfig;
  private readonly fetchImpl: FetchLike;

  public constructor(config: TelegramConfig, fetchImpl?: FetchLike) {
    this.config = config;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  public async send(payload: NotificationPayload): Promise<void> {
    const body = new URLSearchParams({
      chat_id: this.config.chatId,
      text: renderTelegramMessage(payload),
      parse_mode: 'HTML',
      disable_web_page_preview: 'true',
    });

    if (this.config.threadId !== undefined && this.config.threadId.length > 0) {
      body.set('message_thread_id', this.config.threadId);
    }

    const keyboard = buildInlineKeyboard(payload);
    if (keyboard !== undefined) {
      body.set('reply_markup', JSON.stringify(keyboard));
    }

    const response = await this.fetchImpl(
      `https://api.telegram.org/bot${this.config.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      },
    );

    const raw = await response.text();

    if (!response.ok) {
      throw new Error(
        `Telegram API responded ${response.status}: ${this.redact(describeFailure(raw))}`,
      );
    }

    let parsed: TelegramApiResponse;
    try {
      parsed = JSON.parse(raw) as TelegramApiResponse;
    } catch {
      throw new Error(`Telegram API returned a non-JSON response: ${this.redact(raw)}`);
    }

    if (parsed.ok !== true) {
      throw new Error(
        `Telegram API rejected the request: ${this.redact(describeFailure(raw, parsed.description))}`,
      );
    }
  }

  /**
   * The bot token sits in the request URL, so it can surface in an error
   * string. Actions masks registered secrets, but this keeps it out of the log
   * even when the token was not registered as one.
   */
  private redact(value: string): string {
    return value.split(this.config.botToken).join('***');
  }
}

function describeFailure(raw: string, description?: string): string {
  if (description !== undefined && description.length > 0) return description;
  return raw.length > 0 ? raw : '(empty response)';
}
