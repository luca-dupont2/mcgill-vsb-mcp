import { describe, expect, it } from 'vitest';
import { parseSeats, parseSeatSettings } from '../src/adapters/seats.js';
import { parseSections } from '../src/adapters/parsing.js';
import { normalizeTerm, presentCourseSections } from '../src/models.js';
import { presentSectionsView } from '../src/tools/response-view.js';
import { fixture } from './helpers.js';

const exact = { specificCounts: true, reservedCounts: false };
const block = {
  u: 'false',
  os: '12',
  me: '100',
  isFull: '0',
  ws: '7',
  wc: '10',
  csos: '-1',
  csme: '-1',
  nres: '12',
  c: 'false',
  custstat: '',
};
describe('VSB seat observations', () => {
  it('reports remaining seats and derives enrollment only from known capacity', () => {
    expect(parseSeats(block, exact)).toMatchObject({
      status: 'available',
      remaining: 12,
      capacity: 100,
      enrolled: 88,
      non_reserved_remaining: null,
      reserved_remaining: null,
      combined: { remaining: null, capacity: null, enrolled: null },
      waitlist: {
        status: 'available',
        remaining: 7,
        capacity: 10,
        enrolled: 3,
      },
    });
    expect(parseSeats({ ...block, me: '-1' }, exact)).toMatchObject({
      remaining: 12,
      capacity: null,
      enrolled: null,
    });
  });
  it('distinguishes full sections, full waitlists, and no waitlist', () => {
    expect(
      parseSeats({ ...block, os: '0', isFull: '1', ws: '0' }, exact),
    ).toMatchObject({
      status: 'full',
      remaining: 0,
      enrolled: 100,
      waitlist: { status: 'full', remaining: 0, enrolled: 10 },
    });
    expect(parseSeats({ ...block, ws: '0', wc: '0' }, exact).waitlist).toEqual({
      status: 'none',
      remaining: 0,
      capacity: 0,
      enrolled: 0,
    });
  });
  it('does not treat unknown, unlimited, missing, malformed or negative sentinels as counts', () => {
    for (const u of ['true', undefined]) {
      expect(parseSeats({ ...block, u }, exact)).toMatchObject({
        status: 'unknown',
        remaining: null,
        capacity: null,
        enrolled: null,
        waitlist: { status: 'unknown', remaining: null, capacity: null },
      });
    }
    expect(parseSeats({ ...block, os: '9999' }, exact)).toMatchObject({
      status: 'unlimited',
      remaining: null,
      capacity: null,
      enrolled: null,
    });
    for (const os of ['-1', '', 'bad', '9007199254740992', undefined]) {
      expect(parseSeats({ ...block, os }, exact).remaining).toBeNull();
    }
    expect(parseSeats({}, exact).waitlist.status).toBe('unknown');
    expect(parseSeats({ ...block, os: '110' }, exact).enrolled).toBeNull();
    expect(
      parseSeats({ ...block, ws: '12' }, exact).waitlist.enrolled,
    ).toBeNull();
  });
  it('reports combined section counts separately and respects closed/cancelled status', () => {
    expect(
      parseSeats({ ...block, csos: '5', csme: '150', c: 'true' }, exact),
    ).toMatchObject({
      status: 'closed',
      combined: { remaining: 5, capacity: 150, enrolled: 145 },
    });
    expect(parseSeats({ ...block, custstat: 'X' }, exact).status).toBe(
      'cancelled',
    );
    expect(parseSeats({ ...block, custstat: 'F' }, exact).status).toBe('full');
  });
  it('does not invent reservation counts when reporting is disabled', () => {
    const b = { ...block, nres: '4' };
    expect(parseSeats(b, exact).reserved_remaining).toBeNull();
    expect(parseSeats(b, { ...exact, reservedCounts: true })).toMatchObject({
      non_reserved_remaining: 4,
      reserved_remaining: 8,
    });
    expect(
      parseSeats({ ...b, nres: '20' }, { ...exact, reservedCounts: true })
        .reserved_remaining,
    ).toBeNull();
  });
  it('suppresses approximate count values when exact counts are disabled', () => {
    expect(
      parseSeats(block, { specificCounts: false, reservedCounts: true }),
    ).toMatchObject({
      status: 'available',
      remaining: null,
      capacity: null,
      enrolled: null,
      non_reserved_remaining: null,
      reserved_remaining: null,
      waitlist: {
        status: 'available',
        remaining: null,
        capacity: null,
        enrolled: null,
      },
    });
    expect(
      parseSeatSettings(
        'var inspecificSeats = false; var onReservedFilter = true;',
      ),
    ).toEqual({ specificCounts: true, reservedCounts: true });
    expect(parseSeatSettings('var inspecificSeats = true;')).toEqual({
      specificCounts: false,
      reservedCounts: false,
    });
    expect(parseSeatSettings('throw new Error("never execute");')).toEqual({
      specificCounts: false,
      reservedCounts: false,
    });
  });
  it('retains seat observations through source parsing and both response views', () => {
    const course = parseSections(
      fixture('comp202-winter2027.xml'),
      'COMP 202',
      normalizeTerm('2027 Winter'),
    );
    const seats = course.sections[0]!.seats;
    expect(seats).toMatchObject({
      status: 'available',
      capacity: null,
      enrolled: null,
    });
    expect(presentCourseSections(course).sections[0]!.seats).toEqual(seats);
    expect(presentSectionsView(course, 'compact').sections[0]!.seats).toEqual(
      seats,
    );
  });
});
