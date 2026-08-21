/**
 * Read-only inspector for the Cambridge Knowledge Base — lists every
 * imported source and runs one sample search, calling ListCambridgeSourcesService
 * / SearchCambridgeKnowledgeService directly (same pattern as the import
 * scripts). No admin JWT or deployed HTTP endpoint needed, since it talks to
 * the DB/OpenAI directly.
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/inspect-cambridge-knowledge.ts
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/inspect-cambridge-knowledge.ts "informal letter environment"
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/inspect-cambridge-knowledge.ts "informal letter environment" --md scripts/fixtures/inspection.md
 */

import * as fs from 'fs';
import * as path from 'path';

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

function readOptionalEnvValue(filePath: string, stage: string, key: string): string | undefined {
  if (!fs.existsSync(filePath)) return undefined;

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
      if (match) return match[1].trim();
    }
  }

  return undefined;
}

function maskDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

function escapeMdCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mdFlagIndex = args.indexOf('--md');
  const mdOutPath = mdFlagIndex !== -1 ? args[mdFlagIndex + 1] : undefined;
  const query = args[0] === '--md' ? undefined : args[0];

  process.env.DATABASE_URL = process.env.DATABASE_URL || readEnvValue(ENV_FILE, STAGE, 'DATABASE_URL');
  process.env.OPEN_AI_API_KEY = readEnvValue(ENV_FILE, STAGE, 'OPEN_AI_API_KEY');
  const embeddingModel = readOptionalEnvValue(ENV_FILE, STAGE, 'OPENAI_EMBEDDING_MODEL');
  process.env.OPENAI_MODEL = readEnvValue(ENV_FILE, STAGE, 'OPENAI_MODEL');
  if (embeddingModel) process.env.OPENAI_EMBEDDING_MODEL = embeddingModel;

  console.log(`Stage : ${STAGE}`);
  console.log(`DB    : ${maskDatabaseUrl(process.env.DATABASE_URL)}\n`);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { buildCambridgeKnowledgeServices } = require('../src/services/cambridge-knowledge/cambridge-knowledge-composition');
  const { listSources, searchKnowledge } = await buildCambridgeKnowledgeServices();

  const sources = await listSources.execute();
  console.log(`=== ${sources.length} source(s) ===`);
  for (const s of sources) {
    console.log(`  [${s.status}] ${s.name} (v${s.version}) — ${s.pageCount} pages — id=${s.id}`);
  }

  const results = query ? await searchKnowledge.execute({ query, limit: 5 }) : [];

  if (query) {
    console.log(`\n=== search: "${query}" ===`);
    for (const r of results) {
      console.log(`\n  score=${r.relevanceScore.toFixed(3)}  ${r.sourceName} p.${r.sourcePage}`);
      console.log(`  paperCode=${r.paperCode ?? 'null'} partCode=${r.partCode ?? 'null'} skills=[${r.skills.join(', ')}] topics=[${r.topics.join(', ')}]`);
      console.log(`  "${r.content.slice(0, 200).replace(/\s+/g, ' ')}${r.content.length > 200 ? '...' : ''}"`);
    }
  } else {
    console.log('\n(pass a query string as the first argument to also run a sample search)');
  }

  if (mdOutPath) {
    const lines: string[] = [];
    lines.push('# Cambridge Knowledge Base — inspection report');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()} (stage: ${STAGE})`);
    lines.push('');
    lines.push(`## Sources (${sources.length})`);
    lines.push('');
    lines.push('| Status | Name | Version | Pages | Id |');
    lines.push('|---|---|---|---|---|');
    for (const s of sources) {
      lines.push(
        `| ${s.status} | ${escapeMdCell(s.name)} | ${escapeMdCell(s.version)} | ${s.pageCount} | \`${s.id}\` |`,
      );
    }

    if (query) {
      lines.push('');
      lines.push(`## Search: "${escapeMdCell(query)}"`);
      lines.push('');
      if (results.length === 0) {
        lines.push('_No results._');
      }
      for (const r of results) {
        lines.push('');
        lines.push(`### ${escapeMdCell(r.sourceName)} — p.${r.sourcePage} (score ${r.relevanceScore.toFixed(3)})`);
        lines.push('');
        lines.push(
          `- **paperCode**: ${r.paperCode ?? 'null'} · **partCode**: ${r.partCode ?? 'null'} · **skills**: [${r.skills.join(', ')}] · **topics**: [${r.topics.join(', ')}]`,
        );
        lines.push('');
        lines.push(`> ${escapeMdCell(r.content.slice(0, 500))}${r.content.length > 500 ? '...' : ''}`);
      }
    }

    const resolvedMdPath = path.resolve(mdOutPath);
    fs.mkdirSync(path.dirname(resolvedMdPath), { recursive: true });
    fs.writeFileSync(resolvedMdPath, lines.join('\n') + '\n');
    console.log(`\nWrote ${resolvedMdPath}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
