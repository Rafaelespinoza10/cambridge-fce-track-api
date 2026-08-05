/**
 * Manual, out-of-suite integration test for POST /flashcards/ai/draft.
 * Calls the real GenerateFlashcardDraftService (real OPEN_AI_API_KEY from
 * serverless.env.yml, real OpenAI request) for a fixed list of terms and
 * prints each resulting draft. Never logs the API key.
 *
 * Usage:
 *   npx ts-node scripts/test-flashcard-ai-draft.ts
 *   STAGE=prod npx ts-node scripts/test-flashcard-ai-draft.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import { buildGenerateFlashcardDraftServices } from '../src/services/flashcards/generate-flashcard-draft-composition';
import { FlashcardType } from '../src/models/enums';

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'serverless.env.yml');
const STAGE = process.env.STAGE || 'dev';

function readEnvValue(filePath: string, stage: string, key: string): string {
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
      const match = trimmed.match(new RegExp(`^\\s+${key}:\\s*(.+)$`));
      if (match) {
        return match[1].trim();
      }
    }
  }

  console.error(`ERROR: ${key} not found for stage "${stage}" in ${filePath}`);
  process.exit(1);
}

const TERMS: { term: string; type: FlashcardType }[] = [
  { term: 'iron out', type: FlashcardType.PHRASAL_VERB },
  { term: 'carry out', type: FlashcardType.PHRASAL_VERB },
  { term: 'come up with', type: FlashcardType.PHRASAL_VERB },
  { term: 'dependent on', type: FlashcardType.COLLOCATION },
  { term: 'take responsibility for', type: FlashcardType.COLLOCATION },
];

/** Rough, non-exact estimate — 1 token ≈ 4 characters of English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function main(): Promise<void> {
  process.env.OPEN_AI_API_KEY = readEnvValue(ENV_FILE, STAGE, 'OPEN_AI_API_KEY');
  process.env.OPENAI_MODEL = readEnvValue(ENV_FILE, STAGE, 'OPENAI_MODEL');

  console.log(`Stage : ${STAGE}`);
  console.log(`Model : ${process.env.OPENAI_MODEL}\n`);

  const { generateDraft } = await buildGenerateFlashcardDraftServices();

  let totalEstimatedTokens = 0;
  let failures = 0;

  for (const { term, type } of TERMS) {
    process.stdout.write(`→ "${term}" (${type})... `);
    const startedAt = Date.now();
    try {
      const draft = await generateDraft.execute({ term, type });
      const elapsedMs = Date.now() - startedAt;
      const responseJson = JSON.stringify(draft);
      const estimated = estimateTokens(term) + estimateTokens(responseJson);
      totalEstimatedTokens += estimated;

      console.log(`ok (${elapsedMs}ms, ~${estimated} tokens)`);
      console.log(JSON.stringify(draft, null, 2));
      console.log('');
    } catch (err) {
      failures++;
      console.log('FAILED');
      console.error(`  ${(err as Error).name}: ${(err as Error).message}\n`);
    }
  }

  console.log('---');
  console.log(`${TERMS.length - failures}/${TERMS.length} succeeded`);
  console.log(`Estimated total tokens for this run: ~${totalEstimatedTokens}`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
