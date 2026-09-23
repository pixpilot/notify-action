/**
 * Splits a comma- or whitespace-separated input into trimmed, non-empty parts.
 */
export function parseList(raw: string): string[] {
  return raw
    .split(/[,\s]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Lower-cases and strips whitespace so `' Failure '` and `failure` match.
 */
export function normaliseStatus(raw: string): string {
  const normalised = raw.toLowerCase().replace(/\s+/gu, '');
  return normalised.length > 0 ? normalised : 'failure';
}

/**
 * Whether `status` is one of the statuses the caller asked to be told about.
 * The literal `any` matches every status.
 */
export function shouldNotify(status: string, notifyOn: readonly string[]): boolean {
  return notifyOn.some((wanted) => {
    const candidate = normaliseStatus(wanted);
    return candidate === 'any' || candidate === status;
  });
}

export interface StatusDescription {
  /** Past-tense verb used in the generated title. */
  verb: string;
  emoji: string;
}

// A Map rather than an object literal: an object would resolve a status such
// as `constructor` through the prototype chain instead of falling back.
const STATUS_DESCRIPTIONS = new Map<string, StatusDescription>([
  ['failure', { verb: 'failed', emoji: '❌' }],
  ['cancelled', { verb: 'cancelled', emoji: '⚠️' }],
  ['success', { verb: 'succeeded', emoji: '✅' }],
  ['skipped', { verb: 'skipped', emoji: '⏭️' }],
]);

export function describeStatus(status: string): StatusDescription {
  return (
    STATUS_DESCRIPTIONS.get(status) ?? {
      verb: `finished with status ${status}`,
      emoji: 'ℹ️',
    }
  );
}
