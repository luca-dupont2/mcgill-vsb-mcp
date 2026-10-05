import { describe, expect, it } from 'vitest';
import {
  checkConflicts,
  generateSchedules,
  meetingOverlap,
} from '../src/scheduling.js';
import { course, meeting, section } from './helpers.js';

describe('meeting conflicts', () => {
  it.each([
    [meeting(780, 840), meeting(810, 870), true],
    [meeting(780, 840), meeting(840, 900), false],
    [meeting(780, 840), meeting(780, 840, ['wednesday']), false],
    [
      meeting(780, 840, ['tuesday', 'thursday']),
      meeting(810, 870, ['thursday', 'friday']),
      true,
    ],
    [
      meeting(780, 840, ['tuesday'], {
        startDate: '2027-01-01',
        endDate: '2027-02-01',
      }),
      meeting(780, 840, ['tuesday'], {
        startDate: '2027-02-02',
        endDate: '2027-04-01',
      }),
      false,
    ],
    [
      meeting(780, 840, ['tuesday'], {
        startDate: '2027-01-01',
        endDate: '2027-02-02',
      }),
      meeting(780, 840, ['tuesday'], {
        startDate: '2027-02-02',
        endDate: '2027-04-01',
      }),
      true,
    ],
    // Intersecting date bounds with no occurrence of the shared weekday.
    [
      meeting(780, 840, ['tuesday'], {
        startDate: '2027-01-04',
        endDate: '2027-01-04',
      }),
      meeting(780, 840, ['tuesday']),
      false,
    ],
    [
      meeting(780, 840, ['tuesday'], { startDate: '2027-01-01' }),
      meeting(780, 840, ['tuesday'], { endDate: '2026-12-31' }),
      false,
    ],
    [
      meeting(780, 840, ['sunday'], {
        startDate: '2027-01-03',
        endDate: '2027-01-03',
      }),
      meeting(780, 840, ['sunday']),
      true,
    ],
  ])('applies time, weekday, and date bounds %#', (a, b, conflict) =>
    expect(!!meetingOverlap(a, b)).toBe(conflict),
  );
  it('returns precise intersection details', () => {
    const result = checkConflicts([
      section('A', [meeting(780, 840, ['tuesday', 'thursday'])]),
      section('B', [meeting(810, 870, ['thursday', 'friday'])]),
    ]);
    expect(result).toMatchObject({
      conflict: true,
      complete: false,
      overlaps: [
        { a: 'A', b: 'B', days: ['thursday'], start: '13:30', end: '14:00' },
      ],
    });
  });
  it.each([{}, { startDate: '2027-01-04' }, { endDate: '2027-01-31' }])(
    'labels missing date bounds as possible conflicts: %j',
    (bounds) => {
      const result = checkConflicts([
        section('A', [meeting(600, 660, ['monday'], bounds)]),
        section('B', [
          meeting(630, 690, ['monday'], {
            startDate: '2027-01-04',
            endDate: '2027-01-31',
          }),
        ]),
      ]);
      expect(result).toMatchObject({
        conflict: true,
        complete: false,
        overlaps: [{ certainty: 'possible' }],
      });
      expect(result.warnings.join(' ')).toContain(
        'missing meeting date bounds',
      );
    },
  );
  it('confirms overlaps only with all date bounds and reports undated non-overlaps as incomplete', () => {
    const bounds = { startDate: '2027-01-04', endDate: '2027-01-31' };
    expect(
      checkConflicts([
        section('A', [meeting(600, 660, ['monday'], bounds)]),
        section('B', [meeting(630, 690, ['monday'], bounds)]),
      ]),
    ).toMatchObject({ complete: true, overlaps: [{ certainty: 'confirmed' }] });
    expect(
      checkConflicts([
        section('A', [meeting(600, 660)]),
        section('B', [meeting(660, 720)]),
      ]),
    ).toMatchObject({ conflict: false, complete: false });
  });
  it('checks every meeting and deduplicates identical section input', () => {
    const a = section('A', [meeting(600, 660, ['monday']), meeting(780, 840)]);
    expect(
      checkConflicts([a, a, section('B', [meeting(810, 870)])]).overlaps,
    ).toHaveLength(1);
  });
  it('rejects conflicting duplicates and mixed terms', () => {
    expect(() =>
      checkConflicts([section('A', []), section('A', [meeting(600, 660)])]),
    ).toThrow('different data');
    expect(() =>
      checkConflicts([
        section('A', []),
        section('B', [], { term: '2026 Fall' }),
      ]),
    ).toThrow('same term');
  });
  it('exposes unknown times rather than claiming complete safety', () => {
    expect(
      checkConflicts([section('A', []), section('B', [meeting(600, 660)])]),
    ).toMatchObject({ conflict: false, complete: false });
  });
});

