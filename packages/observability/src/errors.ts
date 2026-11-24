export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(message: string, code = 'INTERNAL_ERROR', statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict detected') {
    super(message, 'CONFLICT', 409);
  }
}

export class CsrfError extends AppError {
  constructor(message = 'Invalid or missing CSRF token') {
    super(message, 'CSRF_INVALID', 403);
  }
}

export interface SanitizedErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function formatErrorResponse(err: unknown): { statusCode: number; body: SanitizedErrorResponse } {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: {
        error: {
          code: err.code,
          message: err.message,
          details: err.details
        }
      }
    };
  }

  // Handle Fastify schema validation errors
  const fastifyErr = err as { code?: string; validation?: unknown; message?: string; statusCode?: number };
  if (fastifyErr && (fastifyErr.code === 'FST_ERR_VALIDATION' || fastifyErr.statusCode === 400 || Boolean(fastifyErr.validation))) {
    return {
      statusCode: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: fastifyErr.message || 'Request validation failed.',
          details: fastifyErr.validation || fastifyErr.message
        }
      }
    };
  }

  // Handle DomainError from @thaara/db or other typed domain error classes
  const domainErr = err as { code?: string; statusCode?: number; message?: string; details?: unknown };
  if (domainErr && typeof domainErr.statusCode === 'number' && typeof domainErr.code === 'string') {
    return {
      statusCode: domainErr.statusCode,
      body: {
        error: {
          code: domainErr.code,
          message: domainErr.message || 'Error processing request',
          details: domainErr.details
        }
      }
    };
  }

  // Never leak internal unhandled exception messages or stack traces in responses
  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An internal error occurred. Please try again later.'
      }
    }
  };
}
