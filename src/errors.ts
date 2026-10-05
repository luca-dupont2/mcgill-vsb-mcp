import { ZodError } from 'zod';
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorResult(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) {
    return { error: error.code, message: error.message, ...error.details };
  }
  if (error instanceof ZodError)
    return {
      error: 'invalid_request',
      message: 'Input validation failed.',
      issues: error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    };
  console.error('[mcgill-vsb-mcp] Unexpected error', error);
  return {
    error: 'internal_error',
    message: 'An unexpected server error occurred. Check stderr.',
  };
}
