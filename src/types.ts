/**
 * A single labelled detail rendered in the notification body.
 */
export interface NotificationField {
  label: string;
  value: string;
}

/**
 * Channel-agnostic description of what happened. Channels receive this and
 * render it themselves, so adding a channel never means changing the payload.
 */
export interface NotificationPayload {
  /** Normalised status, for example `failure`. */
  status: string;
  /** Emoji summarising the status, for channels that can show one. */
  emoji: string;
  /** One-line summary, also used as the email subject. */
  title: string;
  /** Ordered details about the run. */
  fields: NotificationField[];
  /** Link to the workflow run. */
  runUrl: string;
  /** Link to the repository's Actions tab. */
  actionsUrl: string;
  /** Optional extra text supplied by the caller. */
  message?: string;
}

/**
 * A delivery target. `send` rejects when delivery fails; the dispatcher turns
 * that into a reported failure rather than letting it escape.
 */
export interface Channel {
  readonly name: string;
  send: (payload: NotificationPayload) => Promise<void>;
}

export interface ChannelFailure {
  channel: string;
  error: string;
}

export interface DeliveryReport {
  delivered: string[];
  failed: ChannelFailure[];
}
