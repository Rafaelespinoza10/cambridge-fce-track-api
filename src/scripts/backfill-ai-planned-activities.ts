import 'reflect-metadata';
import type { DataSource } from 'typeorm';
import { AppDataSource } from '../config/database';
import { createAiLinkedPlannedActivity } from '../services/planning/create-ai-linked-activity';
import { resolvePlanDayIdForDate } from '../services/planning/resolve-plan-day-for-date';
import { PracticeAttempt } from '../models/PracticeAttempt';
import { PracticeExercise } from '../models/PracticeExercise';
import { WritingSubmission } from '../models/WritingSubmission';
import { WritingTask } from '../models/WritingTask';
import { PlannedActivity } from '../models/PlannedActivity';
import { PracticeAttemptStatus, WritingSubmissionStatus } from '../models/enums';
import { getWritingTaskFormat } from '../lib/writing-task-catalog';

/**
 * One-off backfill for the AI-linked-activities feature
 * (AddAiLinkedPlannedActivities migration): registers already-completed
 * Practice attempts / Writing submissions — created before that feature
 * shipped, or completed outside the Plan/Home "Add Activity" chooser — as
 * planned_activities, using each record's own completion date to place it
 * on the right day (same default-to-completion-day rule the live submit
 * flows use — see resolve-plan-day-for-date.ts). Safe to re-run: every
 * record is skipped if a planned_activity is already linked to it
 * (including soft-deleted links, so a plan entry the user deleted on
 * purpose is never resurrected).
 *
 * Usage: npm run db:backfill-ai-activities
 *        npm run db:backfill-ai-activities -- --dry-run
 */

const DRY_RUN = process.argv.includes('--dry-run');

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface BackfillCounts {
  created: number;
  alreadyLinked: number;
  skippedIncomplete: number;
}

async function backfillPractice(ds: DataSource): Promise<BackfillCounts> {
  const counts: BackfillCounts = { created: 0, alreadyLinked: 0, skippedIncomplete: 0 };
  const attemptRepo = ds.getRepository(PracticeAttempt);
  const exerciseRepo = ds.getRepository(PracticeExercise);
  const plannedActivityRepo = ds.getRepository(PlannedActivity);

  const attempts = await attemptRepo.find({ where: { status: PracticeAttemptStatus.COMPLETED } });
  console.log(`[backfill] Practice: ${attempts.length} completed attempts found`);

  for (const attempt of attempts) {
    const alreadyLinked = await plannedActivityRepo.findOne({
      where: { practice_attempt_id: attempt.id },
      withDeleted: true,
    });
    if (alreadyLinked !== null) {
      counts.alreadyLinked++;
      continue;
    }

    if (attempt.submitted_at === null || attempt.duration_seconds === null) {
      console.warn(
        `[backfill]   skipping practice attempt ${attempt.id}: missing submitted_at/duration_seconds`,
      );
      counts.skippedIncomplete++;
      continue;
    }

    const exercise = await exerciseRepo.findOne({
      where: { id: attempt.exercise_id },
      withDeleted: true,
    });
    if (exercise === null) {
      console.warn(
        `[backfill]   skipping practice attempt ${attempt.id}: exercise ${attempt.exercise_id} not found`,
      );
      counts.skippedIncomplete++;
      continue;
    }

    const dateKey = toDateKey(attempt.submitted_at);
    const examSectionSlug = exercise.part_code.toLowerCase().replace(/_/g, '-');
    const estimatedDurationMinutes = Math.max(1, Math.round(attempt.duration_seconds / 60));

    if (DRY_RUN) {
      console.log(
        `[backfill]   [dry-run] would link practice attempt ${attempt.id} -> user ${attempt.user_id} on ${dateKey}`,
      );
      counts.created++;
      continue;
    }

    await ds.transaction(async (manager) => {
      const planDayId = await resolvePlanDayIdForDate(manager, attempt.user_id, dateKey);
      await createAiLinkedPlannedActivity(manager, {
        planDayId,
        title: `Use of English — ${exercise.title}`,
        skillSlug: 'use-of-english',
        examSectionSlug,
        estimatedDurationMinutes,
        completedAt: attempt.submitted_at as Date,
        practiceAttemptId: attempt.id,
      });
    });
    counts.created++;
  }

  return counts;
}

async function backfillWriting(ds: DataSource): Promise<BackfillCounts> {
  const counts: BackfillCounts = { created: 0, alreadyLinked: 0, skippedIncomplete: 0 };
  const submissionRepo = ds.getRepository(WritingSubmission);
  const taskRepo = ds.getRepository(WritingTask);
  const plannedActivityRepo = ds.getRepository(PlannedActivity);

  const submissions = await submissionRepo.find({
    where: { status: WritingSubmissionStatus.GRADED },
  });
  console.log(`[backfill] Writing: ${submissions.length} graded submissions found`);

  for (const submission of submissions) {
    const alreadyLinked = await plannedActivityRepo.findOne({
      where: { writing_submission_id: submission.id },
      withDeleted: true,
    });
    if (alreadyLinked !== null) {
      counts.alreadyLinked++;
      continue;
    }

    if (submission.submitted_at === null || submission.duration_seconds === null) {
      console.warn(
        `[backfill]   skipping writing submission ${submission.id}: missing submitted_at/duration_seconds`,
      );
      counts.skippedIncomplete++;
      continue;
    }

    const task = await taskRepo.findOne({ where: { id: submission.task_id }, withDeleted: true });
    if (task === null) {
      console.warn(
        `[backfill]   skipping writing submission ${submission.id}: task ${submission.task_id} not found`,
      );
      counts.skippedIncomplete++;
      continue;
    }

    const dateKey = toDateKey(submission.submitted_at);
    const part = getWritingTaskFormat(task.task_type).part;
    const estimatedDurationMinutes = Math.max(1, Math.round(submission.duration_seconds / 60));

    if (DRY_RUN) {
      console.log(
        `[backfill]   [dry-run] would link writing submission ${submission.id} -> user ${submission.user_id} on ${dateKey}`,
      );
      counts.created++;
      continue;
    }

    await ds.transaction(async (manager) => {
      const planDayId = await resolvePlanDayIdForDate(manager, submission.user_id, dateKey);
      await createAiLinkedPlannedActivity(manager, {
        planDayId,
        title: `Writing — ${task.title}`,
        skillSlug: 'writing',
        examSectionSlug: `writing-part-${part}`,
        estimatedDurationMinutes,
        completedAt: submission.submitted_at as Date,
        writingSubmissionId: submission.id,
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
    const practiceCounts = await backfillPractice(AppDataSource);
    const writingCounts = await backfillWriting(AppDataSource);

    console.log('\n[backfill] Summary');
    console.log(
      `  Practice: ${practiceCounts.created} linked, ${practiceCounts.alreadyLinked} already linked, ${practiceCounts.skippedIncomplete} skipped`,
    );
    console.log(
      `  Writing:  ${writingCounts.created} linked, ${writingCounts.alreadyLinked} already linked, ${writingCounts.skippedIncomplete} skipped`,
    );
    console.log('[backfill] Done.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err: unknown) => {
  console.error('[backfill] Failed:', err);
  process.exit(1);
});
