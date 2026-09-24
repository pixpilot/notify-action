import { describe, expect, it } from 'vitest';

import { readInputs } from '../src/inputs';

/**
 * Builds a reader over a plain map, standing in for `core.getInput`, which
 * returns an empty string for any input that was not supplied.
 */
function reader(values: Record<string, string> = {}): (name: string) => string {
  return (name) => values[name] ?? '';
}

const telegramInputs = {
  'telegram-bot-token': 'BOT:secret',
  'telegram-chat-id': '-100123',
};

const emailInputs = {
  'smtp-server': 'smtp.example.com',
  'smtp-port': '465',
  'email-to': 'team@example.com',
  'email-from': 'ci@example.com',
};

describe('readInputs', () => {
  describe('defaults', () => {
    it('should default notify-on to any', () => {
      expect(readInputs(reader()).notifyOn).toEqual(['any']);
    });

    it('should keep an explicit notify-on list', () => {
      expect(readInputs(reader({ 'notify-on': 'success, any' })).notifyOn).toEqual([
        'success',
        'any',
      ]);
    });

    it('should default fail-on-error to false', () => {
      expect(readInputs(reader()).failOnError).toBe(false);
    });

    it('should parse fail-on-error case-insensitively', () => {
      expect(readInputs(reader({ 'fail-on-error': 'TRUE' })).failOnError).toBe(true);
      expect(readInputs(reader({ 'fail-on-error': ' true ' })).failOnError).toBe(true);
      expect(readInputs(reader({ 'fail-on-error': 'yes' })).failOnError).toBe(false);
    });

    it('should pass the status through untouched for later normalisation', () => {
      expect(readInputs(reader({ status: ' Failure ' })).status).toBe(' Failure ');
    });
  });

  describe('telegram configuration', () => {
    it('should be absent when no telegram inputs are set', () => {
      expect(readInputs(reader()).telegram).toBeUndefined();
    });

    it('should be absent when only one of token and chat id is set', () => {
      expect(
        readInputs(reader({ 'telegram-bot-token': 'BOT:secret' })).telegram,
      ).toBeUndefined();
      expect(
        readInputs(reader({ 'telegram-chat-id': '-100123' })).telegram,
      ).toBeUndefined();
    });

    it('should be present when both are set', () => {
      expect(readInputs(reader(telegramInputs)).telegram).toEqual({
        botToken: 'BOT:secret',
        chatId: '-100123',
      });
    });

    it('should include the thread id only when supplied', () => {
      expect(
        readInputs(reader({ ...telegramInputs, 'telegram-thread-id': '7' })).telegram
          ?.threadId,
      ).toBe('7');
    });
  });

  describe('email configuration', () => {
    it('should be absent when no email inputs are set', () => {
      expect(readInputs(reader()).email).toBeUndefined();
    });

    it('should be absent without a host or without recipients', () => {
      expect(
        readInputs(reader({ ...emailInputs, 'smtp-server': '' })).email,
      ).toBeUndefined();
      expect(
        readInputs(reader({ ...emailInputs, 'email-to': '' })).email,
      ).toBeUndefined();
    });

    it('should split recipients on commas and whitespace', () => {
      const inputs = readInputs(
        reader({
          ...emailInputs,
          'email-to': 'a@example.com, b@example.com c@example.com',
        }),
      );

      expect(inputs.email?.to).toEqual([
        'a@example.com',
        'b@example.com',
        'c@example.com',
      ]);
    });

    it('should resolve implicit tls from the port', () => {
      expect(readInputs(reader(emailInputs)).email).toMatchObject({
        secure: true,
        requireTls: true,
        port: 465,
      });
      expect(
        readInputs(reader({ ...emailInputs, 'smtp-port': '587' })).email,
      ).toMatchObject({ secure: false, requireTls: true, port: 587 });
    });

    it('should resolve a display-name sender against the username', () => {
      const inputs = readInputs(
        reader({
          ...emailInputs,
          'email-from': 'GitHub Actions',
          'smtp-username': 'ci@example.com',
          'smtp-password': 'pw',
        }),
      );

      expect(inputs.email?.from).toBe('GitHub Actions <ci@example.com>');
    });

    it('should omit credentials for a relay that does not authenticate', () => {
      expect(readInputs(reader(emailInputs)).email?.auth).toBeUndefined();
    });

    it('should carry credentials when a username and password are set', () => {
      const authenticated = readInputs(
        reader({
          ...emailInputs,
          'smtp-username': 'ci@example.com',
          'smtp-password': 'pw',
        }),
      );

      expect(authenticated.email?.auth).toEqual({ user: 'ci@example.com', pass: 'pw' });
    });

    it('should reject a username with a missing password', () => {
      // The likeliest cause is a secret that was never set, which nodemailer
      // would otherwise report as `Missing credentials for "PLAIN"`.
      expect(() =>
        readInputs(reader({ ...emailInputs, 'smtp-username': 'ci@example.com' })),
      ).toThrow('`smtp-username` is set but `smtp-password` is empty');
    });

    it('should reject a port that is not a number', () => {
      expect(() => readInputs(reader({ ...emailInputs, 'smtp-port': 'abc' }))).toThrow(
        '`smtp-port` must be a port number',
      );
    });

    it('should reject a port outside the valid range', () => {
      expect(() => readInputs(reader({ ...emailInputs, 'smtp-port': '0' }))).toThrow(
        '`smtp-port` must be a port number',
      );
      expect(() => readInputs(reader({ ...emailInputs, 'smtp-port': '70000' }))).toThrow(
        '`smtp-port` must be a port number',
      );
    });

    it('should reject an unusable sender', () => {
      expect(() =>
        readInputs(reader({ ...emailInputs, 'email-from': '', 'smtp-username': '' })),
      ).toThrow('No sender');
    });
  });

  it('should configure both channels at once', () => {
    const inputs = readInputs(reader({ ...telegramInputs, ...emailInputs }));

    expect(inputs.telegram).toBeDefined();
    expect(inputs.email).toBeDefined();
  });
});

describe('readInputs smtp port fallback', () => {
  it('should fall back to 465 when the port input is empty', () => {
    // An input wired to an unset `${{ vars.* }}` arrives as an empty string and
    // overrides the default declared in action.yml.
    const inputs = readInputs(reader({ ...emailInputs, 'smtp-port': '' }));

    expect(inputs.email?.port).toBe(465);
    expect(inputs.email?.secure).toBe(true);
  });

  it('should fall back when the port input is only whitespace', () => {
    expect(readInputs(reader({ ...emailInputs, 'smtp-port': '   ' })).email?.port).toBe(
      465,
    );
  });
});
