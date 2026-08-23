import OpenAI from 'openai';

import { getDatabaseConnection } from '@lib/shared/database';
import { LLMServiceError, LLMErrorCode } from '../llm/llm.types';
import { OpenAIEmbeddingClient } from './embed-cambridge-chunks';
import { SearchCambridgeKnowledgeService } from './search-cambridge-knowledge.service';

/**
 * Search-only slice of the Cambridge Knowledge Base wiring, for the
 * generation features that ground their prompts in the corpus (Practice,
 * Daily Session, and Mock sections via Practice).
 *
 * Deliberately a SEPARATE FILE from cambridge-knowledge-composition.ts, not
 * another export inside it: that module imports ImportCambridgeKnowledgeService,
 * whose graph reaches cambridge-pdf-extractor.ts -> `pdf-parse`. Bundling
 * pdf-parse is not merely wasteful here, it's fatal — pdf-parse@1.1.1's
 * index.js runs a leftover debug block at require time whenever
 * `module.parent` is falsy (always true inside an esbuild CJS bundle):
 *
 *   let isDebugMode = !module.parent;
 *   if (isDebugMode) { Fs.readFileSync('./test/data/05-versions-space.pdf') }
 *
 * That file doesn't exist in a Lambda, so every function whose bundle reached
 * it died on cold start with `ENOENT: ./test/data/05-versions-space.pdf`
 * before any handler code ran (API Gateway surfaced a bare 500). Keeping the
 * import pipeline out of this module's graph is what keeps it out of those
 * bundles — so don't "tidy up" by re-exporting this from the full
 * composition, and don't import ImportCambridgeKnowledgeService here.
 *
 * The admin PDF-import endpoint still needs the full composition (and so
 * still bundles pdf-parse); that path is exercised via the local scripts in
 * scripts/import-cambridge-pdf*.ts today, and fixing it needs a real change
 * to how pdf-parse is loaded/packaged rather than a composition split.
 */

let _openaiClient: OpenAI | null = null;

/** Reuses the OpenAI client across Lambda warm invocations. */
function getOpenAIClient(): OpenAI {
  if (_openaiClient !== null) {
    return _openaiClient;
  }

  const apiKey = process.env['OPEN_AI_API_KEY'];
  if (!apiKey) {
    throw new LLMServiceError('OPEN_AI_API_KEY is not configured', LLMErrorCode.NOT_CONFIGURED);
  }

  _openaiClient = new OpenAI({ apiKey });
  return _openaiClient;
}

interface CambridgeKnowledgeSearchServices {
  searchKnowledge: SearchCambridgeKnowledgeService;
}

async function buildCambridgeKnowledgeSearchServices(): Promise<CambridgeKnowledgeSearchServices> {
  const dataSource = await getDatabaseConnection();
  const embeddingClient = new OpenAIEmbeddingClient(
    getOpenAIClient(),
    process.env['OPENAI_EMBEDDING_MODEL'],
  );

  return {
    searchKnowledge: new SearchCambridgeKnowledgeService(dataSource, { embeddingClient }),
  };
}

export { buildCambridgeKnowledgeSearchServices };
export type { CambridgeKnowledgeSearchServices };
