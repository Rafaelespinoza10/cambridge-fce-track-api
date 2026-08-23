import {
  StartMockAttemptError,
  StartMockAttemptErrorCode,
} from '../../services/mocks/start-mock-attempt.service';
import {
  StartMockAttemptSectionError,
  StartMockAttemptSectionErrorCode,
} from '../../services/mocks/start-mock-attempt-section.service';
import {
  SubmitMockAttemptSectionError,
  SubmitMockAttemptSectionErrorCode,
} from '../../services/mocks/submit-mock-attempt-section.service';
import {
  SubmitMockAttemptError,
  SubmitMockAttemptErrorCode,
} from '../../services/mocks/submit-mock-attempt.service';
import {
  AbandonMockAttemptError,
  AbandonMockAttemptErrorCode,
} from '../../services/mocks/abandon-mock-attempt.service';
import {
  GetMockAttemptError,
  GetMockAttemptErrorCode,
} from '../../services/mocks/get-mock-attempt.service';
import {
  ImportListeningSourceError,
  ImportListeningSourceErrorCode,
} from '../../services/mocks/import-listening-source.service';
import {
  GetMockAttemptSectionResultError,
  GetMockAttemptSectionResultErrorCode,
} from '../../services/mocks/get-mock-attempt-section-result.service';
import {
  SaveMockAttemptSectionDraftError,
  SaveMockAttemptSectionDraftErrorCode,
} from '../../services/mocks/save-mock-attempt-section-draft.service';
import {
  GetMockAttemptResultError,
  GetMockAttemptResultErrorCode,
} from '../../services/mocks/get-mock-attempt-result.service';
import {
  GenerateMockAttemptItemFlashcardDraftError,
  GenerateMockAttemptItemFlashcardDraftErrorCode,
} from '../../services/mocks/generate-mock-attempt-item-flashcard-draft.service';
import {
  GenerateMockAttemptCorrectionFlashcardDraftError,
  GenerateMockAttemptCorrectionFlashcardDraftErrorCode,
} from '../../services/mocks/generate-mock-attempt-correction-flashcard-draft.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const START_ATTEMPT_STATUS_BY_CODE: Record<StartMockAttemptErrorCode, number> = {
  [StartMockAttemptErrorCode.INVALID_INPUT]: 400,
  [StartMockAttemptErrorCode.RACE_UNRESOLVED]: 409,
};

