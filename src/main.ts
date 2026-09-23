import process from 'node:process';

import * as core from '@actions/core';

import { createChannels, dispatch } from './dispatch';
import { readInputs } from './inputs';
import { buildPayload, readWorkflowContext } from './payload';
import { normaliseStatus, shouldNotify } from './status';

interface Outputs {
  notified: boolean;
  channels: string[];
  failed: string[];
  status: string;
}

function setOutputs(outputs: Outputs): void {
  core.setOutput('notified', String(outputs.notified));
  core.setOutput('channels', outputs.channels.join(','));
  core.setOutput('failed-channels', outputs.failed.join(','));
  core.setOutput('status', outputs.status);
}

/**
 * The main function for the action.
 *
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const inputs = readInputs((name) => core.getInput(name));
    const status = normaliseStatus(inputs.status);

    if (!shouldNotify(status, inputs.notifyOn)) {
      core.info(
        `Status "${status}" is not in "${inputs.notifyOn.join(', ')}", nothing to notify.`,
      );
      setOutputs({ notified: false, channels: [], failed: [], status });
      return;
    }

    const channels = createChannels(inputs);
    if (channels.length === 0) {
      core.warning(
        'No notification channel is configured. Set `telegram-bot-token` and `telegram-chat-id`, and/or `smtp-server` and `email-to`.',
      );
      setOutputs({ notified: false, channels: [], failed: [], status });
      return;
    }

    const payload = buildPayload({
      status,
      context: readWorkflowContext(process.env),
      title: inputs.title,
      message: inputs.message,
    });

    const report = await dispatch(channels, payload);

    for (const channel of report.delivered) {
      core.info(`Notification delivered via ${channel}.`);
    }

    for (const failure of report.failed) {
      // Only a warning unless the caller opted in: the run being reported on
      // matters more than the reporting, so a broken channel should not bury it.
      const detail = `${failure.channel} notification failed: ${failure.error}`;
      if (inputs.failOnError) core.error(detail);
      else core.warning(detail);
    }

    setOutputs({
      notified: report.delivered.length > 0,
      channels: report.delivered,
      failed: report.failed.map((failure) => failure.channel),
      status,
    });

    if (inputs.failOnError && report.failed.length > 0) {
      const names = report.failed.map((failure) => failure.channel).join(', ');
      core.setFailed(`Failed to notify via: ${names}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
  }
}
