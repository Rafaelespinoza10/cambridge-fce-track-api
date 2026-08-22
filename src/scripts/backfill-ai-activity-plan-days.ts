import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../config/database';
import { resolvePlanDayIdForDate } from '../services/planning/resolve-plan-day-for-date';
import { resolveUserLocalDayKey } from '../services/planning/resolve-user-local-day';
import { PlannedActivity } from '../models/PlannedActivity';

/**
 * One-off backfill for the plan-day timezone fix: moves AI-generated
 * activities onto the day the user actually finished them, in the user's own
 * timezone.
 *
 * Two changes landed together, and this repairs the rows both left behind:
 *   - Practice and Writing used to place an activity on submittedAt's UTC
 *     calendar day. West of Greenwich that is tomorrow for anything finished
 *     in the evening.
 *   - Daily Session used to place it on session_date, the day the lesson was
 *     generated FOR, which differs when a lesson is submitted after midnight.
 *
 * SKIPS ANY ACTIVITY WHOSE DAY THE USER CHOSE EXPLICITLY. If the linked
 * practice_attempt / writing_submission carries a plan_day_id, that day was
 * picked deliberately at start time via the Plan screen, and the buggy code
 * path was never reached — moving it would destroy a real decision. Daily
 * Session has no such capture, so every Daily Session row is eligible.
 *
 * Safe to re-run: a row already on its correct day is counted and skipped.
 * Only plan_day_id and scheduled_at change; completed_at, scores and links
 * are untouched.
 *
 * Usage: npm run db:backfill-ai-activity-plan-days -- --dry-run
 *        npm run db:backfill-ai-activity-plan-days
 *        STAGE=prod npm run db:backfill-ai-activity-plan-days -- --dry-run
 */

const DRY_RUN = process.argv.includes('--dry-run');

interface CandidateRow {
  activityId: string;
  title: string;
  userId: string;
  completedAt: Date;
  currentDate: string;
  capturedPlanDayId: string | null;
}

interface BackfillCounts {
  moved: number;
  alreadyCorrect: number;
  skippedUserChosen: number;
}

/**
 * Raw query rather than the entity API: planned_activities has no user_id
 * column (ownership runs through plan_day -> weekly_plan), and the captured
 * plan day lives on whichever of two sibling tables the activity links to.
 * One join does what three round-trips per row otherwise would.
 */
async function loadCandidates(ds: DataSource): Promise<CandidateRow[]> {
  return ds.query(`
    SELECT pa.id                                     AS "activityId",
           pa.title                                  AS "title",
           wp.user_id                                AS "userId",
           pa.completed_at                           AS "completedAt",
           pd.date::text                             AS "currentDate",
           COALESCE(att.plan_day_id, ws.plan_day_id) AS "capturedPlanDayId"
    FROM planned_activities pa
    JOIN plan_days pd    ON pd.id = pa.plan_day_id
    JOIN weekly_plans wp ON wp.id = pd.weekly_plan_id
    LEFT JOIN practice_attempts   att ON att.id = pa.practice_attempt_id
    LEFT JOIN writing_submissions ws  ON ws.id  = pa.writing_submission_id
    WHERE pa.source = 'ai_generated'
      AND pa.deleted_at IS NULL
      AND pa.completed_at IS NOT NULL
      AND (
        pa.practice_attempt_id IS NOT NULL OR
        pa.writing_submission_id IS NOT NULL OR
        pa.daily_session_submission_id IS NOT NULL
      )
    ORDER BY pa.completed_at DESC
  `);
}

async function backfillPlanDays(ds: DataSource): Promise<BackfillCounts> {
  const counts: BackfillCounts = { moved: 0, alreadyCorrect: 0, skippedUserChosen: 0 };

  const candidates = await loadCandidates(ds);
  console.log(`[backfill] ${candidates.length} AI-generated completed activities found`);

  for (const row of candidates) {
    if (row.capturedPlanDayId !== null) {
      counts.skippedUserChosen++;
      continue;
    }

    // Same resolution the live submit paths now perform, so this script and
    // the services can never disagree about where an activity belongs.
    const targetDateKey = await resolveUserLocalDayKey(ds.manager, row.userId, row.completedAt);

    if (row.currentDate === targetDateKey) {
      counts.alreadyCorrect++;
      continue;
    }

    if (DRY_RUN) {
      console.log(
        `[backfill]   [dry-run] would move "${row.title}" from ${row.currentDate} to ${targetDateKey}`,
      );
      counts.moved++;
      continue;
    }

    await ds.transaction(async (manager) => {
      const targetPlanDayId = await resolvePlanDayIdForDate(manager, row.userId, targetDateKey);
      await manager.getRepository(PlannedActivity).update(
        { id: row.activityId },
        {
          plan_day_id: targetPlanDayId,
          // Kept in step with completed_at, exactly as
          // createAiLinkedPlannedActivity sets the two together.
          scheduled_at: row.completedAt,
        },
      );
    });
    console.log(
      `[backfill]   moved "${row.title}" from ${row.currentDate} to ${targetDateKey}`,
    );
    counts.moved++;
  }

  return counts;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }

  console.log(`[backfill] Stage DB: ${process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);
  if (DRY_RUN) console.log('[backfill] DRY RUN — no writes will be made\n');

  await AppDataSource.initialize();

  try {
    const counts = await backfillPlanDays(AppDataSource);

    console.log('\n[backfill] Summary');
    console.log(`  moved:              ${counts.moved}`);
    console.log(`  already correct:    ${counts.alreadyCorrect}`);
    console.log(`  user-chosen (kept): ${counts.skippedUserChosen}`);
    console.log('[backfill] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] Failed:', err);
  process.exit(1);
});
