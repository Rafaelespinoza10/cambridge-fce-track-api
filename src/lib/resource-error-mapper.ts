import { ResourceError, ResourceErrorCode } from '../services/resources/resources.service';

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

const RESOURCE_STATUS_BY_CODE: Record<ResourceErrorCode, number> = {
  [ResourceErrorCode.INVALID_INPUT]: 400,
  [ResourceErrorCode.RESOURCE_NOT_FOUND]: 404,
  [ResourceErrorCode.RESOURCE_NOT_DELETABLE]: 403,
};

function mapResourceError(error: unknown): unknown {
  if (error instanceof ResourceError) {
    return httpError(error.message, RESOURCE_STATUS_BY_CODE[error.code]);
  }
  return error;
}

export { mapResourceError };
