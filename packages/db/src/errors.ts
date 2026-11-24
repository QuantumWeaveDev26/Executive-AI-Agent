export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Requested resource not found or unauthorized') {
    super(message, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Resource state conflict') {
    super(message, 'CONFLICT', 409);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Permission denied by policy') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class ValidationError extends DomainError {
  constructor(message = 'Invalid input parameters') {
    super(message, 'VALIDATION_ERROR', 400);
  }
}

export function sanitizeDatabaseError(err: unknown): DomainError {
  if (err instanceof DomainError) {
    return err;
  }

  const pgErr = err as { code?: string; message?: string };
  const code = pgErr?.code;
  const rawMsg = pgErr?.message || '';

  // 23505: unique_violation
  if (code === '23505') {
    if (rawMsg.includes('uq_memory_active_user')) {
      return new ConflictError('An active memory item with this key already exists in this scope.');
    }
    if (rawMsg.includes('worker_dispatch_outbox') || rawMsg.includes('dedup')) {
      return new ConflictError('A dispatch job with this deduplication key already exists.');
    }
    return new ConflictError('A resource with these unique attributes already exists.');
  }

  // 23503: foreign_key_violation
  if (code === '23503') {
    return new NotFoundError('Referenced parent resource does not exist or is unauthorized.');
  }

  // 42501: insufficient_privilege / RLS denial
  if (code === '42501') {
    return new ForbiddenError('Operation denied by security policy.');
  }

  // P0001: raise_exception
  if (code === 'P0001') {
    if (rawMsg.includes('already consented')) {
      return new ConflictError('Memory item is already consented.');
    }
    if (rawMsg.includes('already revoked')) {
      return new ConflictError('Memory item is already revoked.');
    }
    if (rawMsg.includes('non-active')) {
      return new ConflictError('Cannot perform operation on non-active memory item.');
    }
    if (rawMsg.includes('Permission denied') || rawMsg.includes('permission denied')) {
      return new ForbiddenError('Permission denied.');
    }
    if (rawMsg.includes('Authentication required')) {
      return new ForbiddenError('Authentication required or invalid session token.');
    }
    if (rawMsg.includes('not found') || rawMsg.includes('does not exist')) {
      return new NotFoundError('Requested resource not found or unauthorized.');
    }
    if (rawMsg.includes('sole owner')) {
      return new ValidationError(rawMsg);
    }
    if (rawMsg.includes('fence violation') || rawMsg.includes('invalid or expired lease')) {
      return new ConflictError(rawMsg);
    }
    if (rawMsg.includes('continuation is currently pending')) {
      return new ConflictError(rawMsg);
    }
    if (rawMsg.includes('Concurrency conflict') || rawMsg.includes('Invalid Stream State Transition')) {
      return new ConflictError(rawMsg);
    }
    return new ValidationError('Operation could not be completed with the provided parameters.');
  }

  return new DomainError('An internal database error occurred.', 'INTERNAL_ERROR', 500);
}
