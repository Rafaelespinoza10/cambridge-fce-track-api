import { getDatabaseConnection } from '../../lib/database';
import { getSkillAccentColor } from '../../lib/skill-display';
import { ScoringRepository } from '../../repositories/scoring.repository';
import { ScoreType, DifficultyLevel, ScoreCriterion } from '../../models/enums';
import type { ActivityScore } from '../../models/ActivityScore';
import type { ActivityScoreDetail } from '../../models/ActivityScoreDetail';
import type { Skill } from '../../models/Skill';
import type {
  RegisterScoreBody,
  UpdateScoreBody,
  ScoreDetailInput,
  SafeScore,
  SafeScoreDetail,
  SafeScoreSkill,
  ScoreHistoryFilters,
  ScoreHistoryExportRow,
} from '../../interfaces/scoring/scoring.interface';

// ── Helpers ────────────────────────────────────────────────────────────────────

function createError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

function parseNumeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fallback percentage derivation for score types that don't compute it from
 * correct_answers/total_questions (CORRECT_ANSWERS) or rubric details
 * (RUBRIC) — namely CUSTOM, PERCENTAGE and TIME_ONLY. Exported standalone
 * (rather than inlined) so it's unit-testable without the DB seam
 * registerScore/updateScore both require.
 */
export function deriveFallbackPercentage(
  rawScore: number | null,
  maxScore: number | null,
): number | null {
  if (rawScore === null || maxScore === null || maxScore <= 0) return null;
  return roundTwo((rawScore / maxScore) * 100);
}

// ── Mappers ────────────────────────────────────────────────────────────────────

function toSafeSkill(skill: Skill): SafeScoreSkill {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    accentColor: getSkillAccentColor(skill.slug),
  };
}

function toSafeDetail(detail: ActivityScoreDetail): SafeScoreDetail {
  return {
    id: detail.id,
    criterion: detail.criterion,
    score: parseNumeric(detail.score) ?? 0,
    maxScore: parseNumeric(detail.max_score),
    notes: detail.notes,
  };
}

function toSafeScore(score: ActivityScore): SafeScore {
  return {
    id: score.id,
    plannedActivityId: score.planned_activity_id,
    skillId: score.skill_id,
    skill: score.skill !== undefined && score.skill !== null ? toSafeSkill(score.skill) : null,
    scoreType: score.score_type,
    correctAnswers: score.correct_answers,
    totalQuestions: score.total_questions,
    percentage: parseNumeric(score.percentage),
    rawScore: parseNumeric(score.raw_score),
    maxScore: parseNumeric(score.max_score),
    timeSpentMinutes: score.time_spent_minutes,
    difficulty: score.difficulty,
    notes: score.notes,
    attemptedAt: score.attempted_at,
    details: (score.score_details ?? []).map(toSafeDetail),
    createdAt: score.created_at,
    updatedAt: score.updated_at,
  };
}

function toScoreHistoryExportRow(score: ActivityScore): ScoreHistoryExportRow {
  return {
    scoreId: score.id,
    plannedActivityId: score.planned_activity_id ?? '',
    activityTitle: score.planned_activity?.title ?? '',
    skillName: score.skill?.name ?? '',
    scoreType: score.score_type,
    correctAnswers: score.correct_answers ?? '',
    totalQuestions: score.total_questions ?? '',
    percentage: parseNumeric(score.percentage) ?? '',
    rawScore: parseNumeric(score.raw_score) ?? '',
    maxScore: parseNumeric(score.max_score) ?? '',
    timeSpentMinutes: score.time_spent_minutes ?? '',
    difficulty: score.difficulty ?? '',
    notes: score.notes ?? '',
    attemptedAt: score.attempted_at.toISOString(),
  };
}

// Raised from 100 so a progress report can fetch a full score history in one
// request without pagination.
const MAX_SCORE_HISTORY_LIMIT = 500;

// ── Validation ─────────────────────────────────────────────────────────────────

const VALID_SCORE_TYPES = new Set<string>(Object.values(ScoreType));
const VALID_DIFFICULTY = new Set<string>(Object.values(DifficultyLevel));
const VALID_CRITERIA = new Set<string>(Object.values(ScoreCriterion));

