/**
 * One-off backfill for a data-capture gap in the freeform activity-logging
 * flow (register-activity in the app): a PlannedActivity created without
 * picking a template or custom activity never gets `exam_section_id` set,
 * even though its `title` is consistently typed like "Listening Part 2" or
 * "Use of English Part 1" (the form's placeholder invites that format).
 * Those rows are invisible to ProgressRepository.getExamPartMetrics, which
 * can only resolve a part via
 * COALESCE(planned_activity, activity_template, custom_activity).exam_section_id.
 *
 * Parses `title` per skill as `^{skillName}\s+Part\s+(\d+)` (case-insensitive,
 * only the leading prefix needs to match — trailing text like
 * "— Multiple matching" is fine) and resolves the Nth exam_sections row for
 * that skill, ordered by slug. This naturally handles the one numbering
 * quirk: exam_sections numbers Reading continuously within the combined
 * Reading & Use of English paper (reading-part-5/6/7), while activity
 * titles use relative numbering ("Reading Part 1/2/3" — a student's own
 * first/second/third Reading part). Ordering each skill's sections by slug
 * and indexing by the parsed N handles this without hardcoding an offset:
 * Reading's ordered list is [reading-part-5, reading-part-6, reading-part-7],
 * so "Reading Part 1" (N=1) naturally lands on index 0 = reading-part-5.
 *
 * Only touches rows where exam_section_id, activity_template_id, AND
 * custom_activity_id are all NULL — never overwrites a row that already has
 * a real link (template/custom-activity-linked rows already resolve fine,
 * see backfill-activity-score-percentage.ts for the sibling data-quality
 * fix in this area).
 *
 * Safety: defaults to a dry run that only prints what WOULD change. Pass
 * --apply to actually write. Always prints the masked DB target and stage
 * before doing anything.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-activity-exam-sections.ts
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-activity-exam-sections.ts --apply
 *   STAGE=prod npx ts-node -r ./scripts/md-require-hook.js scripts/backfill-activity-exam-sections.ts --apply
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';

import { AppDataSource } from '../src/config/database';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';
const APPLY = process.argv.includes('--apply');

function readDatabaseUrl(filePath: string, stage: string): string | null {
  if (!fs.existsSync(filePath)) {
    console.error(`ERROR: ${filePath} not found.`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  let inStage = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed === `${stage}:`) {
      inStage = true;
      continue;
    }
    if (inStage && trimmed.length > 0 && !/^\s/.test(trimmed)) {
      inStage = false;
    }
    if (inStage) {
      const match = trimmed.match(/^\s+DATABASE_URL:\s*(.+)$/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function maskUrl(url: string): string {
  return url.replace(/:([^:@]+)@/, ':****@');
}

function getSslConfig(databaseUrl: string): boolean | { rejectUnauthorized: boolean } {
  if (databaseUrl.includes('sslmode=require') || databaseUrl.includes('ssl=true')) {
    return { rejectUnauthorized: false };
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type CandidateRow = {
  id: string;
  title: string;
  skill_name: string | null;
};

type ExamSectionRow = {
  id: string;
  slug: string;
  skill_name: string;
};

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl(ENV_FILE, STAGE);
  if (!databaseUrl) {
    console.error(
      `ERROR: DATABASE_URL not found in the environment or in serverless.env.yml under stage "${STAGE}".`,
    );
    process.exit(1);
  }

  console.log(`Stage      : ${STAGE}`);
  console.log(`DB target  : ${maskUrl(databaseUrl)}`);
  console.log(
    `Mode       : ${APPLY ? 'APPLY (will write changes)' : 'DRY RUN (no writes — pass --apply to write)'}`,
  );
  console.log('');

  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    ssl: getSslConfig(databaseUrl),
    synchronize: false,
    logging: false,
    entities: AppDataSource.options.entities,
  });

  await dataSource.initialize();

  try {
    const examSections = await dataSource.query<ExamSectionRow[]>(
      `SELECT es.id, es.slug, sk.name AS skill_name
       FROM exam_sections es
       INNER JOIN skills sk ON sk.id = es.skill_id
       ORDER BY sk.name ASC, es.slug ASC`,
    );

    const sectionsBySkill = new Map<string, ExamSectionRow[]>();
    for (const section of examSections) {
      const list = sectionsBySkill.get(section.skill_name) ?? [];
      list.push(section);
      sectionsBySkill.set(section.skill_name, list);
    }

    const candidates = await dataSource.query<CandidateRow[]>(
      `SELECT pa.id, pa.title, sk.name AS skill_name
       FROM planned_activities pa
       LEFT JOIN skills sk ON sk.id = pa.skill_id
       WHERE pa.deleted_at IS NULL
         AND pa.exam_section_id IS NULL
         AND pa.activity_template_id IS NULL
         AND pa.custom_activity_id IS NULL
       ORDER BY pa.created_at ASC`,
    );

    console.log(
      `Found ${candidates.length} freeform activity row(s) with no resolvable exam section.\n`,
    );

    let matched = 0;
    let unmatched = 0;

    for (const row of candidates) {
      const skillName = row.skill_name;
      const sections = skillName ? (sectionsBySkill.get(skillName) ?? []) : [];

      let resolvedSection: ExamSectionRow | null = null;

      if (skillName && sections.length > 0) {
        const pattern = new RegExp(`^${escapeRegExp(skillName)}\\s+Part\\s+(\\d+)`, 'i');
        const match = row.title.match(pattern);
        if (match) {
          const partNumber = parseInt(match[1]!, 10);
          resolvedSection = sections[partNumber - 1] ?? null;
        }
      }

      if (resolvedSection === null) {
        unmatched++;
        console.log(
          `  skip   ${row.id}  skill=${skillName ?? '—'}  title="${row.title}"  (no parseable part)`,
        );
        continue;
      }

      matched++;
      console.log(
        `  ${APPLY ? 'update' : 'would update'} ${row.id}  skill=${skillName}  title="${row.title}"  ->  exam_section=${resolvedSection.slug}`,
      );

      if (APPLY) {
        await dataSource.query(`UPDATE planned_activities SET exam_section_id = $1 WHERE id = $2`, [
          resolvedSection.id,
          row.id,
        ]);
      }
    }

    console.log('');
    console.log('---');
    console.log(`${matched} row(s) ${APPLY ? 'updated' : 'would be updated'}.`);
    console.log(
      `${unmatched} row(s) had a title that didn't parse into a known skill + part — left as-is.`,
    );
    if (!APPLY && matched > 0) {
      console.log('\nRe-run with --apply to write these changes.');
    }
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
