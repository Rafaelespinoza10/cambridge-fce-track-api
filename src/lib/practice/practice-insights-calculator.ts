import { roundToTwoDecimals } from './practice-attempt-grading';
import type {
  PracticeInsights,
  PracticeMetric,
} from '../../interfaces/practice/practice-adaptive.interface';

export interface PracticeInsightRow {
  attemptId: string;
  submittedAt: Date;
  durationSeconds: number | null;
  examCode: string;
  paperCode: string;
  partCode: string;
  skillTags: string[];
  isCorrect: boolean;
  isUnanswered: boolean;
}

interface Bucket {
  itemCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
}

const empty = (): Bucket => ({
  itemCount: 0,
  correctCount: 0,
  incorrectCount: 0,
  unansweredCount: 0,
});

function add(bucket: Bucket, row: Pick<PracticeInsightRow, 'isCorrect' | 'isUnanswered'>): void {
  bucket.itemCount++;
  if (row.isUnanswered) {
    bucket.unansweredCount++;
  } else if (row.isCorrect) {
    bucket.correctCount++;
  } else {
    bucket.incorrectCount++;
  }
}

function metric(code: string, bucket: Bucket): PracticeMetric {
  return {
    code,
    ...bucket,
    percentage: bucket.itemCount
      ? roundToTwoDecimals((bucket.correctCount / bucket.itemCount) * 100)
      : 0,
  };
}

export function calculatePracticeInsights(
  rows: PracticeInsightRow[],
  now = new Date(),
): PracticeInsights {
  const byAttempt = new Map<string, PracticeInsightRow[]>();
  for (const row of rows) {
    const xs = byAttempt.get(row.attemptId) ?? [];
    xs.push(row);
    byAttempt.set(row.attemptId, xs);
  }

  const attempts = [...byAttempt.values()].sort(
    (a, b) =>
      b[0]!.submittedAt.getTime() - a[0]!.submittedAt.getTime() ||
      a[0]!.attemptId.localeCompare(b[0]!.attemptId),
  );
  const selectedAttempts = attempts
    .slice(0, 10)
    .filter((a) => now.getTime() - a[0]!.submittedAt.getTime() <= 30 * 24 * 60 * 60 * 1000);
  const selected = selectedAttempts.flat();
  const total = empty();
  const parts = new Map<string, Bucket>();
  const skills = new Map<string, Bucket>();

  for (const row of selected) {
    add(total, row);
    const key = row.examCode + '|' + row.paperCode + '|' + row.partCode;
    const part = parts.get(key) ?? empty();
    add(part, row);
    parts.set(key, part);
    for (const tag of [...new Set(row.skillTags)].sort()) {
      const skill = skills.get(tag) ?? empty();
      add(skill, row);
      skills.set(tag, skill);
    }
  }

  const byPart = [...parts.entries()].map(([key, bucket]) => {
    const [examCode, paperCode, partCode] = key.split('|');
    return {
      examCode: examCode!,
      paperCode: paperCode!,
      partCode: partCode!,
      ...metric(partCode!, bucket),
    };
  });
  byPart.sort(
    (a, b) =>
      a.percentage - b.percentage ||
      a.examCode.localeCompare(b.examCode) ||
      a.paperCode.localeCompare(b.paperCode) ||
      a.partCode.localeCompare(b.partCode),
  );

  const bySkill = [...skills.entries()]
    .map(([code, bucket]) => metric(code, bucket))
    .sort((a, b) => a.percentage - b.percentage || a.code.localeCompare(b.code));

  const strengths = [...bySkill]
    .sort((a, b) => b.percentage - a.percentage || a.code.localeCompare(b.code))
    .slice(0, 3)
    .map((x) => x.code);
  const focusAreas = bySkill.slice(0, 3).map((x) => x.code);

  const durations = selectedAttempts
    .map((a) => a[0]!.durationSeconds)
    .filter((v): v is number => v !== null);

  const trend =
    selectedAttempts.length >= 6
      ? (() => {
          const recent = selectedAttempts.slice(0, 3).flat();
          const previous = selectedAttempts.slice(3, 6).flat();
          const pct = (xs: PracticeInsightRow[]) =>
            xs.length
              ? roundToTwoDecimals((xs.filter((x) => x.isCorrect).length / xs.length) * 100)
              : 0;
          const recentPercentage = pct(recent);
          const previousPercentage = pct(previous);
          const deltaPercentage = roundToTwoDecimals(recentPercentage - previousPercentage);
          return {
            recentPercentage,
            previousPercentage,
            deltaPercentage,
            direction:
              deltaPercentage > 0
                ? ('improving' as const)
                : deltaPercentage < 0
                  ? ('declining' as const)
                  : ('stable' as const),
          };
        })()
      : null;

  return {
    sample: { attemptCount: selectedAttempts.length, ...total },
    overall: {
      percentage: total.itemCount
        ? roundToTwoDecimals((total.correctCount / total.itemCount) * 100)
        : 0,
      averageDurationSeconds: durations.length
        ? roundToTwoDecimals(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
    },
    byPart,
    bySkill,
    strengths,
    focusAreas,
    trend,
    eligibleForRecommendation: selectedAttempts.length >= 3 && total.itemCount >= 15,
  };
}