function validateDetails(details: ScoreDetailInput[]): void {
  for (const d of details) {
    if (!VALID_CRITERIA.has(d.criterion)) {
      throw createError(`Invalid criterion: ${d.criterion}`, 400);
    }
    if (typeof d.score !== 'number' || d.score < 0) {
      throw createError('Each detail score must be a non-negative number', 400);
    }
    if (
      d.maxScore !== undefined &&
      d.maxScore !== null &&
      (typeof d.maxScore !== 'number' || d.maxScore < 0)
    ) {
      throw createError('Each detail maxScore must be a non-negative number', 400);
    }
  }
}

// ── Service ────────────────────────────────────────────────────────────────────

class ScoringService {
  async registerScore(
    userId: string,
    plannedActivityId: string,
    body: RegisterScoreBody,
  ): Promise<SafeScore> {
    if (!body.scoreType || !VALID_SCORE_TYPES.has(body.scoreType)) {
      throw createError(`scoreType must be one of: ${Object.values(ScoreType).join(', ')}`, 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    const activity = await repo.findPlannedActivityWithOwner(plannedActivityId, userId);
    if (activity === null) {
      throw createError('Planned activity not found', 404);
    }

    const attemptedAt =
      body.attemptedAt !== undefined && body.attemptedAt !== null
        ? new Date(body.attemptedAt)
        : new Date();

    if (isNaN(attemptedAt.getTime())) {
      throw createError('attemptedAt must be a valid ISO timestamp', 400);
    }

    // Auto-calculate percentage for correct_answers type
    let percentage: number | null = null;
    if (body.scoreType === ScoreType.CORRECT_ANSWERS) {
      const correct = body.correctAnswers ?? null;
      const total = body.totalQuestions ?? null;
      if (correct !== null && total !== null && total > 0) {
        percentage = roundTwo((correct / total) * 100);
      }
    }

    // Validate rubric details
    const details = body.details ?? [];
    if (body.scoreType === ScoreType.RUBRIC && details.length === 0) {
      throw createError('Rubric score type requires at least one detail entry', 400);
    }
    if (details.length > 0) {
      validateDetails(details);
    }

    // For rubric: derive raw_score as sum of detail scores
    let rawScore: number | null = body.rawScore ?? null;
    let maxScore: number | null = body.maxScore ?? null;
    if (body.scoreType === ScoreType.RUBRIC && details.length > 0) {
      rawScore = roundTwo(details.reduce((sum, d) => sum + d.score, 0));
      const allHaveMax = details.every((d) => d.maxScore !== undefined && d.maxScore !== null);
      if (allHaveMax) {
        maxScore = roundTwo(details.reduce((sum, d) => sum + (d.maxScore ?? 0), 0));
        percentage = roundTwo((rawScore / maxScore) * 100);
      }
    }

    // Fallback for score types with no dedicated calculation above (custom,
    // percentage, time_only, or correct_answers/rubric sent without the
    // fields they normally derive percentage from): derive it directly from
    // rawScore/maxScore whenever both are present, so every stat that reads
    // ActivityScore.percentage (home summary, recent activities, skill
    // averages) sees a value instead of silently skipping the row.
    if (percentage === null) {
      percentage = deriveFallbackPercentage(rawScore, maxScore);
    }

    if (
      body.difficulty !== undefined &&
      body.difficulty !== null &&
      !VALID_DIFFICULTY.has(body.difficulty)
    ) {
      throw createError(
        `difficulty must be one of: ${Object.values(DifficultyLevel).join(', ')}`,
        400,
      );
    }

    const score = await repo.createScore({
      userId,
      plannedActivityId,
      skillId: activity.skill_id,
      scoreType: body.scoreType,
      correctAnswers: body.correctAnswers ?? null,
      totalQuestions: body.totalQuestions ?? null,
      rawScore,
      maxScore,
      percentage,
      timeSpentMinutes: body.timeSpentMinutes ?? null,
      difficulty: body.difficulty ?? null,
      notes: body.notes ?? null,
      attemptedAt,
    });

    if (details.length > 0) {
      await repo.createScoreDetails(
        details.map((d) => ({
          activityScoreId: score.id,
          criterion: d.criterion,
          score: d.score,
          maxScore: d.maxScore ?? null,
          notes: d.notes ?? null,
        })),
      );
    }

    const full = await repo.findScoreWithDetails(score.id);
    if (full === null) throw createError('Score not found after creation', 500);

    return toSafeScore(full);
  }

  async getScoresByActivity(userId: string, plannedActivityId: string): Promise<SafeScore[]> {
    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    const activity = await repo.findPlannedActivityWithOwner(plannedActivityId, userId);
    if (activity === null) {
      throw createError('Planned activity not found', 404);
    }

    const scores = await repo.findScoresByPlannedActivity(plannedActivityId, userId);
    return scores.map(toSafeScore);
  }

  async getScore(userId: string, scoreId: string): Promise<SafeScore> {
    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    const score = await repo.findScoreWithDetails(scoreId);
    if (score === null || score.user_id !== userId) {
      throw createError('Score not found', 404);
    }

    return toSafeScore(score);
  }

  async updateScore(userId: string, scoreId: string, body: UpdateScoreBody): Promise<SafeScore> {
    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    const existing = await repo.findScoreWithDetails(scoreId);
    if (existing === null || existing.user_id !== userId) {
      throw createError('Score not found', 404);
    }

    if (
      body.difficulty !== undefined &&
      body.difficulty !== null &&
      !VALID_DIFFICULTY.has(body.difficulty)
    ) {
      throw createError(
        `difficulty must be one of: ${Object.values(DifficultyLevel).join(', ')}`,
        400,
      );
    }

    const updateData: Parameters<ScoringRepository['updateScore']>[1] = {};

    if (body.correctAnswers !== undefined) updateData.correct_answers = body.correctAnswers;
    if (body.totalQuestions !== undefined) updateData.total_questions = body.totalQuestions;
    if (body.timeSpentMinutes !== undefined) updateData.time_spent_minutes = body.timeSpentMinutes;
    if (body.difficulty !== undefined) updateData.difficulty = body.difficulty ?? null;
    if (body.notes !== undefined) updateData.notes = body.notes;

    // Recalculate percentage if correct_answers/total_questions change
    const newCorrect =
      body.correctAnswers !== undefined ? body.correctAnswers : existing.correct_answers;
    const newTotal =
      body.totalQuestions !== undefined ? body.totalQuestions : existing.total_questions;
    if (
      existing.score_type === ScoreType.CORRECT_ANSWERS &&
      (body.correctAnswers !== undefined || body.totalQuestions !== undefined) &&
      newCorrect !== null &&
      newTotal !== null &&
      newTotal > 0
    ) {
      updateData.percentage = String(roundTwo((newCorrect / newTotal) * 100));
    }

    if (body.rawScore !== undefined)
      updateData.raw_score = body.rawScore !== null ? String(body.rawScore) : null;
    if (body.maxScore !== undefined)
      updateData.max_score = body.maxScore !== null ? String(body.maxScore) : null;

    // Same fallback as registerScore: for score types that don't derive
    // percentage from correct_answers/total_questions or rubric details,
    // recompute it whenever rawScore or maxScore changes so it never drifts
    // out of sync with the values actually shown/edited by the user.
    if (
      existing.score_type !== ScoreType.CORRECT_ANSWERS &&
      existing.score_type !== ScoreType.RUBRIC &&
      (body.rawScore !== undefined || body.maxScore !== undefined)
    ) {
      const effectiveRawScore =
        body.rawScore !== undefined ? body.rawScore : parseNumeric(existing.raw_score);
      const effectiveMaxScore =
        body.maxScore !== undefined ? body.maxScore : parseNumeric(existing.max_score);
      const fallback = deriveFallbackPercentage(effectiveRawScore, effectiveMaxScore);
      updateData.percentage = fallback !== null ? String(fallback) : null;
    }

    if (body.attemptedAt !== undefined && body.attemptedAt !== null) {
      const parsed = new Date(body.attemptedAt);
      if (isNaN(parsed.getTime()))
        throw createError('attemptedAt must be a valid ISO timestamp', 400);
      updateData.attempted_at = parsed;
    }

    if (Object.keys(updateData).length > 0) {
      await repo.updateScore(scoreId, updateData);
    }

    // Replace rubric details if provided
    if (body.details !== undefined && body.details !== null) {
      if (body.details.length > 0) {
        validateDetails(body.details);
      }
      await repo.replaceScoreDetails(
        scoreId,
        body.details.map((d) => ({
          activityScoreId: scoreId,
          criterion: d.criterion,
          score: d.score,
          maxScore: d.maxScore ?? null,
          notes: d.notes ?? null,
        })),
      );

      // Recalculate totals from updated details
      if (body.details.length > 0 && existing.score_type === ScoreType.RUBRIC) {
        const newRaw = roundTwo(body.details.reduce((sum, d) => sum + d.score, 0));
        const allHaveMax = body.details.every(
          (d) => d.maxScore !== undefined && d.maxScore !== null,
        );
        const detailUpdate: Parameters<ScoringRepository['updateScore']>[1] = {
          raw_score: String(newRaw),
        };
        if (allHaveMax) {
          const newMax = roundTwo(body.details.reduce((sum, d) => sum + (d.maxScore ?? 0), 0));
          detailUpdate.max_score = String(newMax);
          detailUpdate.percentage = String(roundTwo((newRaw / newMax) * 100));
        }
        await repo.updateScore(scoreId, detailUpdate);
      }
    }

    const updated = await repo.findScoreWithDetails(scoreId);
    if (updated === null) throw createError('Score not found', 404);

    return toSafeScore(updated);
  }

  async deleteScore(userId: string, scoreId: string): Promise<void> {
    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    const existing = await repo.findScoreWithDetails(scoreId);
    if (existing === null || existing.user_id !== userId) {
      throw createError('Score not found', 404);
    }

    await repo.softDeleteScore(scoreId);
  }

  async getScoreHistory(
    userId: string,
    filters: ScoreHistoryFilters,
  ): Promise<{
    data: SafeScore[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(filters.limit ?? 20, MAX_SCORE_HISTORY_LIMIT);
    const offset = filters.offset ?? 0;

    if (filters.scoreType !== undefined && !VALID_SCORE_TYPES.has(filters.scoreType)) {
      throw createError(`scoreType must be one of: ${Object.values(ScoreType).join(', ')}`, 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (filters.from !== undefined) {
      fromDate = new Date(filters.from);
      if (isNaN(fromDate.getTime())) throw createError('from must be a valid date', 400);
    }
    if (filters.to !== undefined) {
      toDate = new Date(filters.to);
      if (isNaN(toDate.getTime())) throw createError('to must be a valid date', 400);
    }

    const [scores, total] = await repo.findScoreHistory({
      userId,
      skillId: filters.skillId,
      scoreType: filters.scoreType,
      from: fromDate,
      to: toDate,
      limit,
      offset,
    });

    return { data: scores.map(toSafeScore), total, limit, offset };
  }

  async exportScoreHistory(
    userId: string,
    filters: Omit<ScoreHistoryFilters, 'limit' | 'offset'>,
  ): Promise<ScoreHistoryExportRow[]> {
    if (filters.scoreType !== undefined && !VALID_SCORE_TYPES.has(filters.scoreType)) {
      throw createError(`scoreType must be one of: ${Object.values(ScoreType).join(', ')}`, 400);
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (filters.from !== undefined) {
      fromDate = new Date(filters.from);
      if (isNaN(fromDate.getTime())) throw createError('from must be a valid date', 400);
    }
    if (filters.to !== undefined) {
      toDate = new Date(filters.to);
      if (isNaN(toDate.getTime())) throw createError('to must be a valid date', 400);
    }

    const ds = await getDatabaseConnection();
    const repo = new ScoringRepository(ds);

    const scores = await repo.findScoreHistoryForExport({
      userId,
      skillId: filters.skillId,
      scoreType: filters.scoreType,
      from: fromDate,
      to: toDate,
    });

    return scores.map(toScoreHistoryExportRow);
  }
}

export { ScoringService };
