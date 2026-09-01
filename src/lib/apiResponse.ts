import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from './errors';

export function ok<T>(data: T, init?: number | ResponseInit) {
  const responseInit = typeof init === 'number' ? { status: init } : init;
  return NextResponse.json({ data }, responseInit);
}

export function fail(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_error',
          message: 'Request failed validation.',
          details: error.flatten(),
        },
      },
      { status: 422 },
    );
  }
  // eslint-disable-next-line no-console
  console.error('[nexora] unhandled error', error);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong.' } },
    { status: 500 },
  );
}
