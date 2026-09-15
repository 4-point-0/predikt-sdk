export class PrediktApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'PrediktApiError';
  }
}

/** 400 — request failed validation */
export class PrediktValidationError extends PrediktApiError {
  constructor(message: string, code?: string) {
    super(400, message, code);
    this.name = 'PrediktValidationError';
  }
}

/** 401 / 403 — unauthenticated or forbidden */
export class PrediktAuthError extends PrediktApiError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, code);
    this.name = 'PrediktAuthError';
  }
}

/** 404 — resource not found */
export class PrediktNotFoundError extends PrediktApiError {
  constructor(message: string, code?: string) {
    super(404, message, code);
    this.name = 'PrediktNotFoundError';
  }
}

/** 409 — conflict with current state */
export class PrediktConflictError extends PrediktApiError {
  constructor(message: string, code?: string) {
    super(409, message, code);
    this.name = 'PrediktConflictError';
  }
}

/** 429 — integrator or per-IP rate limit exceeded */
export class PrediktRateLimitError extends PrediktApiError {
  constructor(
    message: string,
    code?: string,
    /** Seconds to wait before retrying, parsed from the Retry-After header */
    public readonly retryAfter?: number,
  ) {
    super(429, message, code);
    this.name = 'PrediktRateLimitError';
  }
}

/** 500 — server-side failure */
export class PrediktInternalError extends PrediktApiError {
  constructor(message: string, code?: string) {
    super(500, message, code);
    this.name = 'PrediktInternalError';
  }
}

export function buildApiError(
  status: number,
  message: string,
  code?: string,
  retryAfter?: number,
): PrediktApiError {
  switch (status) {
    case 400: return new PrediktValidationError(message, code);
    case 401:
    case 403: return new PrediktAuthError(status, message, code);
    case 404: return new PrediktNotFoundError(message, code);
    case 409: return new PrediktConflictError(message, code);
    case 429: return new PrediktRateLimitError(message, code, retryAfter);
    case 500: return new PrediktInternalError(message, code);
    default:  return new PrediktApiError(status, message, code);
  }
}
