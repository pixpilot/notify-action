import type { NotificationPayload } from './types';

import { describeStatus } from './status';

/** Length of the abbreviated commit sha shown in notifications. */
const SHORT_SHA_LENGTH = 12;
/** Spaces between the longest label and the value column. */
const LABEL_GUTTER = 2;

/**
 * The parts of the workflow run that end up in a notification. Read from the
 * environment the runner populates rather than from action inputs, so callers
 * do not have to thread `github.*` expressions through `with:`.
 */
export interface WorkflowContext {
  repository: string;
  workflow: string;
  job: string;
  refName: string;
  sha: string;
  actor: string;
  eventName: string;
  serverUrl: string;
  runId: string;
  runAttempt: string;
}

function readEnv(env: NodeJS.ProcessEnv, key: string, fallback = ''): string {
  const value = env[key];
  return value !== undefined && value.length > 0 ? value : fallback;
}

export function readWorkflowContext(env: NodeJS.ProcessEnv): WorkflowContext {
  return {
    repository: readEnv(env, 'GITHUB_REPOSITORY'),
    workflow: readEnv(env, 'GITHUB_WORKFLOW'),
    job: readEnv(env, 'GITHUB_JOB'),
    refName: readEnv(env, 'GITHUB_REF_NAME'),
    sha: readEnv(env, 'GITHUB_SHA'),
    actor: readEnv(env, 'GITHUB_ACTOR'),
    eventName: readEnv(env, 'GITHUB_EVENT_NAME'),
    serverUrl: readEnv(env, 'GITHUB_SERVER_URL', 'https://github.com'),
    runId: readEnv(env, 'GITHUB_RUN_ID'),
    runAttempt: readEnv(env, 'GITHUB_RUN_ATTEMPT', '1'),
  };
}

export function buildRunUrl(context: WorkflowContext): string {
  if (context.repository.length === 0 || context.runId.length === 0) return '';
  return `${context.serverUrl}/${context.repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}`;
}

export interface BuildPayloadOptions {
  status: string;
  context: WorkflowContext;
  /** Overrides the generated title. */
  title?: string;
  /** Extra text appended to the body. */
  message?: string;
}

/**
 * Builds the channel-agnostic payload. Fields with no value are dropped rather
 * than rendered empty, which keeps the output readable when the action runs
 * outside a normal workflow run.
 */
export function buildPayload(options: BuildPayloadOptions): NotificationPayload {
  const { status, context, title, message } = options;
  const { verb, emoji } = describeStatus(status);

  const generatedTitle = `${context.workflow} ${verb} on ${context.refName} (${context.repository})`;

  const candidateFields = [
    { label: 'Repository', value: context.repository },
    { label: 'Workflow', value: context.workflow },
    { label: 'Job', value: context.job },
    { label: 'Status', value: status },
    { label: 'Ref', value: context.refName },
    { label: 'Commit', value: context.sha.slice(0, SHORT_SHA_LENGTH) },
    {
      label: 'Trigger',
      value:
        context.eventName.length > 0 && context.actor.length > 0
          ? `${context.eventName} by ${context.actor}`
          : context.eventName,
    },
  ];

  return {
    status,
    emoji,
    title: title !== undefined && title.length > 0 ? title : generatedTitle,
    fields: candidateFields.filter((field) => field.value.length > 0),
    runUrl: buildRunUrl(context),
    ...(message !== undefined && message.length > 0 ? { message } : {}),
  };
}

/**
 * Renders the payload as aligned `label: value` lines. Shared by every
 * plain-text channel.
 */
export function renderPlainTextBody(payload: NotificationPayload): string {
  const fields = [...payload.fields];
  if (payload.runUrl.length > 0) {
    fields.push({ label: 'Run', value: payload.runUrl });
  }

  const width = fields.reduce(
    (longest, field) => Math.max(longest, field.label.length),
    0,
  );
  const lines = fields.map(
    (field) => `${`${field.label}:`.padEnd(width + LABEL_GUTTER)}${field.value}`,
  );

  const body = lines.join('\n');
  return payload.message !== undefined ? `${body}\n\n${payload.message}` : body;
}
