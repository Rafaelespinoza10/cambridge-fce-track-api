import type { DataSource, EntityManager } from 'typeorm';
import type { MistakeErrorType, MistakeErrorSubtype } from '@models/enums';

/**
 * The two aggregate reads mastery is computed from. Both are grouped inside
 * Postgres and always scoped to one `userId` — the Weaknesses screen must
 * never pull a user's history into memory to add it up, and there is no
 * method here that can read another user's rows.
 *
 * Nothing is persisted for mastery: these queries reconstruct it from the
 * Mistake Bank (failures) and from Practice My Mistakes answers (remediation),
 * which is why this PR adds no table and no column.
 */

/** Optional narrowing applied to the failure side; `status` can only be filtered after scoring. */
export interface WeaknessQueryFilters {
  skill?: string;
  examCode?: string;
  paperCode?: string;
  partCode?: string;
  errorType?: MistakeErrorType;
  errorSubtype?: MistakeErrorSubtype;
}

/** One row per pattern the user has ever failed. */
export interface PatternFailureRow {
  skill: string;
  examCode: string;
  paperCode: string;
  partCode: string;
  errorType: MistakeErrorType;
  errorSubtype: MistakeErrorSubtype | null;
  timesWrong: number;
  conceptCount: number;
  firstSeenAt: Date;
  lastWrongAt: Date;
  wrongsInRecentWindow: number;
}

/** One row per (pattern, user-local day) of Practice My Mistakes answers. */
export interface PatternRemediationDayRow {
  partCode: string;
  errorType: string;
  errorSubtype: string | null;
  day: string;
  attempts: number;
  correct: number;
  /** Distinct lexical families answered correctly that day, lowercased. */
  families: string[];
}

/** node-postgres hands integers back as numbers, but a COUNT/SUM can arrive as a string. */
interface RawFailureRow extends Omit<
  PatternFailureRow,
  'timesWrong' | 'conceptCount' | 'wrongsInRecentWindow'
> {
  timesWrong: number | string;
  conceptCount: number | string;
  wrongsInRecentWindow: number | string | null;
}

interface RawRemediationRow extends Omit<PatternRemediationDayRow, 'attempts' | 'correct'> {
  attempts: number | string;
  correct: number | string;
}

function toInt(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

class MistakeMasteryRepository {
  constructor(private readonly source: DataSource | EntityManager) {}

  /**
   * Failure side: every pattern the user has recorded mistakes for, with its
   * totals and how many of those failures landed inside `recentWindowStart`
   * (the MASTERED relapse gate). The LATERAL keeps the recent count from
   * fanning out the SUM over occurrences.
   */
  async findPatternFailures(
    userId: string,
    recentWindowStart: Date,
    filters: WeaknessQueryFilters = {},
  ): Promise<PatternFailureRow[]> {
    const params: unknown[] = [userId, recentWindowStart];
    const conditions: string[] = ['c.user_id = $1'];

    const addFilter = (sql: string, value: unknown): void => {
      params.push(value);
      conditions.push(sql.replace('$?', `$${params.length}`));
    };
    if (filters.skill !== undefined) addFilter('c.skill_slug = $?', filters.skill);
    if (filters.examCode !== undefined) addFilter('c.exam_code = $?', filters.examCode);
    if (filters.paperCode !== undefined) addFilter('c.paper_code = $?', filters.paperCode);
    if (filters.partCode !== undefined) addFilter('c.part_code = $?', filters.partCode);
    if (filters.errorType !== undefined) {
      addFilter('c.error_type = $?::mistake_error_type_enum', filters.errorType);
    }
    if (filters.errorSubtype !== undefined) {
      addFilter('c.error_subtype = $?::mistake_error_subtype_enum', filters.errorSubtype);
    }

    const rows: RawFailureRow[] = await this.source.query(
      `SELECT c.skill_slug AS "skill",
              c.exam_code AS "examCode",
              c.paper_code AS "paperCode",
              c.part_code AS "partCode",
              c.error_type AS "errorType",
              c.error_subtype AS "errorSubtype",
              SUM(c.times_wrong) AS "timesWrong",
              COUNT(*) AS "conceptCount",
              MIN(c.first_seen_at) AS "firstSeenAt",
              MAX(c.last_wrong_at) AS "lastWrongAt",
              SUM(recent.cnt) AS "wrongsInRecentWindow"
         FROM mistake_concepts c
         LEFT JOIN LATERAL (
                SELECT COUNT(*) AS cnt
                  FROM mistake_occurrences o
                 WHERE o.concept_id = c.id
                   AND o.occurred_at >= $2::timestamptz
              ) recent ON TRUE
        WHERE ${conditions.join(' AND ')}
        GROUP BY c.skill_slug, c.exam_code, c.paper_code, c.part_code,
                 c.error_type, c.error_subtype`,
      params,
    );

    return rows.map((row) => ({
      ...row,
      timesWrong: toInt(row.timesWrong),
      conceptCount: toInt(row.conceptCount),
      wrongsInRecentWindow: toInt(row.wrongsInRecentWindow),
    }));
  }

  /**
   * Remediation side: Practice My Mistakes answers, bucketed per pattern and
   * per the user's OWN calendar day (`timeZone`) — bucketing by the UTC day
   * would split an evening session from its own morning west of Greenwich,
   * inflating "distinct practice days".
   *
   * The lexical family of an answer is the generated item's own base word
   * when the generator could extract one (`itemBaseWord`), falling back to
   * the answer the student actually produced. Items generated before that
   * metadata existed therefore still count as attempts, and only their
   * family attribution is approximate.
   */
  async findRemediationDays(userId: string, timeZone: string): Promise<PatternRemediationDayRow[]> {
    const rows: RawRemediationRow[] = await this.source.query(
      `SELECT pe.part_code AS "partCode",
              pi.metadata->>'targetErrorType' AS "errorType",
              pi.metadata->>'targetErrorSubtype' AS "errorSubtype",
              TO_CHAR(pa.created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS "day",
              COUNT(*) AS "attempts",
              COUNT(*) FILTER (WHERE pa.is_correct) AS "correct",
              COALESCE(
                ARRAY_AGG(DISTINCT LOWER(COALESCE(pi.metadata->>'itemBaseWord', pa.normalized_answer)))
                  FILTER (
                    WHERE pa.is_correct
                      AND COALESCE(pi.metadata->>'itemBaseWord', pa.normalized_answer) IS NOT NULL
                  ),
                '{}'
              ) AS "families"
         FROM practice_answers pa
         JOIN practice_items pi ON pi.id = pa.item_id
         JOIN practice_exercises pe ON pe.id = pa.exercise_id
        WHERE pa.user_id = $1
          AND pi.metadata->>'generationSource' = 'mistake_practice'
          AND pi.metadata->>'targetErrorType' IS NOT NULL
        GROUP BY pe.part_code,
                 pi.metadata->>'targetErrorType',
                 pi.metadata->>'targetErrorSubtype',
                 TO_CHAR(pa.created_at AT TIME ZONE $2, 'YYYY-MM-DD')`,
      [userId, timeZone],
    );

    return rows.map((row) => ({
      ...row,
      attempts: toInt(row.attempts),
      correct: toInt(row.correct),
      families: row.families ?? [],
    }));
  }
}

export { MistakeMasteryRepository, toInt };
