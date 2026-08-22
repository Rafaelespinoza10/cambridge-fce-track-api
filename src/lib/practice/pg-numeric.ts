/**
 * node-postgres does not parse every SQL numeric type into a JS `number`:
 * `integer`/`int4` columns come back as `number`, but `numeric`/`decimal`
 * columns (e.g. `practice_attempts.percentage`) always come back as
 * `string` to avoid silent precision loss — and a raw query-builder result
 * (`getRawMany`/`getRawOne`) never guarantees either behavior implicitly,
 * regardless of the Postgres column type. Every numeric-ish value crossing
 * a raw Postgres boundary should be converted explicitly through these
 * helpers rather than trusted to already be a `number`. `null` always
 * stays `null` — never coerced to `0` or `NaN`.
 */

export function toNullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

export function toRequiredNumber(value: number | string): number {
  return Number(value);
}
