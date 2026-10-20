/** Extra, response-safe fields the API attaches to some errors (`details` in the error body). */
export interface PrediktErrorDetails {
  /** Set when an order was recorded before the error: poll it instead of placing a new one. */
  orderId?: string;
  /** Provider outages: `true` when repeating the same request (same idempotency key) may succeed. */
  retryable?: boolean;
  [key: string]: unknown;
}

export class PrediktApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: PrediktErrorDetails,
  ) {
    super(message);
    this.name = 'PrediktApiError';
  }

  /** Alias of `status`, matching the `statusCode` field of the API's error body. */
  get statusCode(): number {
    return this.status;
  }

  /** `details.orderId`: the order recorded before the error, if any. */
  get orderId(): string | undefined {
    const id = this.details?.orderId;
    return typeof id === 'string' ? id : undefined;
  }

  /** `details.retryable`: whether repeating the same request may succeed; undefined if not stated. */
  get retryable(): boolean | undefined {
    const retryable = this.details?.retryable;
    return typeof retryable === 'boolean' ? retryable : undefined;
  }
}

/** 400 — request failed validation */
export class PrediktValidationError extends PrediktApiError {
  constructor(message: string, code?: string, details?: PrediktErrorDetails) {
    super(400, message, code, details);
    this.name = 'PrediktValidationError';
  }
}

/** 401 / 403 — unauthenticated or forbidden */
export class PrediktAuthError extends PrediktApiError {
  constructor(status: number, message: string, code?: string, details?: PrediktErrorDetails) {
    super(status, message, code, details);
    this.name = 'PrediktAuthError';
  }
}

/** 404 — resource not found */
export class PrediktNotFoundError extends PrediktApiError {
  constructor(message: string, code?: string, details?: PrediktErrorDetails) {
    super(404, message, code, details);
    this.name = 'PrediktNotFoundError';
  }
}

/** 409 — conflict with current state */
export class PrediktConflictError extends PrediktApiError {
  constructor(message: string, code?: string, details?: PrediktErrorDetails) {
    super(409, message, code, details);
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
    details?: PrediktErrorDetails,
  ) {
    super(429, message, code, details);
    this.name = 'PrediktRateLimitError';
  }
}

/** 500 — server-side failure */
export class PrediktInternalError extends PrediktApiError {
  constructor(message: string, code?: string, details?: PrediktErrorDetails) {
    super(500, message, code, details);
    this.name = 'PrediktInternalError';
  }
}

/** 503 — a provider (Privy, Polymarket) is unavailable; check `retryable` */
export class PrediktServiceUnavailableError extends PrediktApiError {
  constructor(message: string, code?: string, details?: PrediktErrorDetails) {
    super(503, message, code, details);
    this.name = 'PrediktServiceUnavailableError';
  }
}

export function buildApiError(
  status: number,
  message: string,
  code?: string,
  retryAfter?: number,
  details?: PrediktErrorDetails,
): PrediktApiError {
  switch (status) {
    case 400: return new PrediktValidationError(message, code, details);
    case 401:
    case 403: return new PrediktAuthError(status, message, code, details);
    case 404: return new PrediktNotFoundError(message, code, details);
    case 409: return new PrediktConflictError(message, code, details);
    case 429: return new PrediktRateLimitError(message, code, retryAfter, details);
    case 500: return new PrediktInternalError(message, code, details);
    case 503: return new PrediktServiceUnavailableError(message, code, details);
    default:  return new PrediktApiError(status, message, code, details);
  }
}