describe('schedule enumeration', () => {
  const datedMeeting = (...args: Parameters<typeof meeting>) => ({
    ...meeting(...args),
    startDate: '2027-01-04',
    endDate: '2027-01-31',
  });
  const a = course('A', [
    section('A-001', [datedMeeting(600, 660, ['monday'])]),
    section('A-002', [datedMeeting(720, 780, ['monday'])]),
  ]);
  const b = course('B', [
    section('B-001', [datedMeeting(630, 690, ['monday'])]),
    section('B-002', [datedMeeting(600, 660, ['tuesday'])]),
  ]);
  it('counts verified and provisional combinations across the entire search, including omitted results', () => {
    const mixed = course('C', [
      section('A-UNTIMED', []),
      section('B-UNDATED', [meeting(600, 660)]),
      section('C-VERIFIED', [datedMeeting(600, 660)]),
    ]);
    const result = generateSchedules([mixed], { maxResults: 1 });
    expect(result).toMatchObject({
      returned: 1,
      candidate_schedules_found: 3,
      valid_schedules_found: 1,
      provisional_schedules_found: 2,
      results_truncated: true,
      verification_complete: false,
    });
    expect(result.schedules[0]!.complete).toBe(false);
    expect(result.warnings.join(' ')).toContain('provisional');
    const onlyUnknown = generateSchedules([course('U', [section('U', [])])]);
    expect(onlyUnknown).toMatchObject({
      valid_schedules_found: 0,
      provisional_schedules_found: 1,
      candidate_schedules_found: 1,
    });
  });
  it('returns exactly three valid combinations', () => {
    const result = generateSchedules([a, b]);
    expect(result.schedules.map((s) => s.sections)).toEqual([
      ['A-001', 'B-002'],
      ['A-002', 'B-001'],
      ['A-002', 'B-002'],
    ]);
    expect(result.valid_schedules_found).toBe(3);
    expect(result.search_complete).toBe(true);
  });
  it('preserves lecture/lab/tutorial bundles, without inventing combinations', () => {
    const lecture1 = section('L1', [datedMeeting(600, 660, ['monday'])]);
    const lecture2 = section('L2', [datedMeeting(660, 720, ['monday'])]);
    const lab1 = section('LAB1', [datedMeeting(600, 660, ['tuesday'])], {
      component: 'lab',
    });
    const lab2 = section('LAB2', [datedMeeting(660, 720, ['tuesday'])], {
      component: 'lab',
    });
    const tut = section('TUT', [datedMeeting(600, 660, ['wednesday'])], {
      component: 'tutorial',
    });
    const linked = course(
      'C',
      [lecture1, lecture2, lab1, lab2, tut],
      [
        ['L1', 'LAB1', 'TUT'],
        ['L2', 'LAB2', 'TUT'],
      ],
    );
    expect(
      generateSchedules([linked]).schedules.map((s) => s.sections),
    ).toEqual(
      [
        ['L1', 'LAB1', 'TUT'],
        ['L2', 'LAB2', 'TUT'],
      ].map((x) => x.sort()),
    );
  });
  it('removes inactive sections and internally conflicting bundles', () => {
    const c = course(
      'C',
      [
        section('C1', [datedMeeting(600, 660)], { active: false }),
        section('C2', [datedMeeting(600, 660)]),
        section('C3', [datedMeeting(630, 690)]),
      ],
      [['C1'], ['C2', 'C3']],
    );
    expect(generateSchedules([c]).schedules).toEqual([]);
  });
  it('returns no schedules for a course without sections', () =>
    expect(generateSchedules([course('EMPTY', [])]).schedules).toEqual([]));
  it('rejects missing linkage, missing bundle references, duplicates, and mixed terms', () => {
    expect(() => generateSchedules([{ ...a, linkage: 'unavailable' }])).toThrow(
      'linkage',
    );
    expect(() => generateSchedules([{ ...a, bundles: [['missing']] }])).toThrow(
      'missing section',
    );
    expect(() => generateSchedules([a, a])).toThrow('only once');
    expect(() => generateSchedules([a, { ...b, term: '2026 Fall' }])).toThrow(
      'one term',
    );
  });
  it('ranks soft preferences without removing valid schedules', () => {
    const result = generateSchedules([a, b], {
      preferences: {
        prefer_days_off: true,
        minimize_gaps: true,
        avoid_before: '11:00',
      },
    });
    expect(result.schedules).toHaveLength(3);
    expect(result.schedules[0]!.sections).toEqual(['A-002', 'B-001']);
    expect(result.schedules[0]).toMatchObject({
      earliest_start: '10:30',
      latest_end: '13:00',
      days_on_campus: 1,
      total_gap_minutes: 120,
    });
  });
  it('can prefer schedules without Friday classes', () => {
    const c = course('C', [
      section('FRI', [datedMeeting(600, 660, ['friday'])]),
      section('MON', [datedMeeting(600, 660, ['monday'])]),
    ]);
    expect(
      generateSchedules([c], { preferences: { avoid_days: ['friday'] } })
        .schedules[0]!.sections,
    ).toEqual(['MON']);
  });
  it('exposes output and search limits independently', () => {
    expect(generateSchedules([a, b], { maxResults: 1 })).toMatchObject({
      returned: 1,
      valid_schedules_found: 3,
      search_complete: true,
      results_truncated: true,
    });
    expect(generateSchedules([a, b], { maxNodes: 1 })).toMatchObject({
      search_complete: false,
      results_truncated: true,
      search_nodes_visited: 1,
    });
  });
  it('warns when untimed sections occur', () =>
    expect(
      generateSchedules([course('C', [section('UNKNOWN', [])])]).schedules[0]!
        .complete,
    ).toBe(false));
  it('merges touching daily intervals for gap calculation', () => {
    const c = course('C', [
      section('A', [
        datedMeeting(600, 660),
        datedMeeting(660, 720),
        datedMeeting(750, 800),
      ]),
    ]);
    expect(generateSchedules([c]).schedules[0]!.total_gap_minutes).toBe(120);
  });
});
