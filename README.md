# Notify Action

Report a workflow's outcome to Telegram and/or email.

By default it only fires for `failure` and `cancelled`, so you can drop it into a
job with `if: always()` and it stays quiet while the pipeline is green.

A channel is used when its credentials are set and skipped when they are not, so
one step can cover both. **A notification that cannot be delivered does not fail
your build** — it logs a warning and carries on, unless you opt in with
`fail-on-error`. A broken alerting channel should not bury the failure it was
reporting.

## Usage

### As the last step of a job

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm test

      - uses: pixpilot/notify-action@v1
        if: always()
        with:
          status: ${{ job.status }}
          telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

`status` defaults to `failure`, so pass `${{ job.status }}` whenever you guard the
step with `if: always()`.

### As a job watching every other job

This also catches a job that died before it could reach its own notify step.

```yaml
jobs:
  build: ...
  test: ...

  notify:
    needs: [build, test]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: pixpilot/notify-action@v1
        with:
          status: ${{ contains(needs.*.result, 'failure') && 'failure' || 'success' }}
          email-to: team-alerts@example.com
          email-from: GitHub Actions
          smtp-server: smtp.gmail.com
          smtp-username: ${{ secrets.MAIL_USER }}
          smtp-password: ${{ secrets.MAIL_PASS }}
```

### As a reusable workflow

Wrap it once in a central `.github` repository so consumer repositories never
repeat the secrets:

```yaml
# .github/workflows/notify.yml
on:
  workflow_call:
    inputs:
      status:
        required: true
        type: string

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: pixpilot/notify-action@v1
        with:
          status: ${{ inputs.status }}
          telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

## Inputs

| Input           | Default              | Description                                                                                       |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------- |
| `status`        | `failure`            | Outcome to report. Pass `job.status` or a value derived from `needs.*.result`.                    |
| `notify-on`     | `failure, cancelled` | Statuses that trigger a notification, comma- or space-separated. `any` notifies on every outcome. |
| `title`         | generated            | Overrides the one-line title, which is also the email subject.                                    |
| `message`       | —                    | Extra text appended to the body.                                                                  |
| `fail-on-error` | `false`              | Fail the step when a channel cannot deliver.                                                      |

### Telegram

Skipped unless both `telegram-bot-token` and `telegram-chat-id` are set.

| Input                | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `telegram-bot-token` | Bot token from [@BotFather](https://t.me/botfather).          |
| `telegram-chat-id`   | `123456789`, `-1001234567890` for a group, or `@channelname`. |
| `telegram-thread-id` | `message_thread_id`, for groups with topics enabled.          |

To find the chat id: message the bot (or add it to the group as an admin), then
read it from `https://api.telegram.org/bot<token>/getUpdates`.

### Email

Skipped unless both `smtp-server` and `email-to` are set.

| Input           | Default  | Description                                                                                                  |
| --------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `smtp-server`   | —        | SMTP host, for example `smtp.gmail.com`.                                                                     |
| `email-to`      | —        | Recipients, comma- or space-separated.                                                                       |
| `email-from`    | username | `Name <addr@example.com>`, a bare address, or a display name alone (the username then supplies the address). |
| `smtp-port`     | `465`    | `465` means implicit TLS, anything else STARTTLS.                                                            |
| `smtp-username` | —        | Leave empty for a relay that does not authenticate.                                                          |
| `smtp-password` | —        | Required whenever `smtp-username` is set.                                                                    |
| `smtp-secure`   | `auto`   | `auto`, `true` (implicit TLS), `false` (STARTTLS) or `none` (unencrypted internal relay).                    |

**Gmail** rejects account passwords over SMTP. Enable 2FA, create an
[App Password](https://myaccount.google.com/apppasswords), and use port 465 with
the account address as `smtp-username`. Gmail rewrites the envelope sender to the
authenticated account whatever `email-from` says.

## Outputs

| Output            | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `notified`        | `true` when at least one channel accepted the notification.   |
| `channels`        | Comma-separated channels that delivered successfully.         |
| `failed-channels` | Comma-separated channels that were configured but failed.     |
| `status`          | The normalised status that was evaluated against `notify-on`. |

## Development

```sh
pnpm install
pnpm test       # unit tests, plus integration tests against a local SMTP/HTTP server
pnpm check:all  # format, lint, typecheck, test
pnpm build      # bundle to dist/, which is what the action actually runs
```

`dist/` is committed and is what consumers execute, so rebuild it whenever `src/`
changes.

Adding a channel means one module under `src/channels/` implementing the
`Channel` interface, and one branch in `createChannels`.

## License

[MIT](LICENSE)
