/**
 * Re-runs MistakeClassifier against every existing mistake_concepts row and
 * writes whatever verdict it currently produces — for rows created before
 * automatic classification shipped (still `error_type='unknown'`), and for
 * rows a smarter future classifier (or a bug fix to this one) should
 * reclassify. Never touches a row whose classification_source is already
 * 'user' — a manual correction is permanent until a human changes it again.
 *
 * Known limitation: this reclassifies against `mistake_concepts.correct_answer`,
 * which is the "/"-joined display string (see RecordPracticeMistakesService),
 * not the single primary accepted answer the live submit path classifies
 * against. For the overwhelming majority of Word Formation items (exactly
 * one accepted answer) these are identical; an item with two+ accepted forms
 * will contain a "/" and the classifier's own multi-word guard will just
 * leave it UNKNOWN rather than guess against the wrong string — the same
 * safe-failure behavior as everywhere else in this classifier.
 *
 * Safety: defaults to a dry run that only prints what WOULD change. Pass
 * --apply to actually write. Always prints the masked DB target and stage
 * before doing anything.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/reclassify-mistakes.ts
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/reclassify-mistakes.ts --apply
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, Not } from 'typeorm';

import { AppDataSource } from '../src/config/database';
import { MistakeConcept } from '../src/models/MistakeConcept';
import { MistakeClassificationSource } from '../src/models/enums';
import { MistakeClassifier } from '../src/lib/mistakes/mistake-classifier';

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
    if (inStage && trimmed.length > 0 && !/^\s/.test(trimmed)) inStage = false;
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

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL || readDatabaseUrl(ENV_FILE, STAGE);
  if (!databaseUrl) {
    console.error(`ERROR: DATABASE_URL not found for stage "${STAGE}".`);
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
    const conceptRepo = dataSource.getRepository(MistakeConcept);
    const classifier = new MistakeClassifier();

    const candidates = await conceptRepo.find({
      where: { classification_source: Not(MistakeClassificationSource.USER) },
      order: { last_wrong_at: 'ASC' },
    });

    console.log(
      `Found ${candidates.length} mistake concept(s) eligible for reclassification (excludes user-corrected rows).\n`,
    );

    let changed = 0;
    let unchanged = 0;

    for (const concept of candidates) {
      const result = classifier.classify({
        baseWord: concept.base_word,
        userAnswer: concept.last_user_answer,
        correctAnswer: concept.correct_answer,
        taskType: concept.task_type,
      });

      const isDifferent =
        result.errorType !== concept.error_type ||
        result.errorSubtype !== concept.error_subtype ||
        result.expectedWordClass !== concept.expected_word_class ||
        result.userWordClass !== concept.user_word_class;

      if (!isDifferent) {
        unchanged++;
        continue;
      }

      changed++;
      const subtypeSuffix = result.errorSubtype ? `/${result.errorSubtype}` : '';
      console.log(
        `  ${APPLY ? 'update' : 'would update'} ${concept.id}  "${concept.concept_key}"  ${concept.error_type} -> ${result.errorType}${subtypeSuffix}`,
      );

      if (APPLY) {
        await conceptRepo.update(concept.id, {
          error_type: result.errorType,
          error_subtype: result.errorSubtype,
          expected_word_class: result.expectedWordClass,
          user_word_class: result.userWordClass,
          classification_source: result.classificationSource,
        });
      }
    }

    console.log('');
    console.log('---');
    console.log(`${changed} row(s) ${APPLY ? 'updated' : 'would be updated'}.`);
    console.log(`${unchanged} row(s) unchanged (already match the classifier's current verdict).`);
    if (!APPLY && changed > 0) {
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
