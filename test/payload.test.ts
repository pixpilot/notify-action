import type { WorkflowContext } from '../src/payload';

import { describe, expect, it } from 'vitest';

import {
  buildActionsUrl,
  buildPayload,
  buildRunUrl,
  readWorkflowContext,
  renderPlainTextBody,
} from '../src/payload';

const context: WorkflowContext = {
  repository: 'pixpilot/notify-action',
  workflow: 'CI',
  job: 'build',
  refName: 'main',
  sha: 'd5049a9c0ffee1234567890abcdef',
  actor: 'mdoaie',
  eventName: 'push',
  serverUrl: 'https://github.com',
  runId: '42',
  runAttempt: '2',
};

describe('readWorkflowContext', () => {
  it('should read the runner-provided environment', () => {
    const result = readWorkflowContext({
      GITHUB_REPOSITORY: 'pixpilot/notify-action',
      GITHUB_WORKFLOW: 'CI',
      GITHUB_JOB: 'build',
      GITHUB_REF_NAME: 'main',
      GITHUB_SHA: 'abc123',
      GITHUB_ACTOR: 'mdoaie',
      GITHUB_EVENT_NAME: 'push',
      GITHUB_SERVER_URL: 'https://ghe.example.com',
      GITHUB_RUN_ID: '7',
      GITHUB_RUN_ATTEMPT: '3',
    });

    expect(result).toEqual({
      repository: 'pixpilot/notify-action',
      workflow: 'CI',
      job: 'build',
      refName: 'main',
      sha: 'abc123',
      actor: 'mdoaie',
      eventName: 'push',
      serverUrl: 'https://ghe.example.com',
      runId: '7',
      runAttempt: '3',
    });
  });

  it('should default the server url and run attempt when absent', () => {
    const result = readWorkflowContext({});

    expect(result.serverUrl).toBe('https://github.com');
    expect(result.runAttempt).toBe('1');
    expect(result.repository).toBe('');
  });

  it('should treat an empty variable as absent', () => {
    const result = readWorkflowContext({ GITHUB_SERVER_URL: '' });

    expect(result.serverUrl).toBe('https://github.com');
  });
});

describe('buildRunUrl', () => {
  it('should build a link to the run attempt', () => {
    expect(buildRunUrl(context)).toBe(
      'https://github.com/pixpilot/notify-action/actions/runs/42/attempts/2',
    );
  });

  it('should honour a GitHub Enterprise server url', () => {
    expect(buildRunUrl({ ...context, serverUrl: 'https://ghe.example.com' })).toBe(
      'https://ghe.example.com/pixpilot/notify-action/actions/runs/42/attempts/2',
    );
  });

  it('should return an empty string when there is no run to link to', () => {
    expect(buildRunUrl({ ...context, runId: '' })).toBe('');
    expect(buildRunUrl({ ...context, repository: '' })).toBe('');
  });
});

describe('buildActionsUrl', () => {
  it('should link to the repository actions tab', () => {
    expect(buildActionsUrl(context)).toBe(
      'https://github.com/pixpilot/notify-action/actions',
    );
  });

  it('should honour a GitHub Enterprise server url', () => {
    expect(buildActionsUrl({ ...context, serverUrl: 'https://ghe.example.com' })).toBe(
      'https://ghe.example.com/pixpilot/notify-action/actions',
    );
  });

  it('should return an empty string when there is no repository', () => {
    expect(buildActionsUrl({ ...context, repository: '' })).toBe('');
  });
});

describe('buildPayload', () => {
  it('should generate a title from the context', () => {
    const payload = buildPayload({ status: 'failure', context });

    expect(payload.title).toBe('CI failed on main (pixpilot/notify-action)');
    expect(payload.emoji).toBe('❌');
    expect(payload.status).toBe('failure');
  });

  it('should prefer an explicit title', () => {
    const payload = buildPayload({ status: 'failure', context, title: 'Nightly broke' });

    expect(payload.title).toBe('Nightly broke');
  });

  it('should ignore an empty title override', () => {
    const payload = buildPayload({ status: 'failure', context, title: '' });

    expect(payload.title).toBe('CI failed on main (pixpilot/notify-action)');
  });

  it('should shorten the commit sha', () => {
    const payload = buildPayload({ status: 'failure', context });
    const commit = payload.fields.find((field) => field.label === 'Commit');

    expect(commit?.value).toBe('d5049a9c0ffe');
  });

  it('should combine the event and actor into one trigger field', () => {
    const payload = buildPayload({ status: 'failure', context });
    const trigger = payload.fields.find((field) => field.label === 'Trigger');

    expect(trigger?.value).toBe('push by mdoaie');
  });

  it('should drop fields that have no value', () => {
    const payload = buildPayload({
      status: 'failure',
      context: { ...context, job: '', sha: '', actor: '', eventName: '' },
    });
    const labels = payload.fields.map((field) => field.label);

    expect(labels).not.toContain('Job');
    expect(labels).not.toContain('Commit');
    expect(labels).not.toContain('Trigger');
    expect(labels).toContain('Repository');
  });

  it('should include the extra message only when one is given', () => {
    expect(buildPayload({ status: 'failure', context }).message).toBeUndefined();
    expect(
      buildPayload({ status: 'failure', context, message: '' }).message,
    ).toBeUndefined();
    expect(
      buildPayload({ status: 'failure', context, message: 'see logs' }).message,
    ).toBe('see logs');
  });
});

describe('renderPlainTextBody', () => {
  it('should align labels and append the run link', () => {
    const body = renderPlainTextBody(buildPayload({ status: 'failure', context }));

    expect(body).toBe(
      [
        'Repository: pixpilot/notify-action',
        'Workflow:   CI',
        'Job:        build',
        'Status:     failure',
        'Ref:        main',
        'Commit:     d5049a9c0ffe',
        'Trigger:    push by mdoaie',
        'Run:        https://github.com/pixpilot/notify-action/actions/runs/42/attempts/2',
      ].join('\n'),
    );
  });

  it('should append the extra message after a blank line', () => {
    const body = renderPlainTextBody(
      buildPayload({ status: 'failure', context, message: 'Deploy step exited 1' }),
    );

    expect(body.endsWith('\n\nDeploy step exited 1')).toBe(true);
  });

  it('should omit the run line when there is no run url', () => {
    const body = renderPlainTextBody(
      buildPayload({ status: 'failure', context: { ...context, runId: '' } }),
    );

    expect(body).not.toContain('Run:');
  });
});
