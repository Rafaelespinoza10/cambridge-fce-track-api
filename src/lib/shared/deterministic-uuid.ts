import { createHash } from 'crypto';

// Arbitrary fixed namespace for this app's deterministic (RFC 4122 v5-style)
// UUIDs — never changes, so the same input always maps to the same UUID.
const NAMESPACE = '6f5b1f3a-2c1e-4b8a-9d2a-8f7c6a1e0b3d';

/**
 * Deterministically maps an arbitrary string to a valid UUID (v5-style,
 * sha1-based per RFC 4122 §4.3) — for call sites that need a stable
 * "idempotency key" for a *compound* natural key (e.g. `${attemptId}:${sectionCode}`)
 * but must persist it into a column typed `uuid`, which a compound string
 * like that can never satisfy on its own. Same input always produces the
 * same UUID, so idempotent-replay logic keyed on it still works.
 */
export function deterministicUuidFrom(input: string): string {
  const hash = createHash('sha1').update(`${NAMESPACE}:${input}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}
