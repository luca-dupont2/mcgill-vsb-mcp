import type { SeatAvailability } from '../models.js';

export type SeatSettings = {
  specificCounts: boolean;
  reservedCounts: boolean;
};

// Read assignments as data; never execute upstream JavaScript.
export function parseSeatSettings(input: string): SeatSettings {
  return {
    specificCounts: /\bvar\s+inspecificSeats\s*=\s*false\s*;/.test(input),
    reservedCounts: /\bvar\s+onReservedFilter\s*=\s*true\s*;/.test(input),
  };
}

export const seatAttributes = [
  'u',
  'os',
  'me',
  'csos',
  'csme',
  'isFull',
  'ws',
  'wc',
  'c',
  'custstat',
  'nres',
] as const;
type SeatAttributes = Partial<
  Record<(typeof seatAttributes)[number], string | undefined>
>;

function count(value: string | undefined): number | null {
  if (value === undefined || !/^-?\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function taken(
  capacity: number | null,
  remaining: number | null,
): number | null {
  // Negative remaining seats can represent over-enrollment, but are not exposed
  // as usable seats. Do not infer totals from unknown or inconsistent counts.
  return capacity !== null && remaining !== null && remaining <= capacity
    ? capacity - remaining
    : null;
}

/** Independently authored from the public client field labels and sentinel handling. */
export function parseSeats(
  b: SeatAttributes,
  settings: SeatSettings,
): SeatAvailability {
  const unknown = b.u !== 'false';
  const unlimited = !unknown && b.os === '9999';
  const specific = settings.specificCounts && !unknown && !unlimited;
  const remaining = specific ? count(b.os) : null;
  const capacity = specific ? count(b.me) : null;
  const combinedRemaining = specific ? count(b.csos) : null;
  const combinedCapacity = specific ? count(b.csme) : null;
  const nonReserved =
    specific && settings.reservedCounts ? count(b.nres) : null;
  const reserved =
    remaining !== null && nonReserved !== null && nonReserved <= remaining
      ? remaining - nonReserved
      : null;
  const full = b.isFull === '1' || b.custstat === 'F';
  const status: SeatAvailability['status'] =
    b.custstat === 'X'
      ? 'cancelled'
      : b.c === 'true' || b.custstat === 'C'
        ? 'closed'
        : unknown
          ? 'unknown'
          : unlimited
            ? 'unlimited'
            : full
              ? 'full'
              : b.isFull === '0' || b.custstat === 'O'
                ? 'available'
                : 'unknown';
  const waitRemaining = !unknown ? count(b.ws) : null;
  const waitCapacity = !unknown ? count(b.wc) : null;
  const waitStatus: SeatAvailability['waitlist']['status'] =
    waitRemaining !== null && waitRemaining > 0
      ? 'available'
      : waitRemaining === 0 && waitCapacity !== null
        ? waitCapacity > 0
          ? 'full'
          : 'none'
        : 'unknown';
  return {
    status,
    remaining,
    capacity,
    enrolled: taken(capacity, remaining),
    non_reserved_remaining: nonReserved,
    reserved_remaining: reserved,
    combined: {
      remaining: combinedRemaining,
      capacity: combinedCapacity,
      enrolled: taken(combinedCapacity, combinedRemaining),
    },
    waitlist: {
      status: waitStatus,
      remaining: settings.specificCounts ? waitRemaining : null,
      capacity: settings.specificCounts ? waitCapacity : null,
      enrolled: settings.specificCounts
        ? taken(waitCapacity, waitRemaining)
        : null,
    },
  };
}