const START_SECTION_STATUS_BY_CODE: Record<StartMockAttemptSectionErrorCode, number> = {
  [StartMockAttemptSectionErrorCode.INVALID_INPUT]: 400,
  [StartMockAttemptSectionErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [StartMockAttemptSectionErrorCode.SECTION_NOT_FOUND]: 404,
  [StartMockAttemptSectionErrorCode.ATTEMPT_NOT_ACTIVE]: 409,
  [StartMockAttemptSectionErrorCode.LISTENING_NOT_CURATED]: 409,
  [StartMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const SUBMIT_SECTION_STATUS_BY_CODE: Record<SubmitMockAttemptSectionErrorCode, number> = {
  [SubmitMockAttemptSectionErrorCode.INVALID_INPUT]: 400,
  [SubmitMockAttemptSectionErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [SubmitMockAttemptSectionErrorCode.SECTION_NOT_FOUND]: 404,
  [SubmitMockAttemptSectionErrorCode.ATTEMPT_NOT_ACTIVE]: 409,
  [SubmitMockAttemptSectionErrorCode.SECTION_NOT_STARTED]: 409,
  [SubmitMockAttemptSectionErrorCode.AI_RATE_LIMITED]: 429,
  [SubmitMockAttemptSectionErrorCode.AI_INVALID_RESPONSE]: 502,
  [SubmitMockAttemptSectionErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [SubmitMockAttemptSectionErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [SubmitMockAttemptSectionErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [SubmitMockAttemptSectionErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const SUBMIT_ATTEMPT_STATUS_BY_CODE: Record<SubmitMockAttemptErrorCode, number> = {
  [SubmitMockAttemptErrorCode.INVALID_INPUT]: 400,
  [SubmitMockAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [SubmitMockAttemptErrorCode.ATTEMPT_ABANDONED]: 409,
  [SubmitMockAttemptErrorCode.SECTIONS_NOT_COMPLETE]: 409,
  [SubmitMockAttemptErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const ABANDON_STATUS_BY_CODE: Record<AbandonMockAttemptErrorCode, number> = {
  [AbandonMockAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [AbandonMockAttemptErrorCode.ATTEMPT_COMPLETED]: 409,
};

const GET_STATUS_BY_CODE: Record<GetMockAttemptErrorCode, number> = {
  [GetMockAttemptErrorCode.ATTEMPT_NOT_FOUND]: 404,
};

const IMPORT_LISTENING_SOURCE_STATUS_BY_CODE: Record<ImportListeningSourceErrorCode, number> = {
  [ImportListeningSourceErrorCode.INVALID_INPUT]: 400,
};

const GET_SECTION_RESULT_STATUS_BY_CODE: Record<GetMockAttemptSectionResultErrorCode, number> = {
  [GetMockAttemptSectionResultErrorCode.SECTION_NOT_FOUND]: 404,
};

const SAVE_SECTION_DRAFT_STATUS_BY_CODE: Record<SaveMockAttemptSectionDraftErrorCode, number> = {
  [SaveMockAttemptSectionDraftErrorCode.INVALID_INPUT]: 400,
  [SaveMockAttemptSectionDraftErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [SaveMockAttemptSectionDraftErrorCode.SECTION_NOT_FOUND]: 404,
  [SaveMockAttemptSectionDraftErrorCode.ATTEMPT_NOT_ACTIVE]: 409,
  [SaveMockAttemptSectionDraftErrorCode.SECTION_NOT_STARTED]: 409,
  [SaveMockAttemptSectionDraftErrorCode.SECTION_ALREADY_COMPLETED]: 409,
  [SaveMockAttemptSectionDraftErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const GET_RESULT_STATUS_BY_CODE: Record<GetMockAttemptResultErrorCode, number> = {
  [GetMockAttemptResultErrorCode.ATTEMPT_NOT_FOUND]: 404,
  [GetMockAttemptResultErrorCode.ATTEMPT_NOT_FINISHED]: 409,
  [GetMockAttemptResultErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const GENERATE_ITEM_FLASHCARD_DRAFT_STATUS_BY_CODE: Record<
  GenerateMockAttemptItemFlashcardDraftErrorCode,
  number
> = {
  [GenerateMockAttemptItemFlashcardDraftErrorCode.INVALID_INPUT]: 400,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.SECTION_NOT_FOUND]: 404,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_FOUND]: 404,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.SECTION_NOT_COMPLETED]: 409,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.ITEM_NOT_INCORRECT]: 409,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.AI_RATE_LIMITED]: 429,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.AI_INVALID_RESPONSE]: 502,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GenerateMockAttemptItemFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

const GENERATE_CORRECTION_FLASHCARD_DRAFT_STATUS_BY_CODE: Record<
  GenerateMockAttemptCorrectionFlashcardDraftErrorCode,
  number
> = {
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.INVALID_INPUT]: 400,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.SECTION_NOT_FOUND]: 404,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.CORRECTION_NOT_FOUND]: 404,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.SECTION_NOT_GRADED]: 409,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_RATE_LIMITED]: 429,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_INVALID_RESPONSE]: 502,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_PROVIDER_UNAVAILABLE]: 503,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_REQUEST_TIMEOUT]: 504,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.AI_CONFIGURATION_ERROR]: 500,
  [GenerateMockAttemptCorrectionFlashcardDraftErrorCode.PERSISTENCE_INCONSISTENCY]: 500,
};

/**
 * Translates every full-mock-attempt-domain error (start/start-section/
 * submit-section/submit/abandon/get, plus the admin Listening import) into
 * an Error with `statusCode`, consumable by @lib/response's handleError. An
 * unrecognized error passes through untouched — handleError treats it as 500
 * and masks the message.
 */
function mapMockAttemptError(error: unknown): unknown {
  if (error instanceof StartMockAttemptError) {
    return httpError(error.message, START_ATTEMPT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof StartMockAttemptSectionError) {
    return httpError(error.message, START_SECTION_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SubmitMockAttemptSectionError) {
    return httpError(error.message, SUBMIT_SECTION_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SubmitMockAttemptError) {
    const message =
      error.incompleteSectionCodes.length > 0
        ? `${error.message}: ${error.incompleteSectionCodes.join(', ')}`
        : error.message;
    return httpError(message, SUBMIT_ATTEMPT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof AbandonMockAttemptError) {
    return httpError(error.message, ABANDON_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GetMockAttemptError) {
    return httpError(error.message, GET_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof ImportListeningSourceError) {
    return httpError(error.message, IMPORT_LISTENING_SOURCE_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GetMockAttemptSectionResultError) {
    return httpError(error.message, GET_SECTION_RESULT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof SaveMockAttemptSectionDraftError) {
    return httpError(error.message, SAVE_SECTION_DRAFT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GetMockAttemptResultError) {
    return httpError(error.message, GET_RESULT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GenerateMockAttemptItemFlashcardDraftError) {
    return httpError(error.message, GENERATE_ITEM_FLASHCARD_DRAFT_STATUS_BY_CODE[error.code]);
  }
  if (error instanceof GenerateMockAttemptCorrectionFlashcardDraftError) {
    return httpError(
      error.message,
      GENERATE_CORRECTION_FLASHCARD_DRAFT_STATUS_BY_CODE[error.code],
    );
  }
  return error;
}

export { mapMockAttemptError };
