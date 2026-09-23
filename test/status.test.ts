import { describe, expect, it } from 'vitest';

import { describeStatus, normaliseStatus, parseList, shouldNotify } from '../src/status';

describe('parseList', () => {
  it('should split on commas', () => {
    expect(parseList('failure,cancelled')).toEqual(['failure', 'cancelled']);
  });

  it('should split on whitespace', () => {
    expect(parseList('failure cancelled')).toEqual(['failure', 'cancelled']);
  });

  it('should tolerate mixed separators and stray spacing', () => {
    expect(parseList('  failure ,, cancelled,  success  ')).toEqual([
      'failure',
      'cancelled',
      'success',
    ]);
  });

  it('should return an empty list for blank input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList('   ')).toEqual([]);
  });
});

describe('normaliseStatus', () => {
  it('should lower-case and strip whitespace', () => {
    expect(normaliseStatus(' Failure ')).toBe('failure');
    expect(normaliseStatus('CANCELLED')).toBe('cancelled');
  });

  it('should default to failure when empty', () => {
    expect(normaliseStatus('')).toBe('failure');
    expect(normaliseStatus('   ')).toBe('failure');
  });
});

describe('shouldNotify', () => {
  it('should match a listed status', () => {
    expect(shouldNotify('failure', ['failure', 'cancelled'])).toBe(true);
  });

  it('should not match an unlisted status', () => {
    expect(shouldNotify('success', ['failure', 'cancelled'])).toBe(false);
  });

  it('should match every status when the list contains any', () => {
    expect(shouldNotify('success', ['any'])).toBe(true);
    expect(shouldNotify('whatever', ['any'])).toBe(true);
  });

  it('should compare case-insensitively against the configured list', () => {
    expect(shouldNotify('failure', ['Failure'])).toBe(true);
    expect(shouldNotify('success', [' ANY '])).toBe(true);
  });

  it('should not match an empty list', () => {
    expect(shouldNotify('failure', [])).toBe(false);
  });
});

describe('describeStatus', () => {
  it('should describe the known statuses', () => {
    expect(describeStatus('failure')).toEqual({ verb: 'failed', emoji: '❌' });
    expect(describeStatus('cancelled')).toEqual({ verb: 'cancelled', emoji: '⚠️' });
    expect(describeStatus('success')).toEqual({ verb: 'succeeded', emoji: '✅' });
    expect(describeStatus('skipped')).toEqual({ verb: 'skipped', emoji: '⏭️' });
  });

  it('should fall back for an unrecognised status', () => {
    expect(describeStatus('neutral')).toEqual({
      verb: 'finished with status neutral',
      emoji: 'ℹ️',
    });
  });

  it('should not inherit from Object.prototype', () => {
    // A status such as `constructor` must not resolve to a prototype member.
    expect(describeStatus('constructor').verb).toBe('finished with status constructor');
  });
});
