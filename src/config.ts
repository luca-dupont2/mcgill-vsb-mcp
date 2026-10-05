import { AppError } from './errors.js';
function milliseconds(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) < minimum ||
    Number(raw) > 86400000
  )
    throw new AppError(
      'invalid_configuration',
      `${name} must be an integer between ${minimum} and 86400000.`,
    );
  return Number(raw);
}
export function adapterConfig() {
  return {
    ttlMs: milliseconds('MCGILL_CACHE_TTL_MS', 300000, 0),
    timeoutMs: milliseconds('MCGILL_TIMEOUT_MS', 15000, 100),
  };
}
