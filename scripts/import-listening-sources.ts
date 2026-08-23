/**
 * Bulk-imports curated Listening tests (one JSON file = one or more parts,
 * each part = one ListeningSource + its items) straight through
 * ImportListeningSourceService — the exact same validation
 * POST /admin/listening-sources runs, just without needing an admin JWT or
 * going over HTTP. Same pattern as scripts/import-cambridge-pdf.ts.
 *
 * Accepts `videoExternalId` as either a bare YouTube video id or a full
 * youtube.com/youtu.be URL — the URL form is normalized to the bare id
 * before validation (the DB/frontend only ever want the bare id).
 *
 * Usage:
 *   npx ts-node -r ./scripts/md-require-hook.js scripts/import-listening-sources.ts <path-to-json-file>
 *
 * The JSON file must be an array of part objects, each shaped like the
 * POST /admin/listening-sources request body (see
 * ImportListeningSourceInput in src/services/mocks/import-listening-source.service.ts).
 *
 * STAGE defaults to "dev" and controls which serverless.env.yml block is
 * read for DATABASE_URL. An already-exported DATABASE_URL always wins (see
 * scripts/db.js) — this script follows the same rule so it never silently
 * redirects to the configured dev database.
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

function maskDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
}

/** Accepts a bare id, a youtube.com/watch?v=..., or a youtu.be/... link. */
function normalizeVideoId(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const vParam = url.searchParams.get('v');
    if (vParam) return vParam;
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace(/^\//, '');
    }
    const embedMatch = url.pathname.match(/\/embed\/([^/]+)/);
    if (embedMatch) return embedMatch[1]!;
  } catch {
    // Not a URL — assume it's already a bare video id.
  }
  return trimmed;
}

interface RawPart {
  paperCode: string;
  partCode: string;
  title: string;
  instructions: string;
  targetLevel: string | null;
  videoExternalId: string;
  videoStartSeconds: number;
  videoEndSeconds: number;
  items: unknown[];
}

async function main(): Promise<void> {
  const [jsonPath] = process.argv.slice(2);
  if (!jsonPath) {
    console.error('Usage: import-listening-sources.ts <path-to-json-file>');
    process.exit(1);
  }

  const resolvedPath = path.resolve(jsonPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`ERROR: file not found at ${resolvedPath}`);
    process.exit(1);
  }

  const parts = JSON.parse(fs.readFileSync(resolvedPath, 'utf8')) as RawPart[];
  if (!Array.isArray(parts) || parts.length === 0) {
    console.error('ERROR: the JSON file must contain a non-empty array of parts.');
    process.exit(1);
  }

  // Must be set BEFORE requiring the composition module below — TypeORM's
  // DataSource (src/config/database.ts) reads process.env.DATABASE_URL at
  // module-load time, not lazily.
  process.env.DATABASE_URL =
    process.env.DATABASE_URL || readEnvValue(ENV_FILE, STAGE, 'DATABASE_URL');

  console.log(`Stage : ${STAGE}`);
  console.log(`DB    : ${maskDatabaseUrl(process.env.DATABASE_URL)}`);
  console.log(`File  : ${resolvedPath} (${parts.length} part(s))\n`);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {
    buildListeningSourceServices,
  } = require('../src/services/mocks/listening-source-composition');
  const { importSource } = await buildListeningSourceServices();

  let okCount = 0;
  let failCount = 0;

  for (const [index, part] of parts.entries()) {
    const label = `[${index + 1}/${parts.length}] ${part.partCode} — "${part.title}"`;
    try {
      const result = await importSource.execute({
        paperCode: part.paperCode,
        partCode: part.partCode,
        title: part.title,
        instructions: part.instructions,
        targetLevel: part.targetLevel,
        videoExternalId: normalizeVideoId(part.videoExternalId),
        videoStartSeconds: part.videoStartSeconds,
        videoEndSeconds: part.videoEndSeconds,
        items: part.items,
      });
      console.log(`OK   ${label} -> id=${result.id} items=${result.itemCount}`);
      okCount += 1;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`FAIL ${label} -> ${message}`);
      failCount += 1;
    }
  }

  console.log(`\nDone: ${okCount} imported, ${failCount} failed.`);
  process.exit(failCount > 0 ? 1 : 0);
}

main();
