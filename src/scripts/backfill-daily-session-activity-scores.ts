import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../config/database';
import { createAiLinkedActivityScore } from '../services/planning/create-ai-linked-activity-score';
import { ActivityScore } from '../models/ActivityScore';
import { DailySessionSubmission } from '../models/DailySessionSubmission';
import { PlannedActivity } from '../models/PlannedActivity';
import { DailySessionSubmissionStatus } from '../models/enums';

/**
 * One-off backfill for Daily Sessions graded BEFORE the score row shipped
 * (see create-ai-linked-activity-score.ts). Those submissions produced a
 * planned_activities row — enough for Home's week view and the "weekly
 * activities" counter — but no activity_scores row, which is what every
 * score-based Progress metric actually reads (UNIFIED_SCORES_CTE in
 * progress.repository.ts). So they are invisible to study minutes, weekly
 * average, strongest/weakest skill, the study streak, monthly progress by
 * skill, recent activities, score evolution, and Reading Part 5 in
 * exam-parts. This creates the missing rows.
 *
 * Comprehension only, matching the live path exactly: the activity is tagged
 * reading/reading-part-5, and comprehension is the purely-Reading,
 * deterministically-graded half of the session.
 *
 * Safe to re-run: a submission is skipped when its planned activity already
 * has an activity_scores row. Also skips submissions whose planned activity
 * was soft-deleted — if the user removed that plan entry on purpose, don't
 * resurrect it into their metrics (same rule as
 * backfill-ai-planned-activities.ts).
 *
 * Usage: npm run db:backfill-daily-session-scores
 *        npm run db:backfill-daily-session-scores -- --dry-run
 *        STAGE=prod npm run db:backfill-daily-session-scores -- --dry-run
 */

const DRY_RUN = process.argv.includes('--dry-run');

interface BackfillCounts {
  created: number;
  alreadyScored: number;
  noActivity: number;
  activityDeleted: number;
  skippedIncomplete: number;
}

/** numeric(5,2) arrives from pg as a string. */
function toPercentage(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function backfillDailySessionScores(ds: DataSource): Promise<BackfillCounts> {
  const counts: BackfillCounts = {
    created: 0,
    alreadyScored: 0,
    noActivity: 0,
    activityDeleted: 0,
    skippedIncomplete: 0,
  };

  const submissionRepo = ds.getRepository(DailySessionSubmission);
  const plannedActivityRepo = ds.getRepository(PlannedActivity);
  const scoreRepo = ds.getRepository(ActivityScore);

  const submissions = await submissionRepo.find({
    where: { status: DailySessionSubmissionStatus.GRADED },
  });
  console.log(`[backfill] Daily Session: ${submissions.length} graded submissions found`);

  for (const submission of submissions) {
    // withDeleted so a soft-deleted activity is recognized rather than
    // treated as "no activity" and warned about misleadingly.
    const activity = await plannedActivityRepo.findOne({
      where: { daily_session_submission_id: submission.id },
      withDeleted: true,
    });

    if (activity === null) {
      console.warn(
        `[backfill]   skipping submission ${submission.id}: no planned_activity is linked to it`,
      );
      counts.noActivity++;
      continue;
    }

    if (activity.deleted_at !== null) {
      counts.activityDeleted++;
      continue;
    }

    const existingScore = await scoreRepo.findOne({
      where: { planned_activity_id: activity.id },
      withDeleted: true,
    });
    if (existingScore !== null) {
      counts.alreadyScored++;
      continue;
    }

    const percentage = toPercentage(submission.comprehension_percentage);
    if (
      percentage === null ||
      submission.comprehension_correct_count === null ||
      submission.comprehension_total_count === null ||
      submission.submitted_at === null
    ) {
      // Unreachable against the real schema — a graded row missing these
      // would violate chk_daily_session_submissions_in_progress_has_no_result
      // — but fail loudly rather than write a broken score.
      console.warn(
        `[backfill]   skipping submission ${submission.id}: graded but missing comprehension result fields`,
      );
      counts.skippedIncomplete++;
      continue;
    }

    // Mirrors the live path: duration_seconds -> minutes, floor of 1, so
    // Progress "study minutes" never reads this session as zero.
    const timeSpentMinutes =
      submission.duration_seconds === null
        ? null
        : Math.max(1, Math.round(submission.duration_seconds / 60));

    if (DRY_RUN) {
      console.log(
        `[backfill]   [dry-run] would score submission ${submission.id} -> activity ${activity.id} ` +
          `(${submission.comprehension_correct_count}/${submission.comprehension_total_count}, ${percentage}%)`,
      );
      counts.created++;
      continue;
    }

    await ds.transaction(async (manager) => {
      await createAiLinkedActivityScore(manager, {
        userId: submission.user_id,
        plannedActivityId: activity.id,
        skillId: activity.skill_id,
        examSectionId: activity.exam_section_id,
        percentage,
        correctAnswers: submission.comprehension_correct_count as number,
        totalQuestions: submission.comprehension_total_count as number,
        timeSpentMinutes,
        attemptedAt: submission.submitted_at as Date,
      });
    });
    counts.created++;
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
    const counts = await backfillDailySessionScores(AppDataSource);

    console.log('\n[backfill] Summary');
    console.log(`  scored:            ${counts.created}`);
    console.log(`  already scored:    ${counts.alreadyScored}`);
    console.log(`  activity deleted:  ${counts.activityDeleted}`);
    console.log(`  no activity:       ${counts.noActivity}`);
    console.log(`  incomplete:        ${counts.skippedIncomplete}`);
    console.log('[backfill] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] Failed:', err);
  process.exit(1);
});
