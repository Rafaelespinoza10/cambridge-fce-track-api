import type { Recommendation } from '@models/Recommendation';
import { RecommendationType, RecommendationPriority, RecommendationSource } from '@models/enums';
import type { SafeRecommendation } from '../../interfaces/recommendations/recommendations.interface';

// ── SPEC Section 9 — Weakness Detection Rules ──────────────────────────────────
// Score < 60%   → WEAKNESS   / HIGH   priority → recommend 2x/week
// Score 60–75%  → IMPROVEMENT / MEDIUM priority → maintenance practice
// Score > 75%   → GENERAL    / LOW    priority → strong, reduce if other weaknesses

export interface SkillClassification {
  recommendationType: RecommendationType;
  priority: RecommendationPriority;
  title: string;
  description: string;
}

export function classifySkill(skillName: string, avgScore: number): SkillClassification {
  if (avgScore < 60) {
    return {
      recommendationType: RecommendationType.WEAKNESS,
      priority: RecommendationPriority.HIGH,
      title: `Improve your ${skillName}`,
      description: `Your average score in ${skillName} is ${Math.round(avgScore)}%, which is below 60%. Practice this skill at least 2 times per week to overcome this weakness.`,
    };
  }

  if (avgScore <= 75) {
    return {
      recommendationType: RecommendationType.IMPROVEMENT,
      priority: RecommendationPriority.MEDIUM,
      title: `Keep practising ${skillName}`,
      description: `Your average score in ${skillName} is ${Math.round(avgScore)}%. You are progressing — maintain regular practice to push above 75%.`,
    };
  }

  return {
    recommendationType: RecommendationType.GENERAL,
    priority: RecommendationPriority.LOW,
    title: `${skillName} is a strength`,
    description: `Your average score in ${skillName} is ${Math.round(avgScore)}%. Great work — you can reduce frequency here if you have weaker skills that need more attention.`,
  };
}

export const RULE_SOURCE = RecommendationSource.RULE_BASED;

export function toSafeRecommendation(rec: Recommendation): SafeRecommendation {
  return {
    id: rec.id,
    skillId: rec.skill_id,
    skillName: rec.skill?.name ?? null,
    title: rec.title,
    description: rec.description,
    recommendationType: rec.recommendation_type,
    priority: rec.priority,
    status: rec.status,
    source: rec.source,
    createdAt: rec.created_at,
    updatedAt: rec.updated_at,
  };
}
