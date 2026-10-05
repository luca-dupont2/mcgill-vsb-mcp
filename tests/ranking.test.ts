import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { vsbModes, vsbScores } from '../src/vsb-ranking.js';
import type { VsbScoreBlock } from '../src/models.js';
import { parseSections } from '../src/adapters/parsing.js';
import { normalizeTerm } from '../src/models.js';
import { generateSchedules } from '../src/scheduling.js';
import { constraintsSchema, rankingSchema } from '../src/schedule-options.js';
import { course, fixture, meeting, section } from './helpers.js';

// Hand-calculated expectations contain no upstream executable code.
const expectedScores = (
  JSON.parse(fixture('scoring-expectations.json')) as {
    scores: Record<(typeof vsbModes)[number], number>;
  }
).scores;
const epoch = Date.parse('2008-01-01');
function encode(block: VsbScoreBlock) {
  const day = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ].indexOf(block.day);
  const date = (value: string) => (Date.parse(value) - epoch) / 86400000 + 1;
  return [
    ((day * 1440 + block.startMinutes) << 16) | (day * 1440 + block.endMinutes),
    (date(block.startBoundary) << 16) | date(block.endBoundary),
  ];
}
const dated = (
  start: number,
  end: number,
  day: Parameters<typeof meeting>[2] = ['monday'],
  extra = {},
) =>
  meeting(start, end, day, {
    startDate: '2027-01-04',
    endDate: '2027-01-31',
    ...extra,
  });
describe('VSB scoring and source block decoding', () => {
  it('matches all six source formulas across overlapping segments and one-time meetings', () => {
    const blocks: VsbScoreBlock[] = [
      {
        day: 'monday',
        startMinutes: 540,
        endMinutes: 660,
        startBoundary: '2027-01-04',
        endBoundary: '2027-01-31',
      },
      {
        day: 'monday',
        startMinutes: 780,
        endMinutes: 840,
        startBoundary: '2027-01-10',
        endBoundary: '2027-01-24',
      },
      {
        day: 'friday',
        startMinutes: 1080,
        endMinutes: 1200,
        startBoundary: '2027-01-04',
        endBoundary: '2027-01-31',
      },
      {
        day: 'thursday',
        startMinutes: 600,
        endMinutes: 660,
        startBoundary: '2027-01-07',
        endBoundary: '2027-01-07',
      },
    ];
    const actual = vsbScores(blocks);
    vsbModes.forEach((mode) =>
      expect(actual[mode]).toBeCloseTo(expectedScores[mode], 7),
    );
  });
  it.each(['ecse206-winter2027.xml', 'math263-winter2027.xml'])(
    'preserves actual source bundle encoding: %s',
    (name) => {
      const code = name.startsWith('ecse') ? 'ECSE 206' : 'MATH 263';
      const parsed = parseSections(
        fixture(name),
        code,
        normalizeTerm('2027 Winter'),
      );
      const xml = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        parseAttributeValue: false,
        isArray: (n) => n === 'uselection',
      }).parse(fixture(name)) as {
        addcourse: { classdata: { course: { uselection: { bs: string }[] } } };
      };
      const raw = xml.addcourse.classdata.course.uselection;
      Object.values(parsed.bundleScoreBlocks!).forEach((blocks, i) => {
        expect(blocks.flatMap(encode)).toEqual(
          raw[i]!.bs.split(',').map(Number),
        );
      });
    },
  );
  it('keeps empty and single-date scoring distinct from attendance', () => {
    expect(vsbScores([])).toEqual({
      most_days_off: 9999,
      mornings: 0,
      midday_classes: 0,
      evenings: 0,
      time_off_campus: 0,
      most_on_campus: 0,
    });
    expect(
      vsbScores([
        {
          day: 'monday',
          startMinutes: 600,
          endMinutes: 660,
          startBoundary: '2027-01-04',
          endBoundary: '2027-01-04',
        },
      ]),
    ).toEqual({
      most_days_off: 0,
      mornings: 0,
      midday_classes: 0,
      evenings: 0,
      time_off_campus: 0,
      most_on_campus: 0,
    });
  });
  it('ranks larger VSB scores first for every mode, with deterministic ties', () => {
    const c = course('C', [
      section('EARLY', [dated(540, 600)]),
      section('MID', [dated(780, 840)]),
      section('LATE', [dated(1140, 1200)]),
    ]);
    for (const mode of vsbModes) {
      const result = generateSchedules([c], { ranking: { mode } });
      const scores = result.schedules.map((s) => s.ranking.scores[mode]!);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      expect(result.valid_schedules_found).toBe(3);
    }
    expect(
      generateSchedules([c], { ranking: { mode: 'mornings' } }).schedules[0]!
        .sections,
    ).toEqual(['EARLY']);
    expect(
      generateSchedules([c], { ranking: { mode: 'evenings' } }).schedules[0]!
        .sections,
    ).toEqual(['LATE']);
    expect(
      generateSchedules([c], { ranking: { mode: 'midday_classes' } })
        .schedules[0]!.sections,
    ).toEqual(['MID']);
  });
});
describe('agent constraints, ranking and calendar metrics', () => {
  const c = course('C', [
    section('A', [
      dated(600, 660),
      dated(720, 780, ['thursday'], {
        startDate: '2027-01-07',
        endDate: '2027-01-07',
      }),
    ]),
    section('B', [dated(660, 720)]),
  ]);
  it('keeps dated exceptions separate while counting their real attendance', () => {
    const a = generateSchedules([c]).schedules[0]!;
    expect(a.days_on_campus).toBe(1);
    expect(a.attendance).toMatchObject({
      campus_dates: 5,
      total_class_minutes: 300,
      regular_weekdays: ['monday'],
      exceptional_dates: [{ date: '2027-01-07', day: 'thursday' }],
    });
    expect(a.ranking.scores.most_on_campus).toBe(60 * 27);
  });
  it('applies hard exclusions to one-time dates even though VSB gives them zero score', () => {
    const result = generateSchedules([c], {
      constraints: { unavailable_days: ['thursday'] },
    });
    expect(result.schedules.map((s) => s.sections)).toEqual([['B']]);
    expect(result.course_diagnostics[0]!.rejected_bundles).toEqual({
      unavailable_day: 1,
    });
  });
  it('supports inclusive time bounds, pinned and excluded sections', () => {
    expect(
      generateSchedules([c], {
        constraints: { not_before: '11:00', not_after: '12:00' },
      }).schedules[0]!.sections,
    ).toEqual(['B']);
    expect(
      generateSchedules([c], { constraints: { required_section_ids: ['A'] } })
        .returned,
    ).toBe(1);
    expect(
      generateSchedules([c], { constraints: { excluded_section_ids: ['A'] } })
        .schedules[0]!.sections,
    ).toEqual(['B']);
    expect(() =>
      generateSchedules([c], {
        constraints: { required_section_ids: ['missing'] },
      }),
    ).toThrow('not present');
    expect(() =>
      generateSchedules([c], {
        constraints: {
          required_section_ids: ['A'],
          excluded_section_ids: ['A'],
        },
      }),
    ).toThrow('both required');
  });
  it('respects busy interval dates and allows touching meetings', () => {
    const busy = {
      days: ['thursday'] as const,
      start: '12:30',
      end: '13:00',
      start_date: '2027-01-14',
      end_date: '2027-01-14',
    };
    expect(
      generateSchedules([c], {
        constraints: { unavailable_times: [{ ...busy, days: [...busy.days] }] },
      }).returned,
    ).toBe(2);
    expect(
      generateSchedules([c], {
        constraints: {
          unavailable_times: [
            {
              ...busy,
              days: [...busy.days],
              start_date: '2027-01-07',
              end_date: '2027-01-07',
            },
          ],
        },
      }).returned,
    ).toBe(1);
    expect(
      generateSchedules([c], {
        constraints: {
          unavailable_times: [
            { days: ['monday'], start: '12:00', end: '13:00' },
          ],
        },
      }).returned,
    ).toBe(2);
  });
  it('never turns soft ranking into exclusion and uses ordered tie breakers', () => {
    const result = generateSchedules([c], {
      ranking: {
        mode: 'most_days_off',
        tie_breakers: ['avoid_days'],
        avoid_days: ['thursday'],
      },
    });
    expect(result.returned).toBe(2);
    expect(result.schedules[0]!.sections).toEqual(['B']);
    expect(result.ranking.objectives.map((o) => o.name)).toEqual([
      'most_days_off',
      'avoid_days',
    ]);
    expect(result.schedules[1]!.ranking.scores.avoid_days).toBe(1);
  });
  it('does not invent dates for incomplete schedules and excludes untimed hard constraints', () => {
    const unknown = course('UNKNOWN', [
      section('UNDATED', [meeting(600, 660)]),
      section('UNTIMED', []),
    ]);
    const result = generateSchedules([unknown], {
      ranking: { mode: 'most_days_off' },
    });
    expect(result.ranking.complete).toBe(false);
    expect(
      result.schedules.every(
        (s) =>
          s.days_on_campus === null && s.ranking.scores.most_days_off === null,
      ),
    ).toBe(true);
    expect(
      generateSchedules([unknown], { constraints: { not_before: '09:00' } })
        .returned,
    ).toBe(1);
  });
  it('does not create gaps between disjoint date ranges', () => {
    const split = course('S', [
      section('S', [
        dated(600, 660, ['monday'], { endDate: '2027-01-10' }),
        dated(780, 840, ['monday'], { startDate: '2027-01-11' }),
      ]),
    ]);
    expect(generateSchedules([split]).schedules[0]!.total_gap_minutes).toBe(0);
  });
  it('reports bounded search ranking coverage and rejects ambiguous options', () => {
    expect(
      generateSchedules([c], { maxNodes: 1, ranking: { mode: 'mornings' } })
        .ranking.coverage,
    ).toBe('explored_valid_schedules');
    expect(() =>
      generateSchedules([c], {
        ranking: { mode: 'mornings' },
        preferences: { prefer_days_off: true },
      }),
    ).toThrow('not both');
    expect(
      rankingSchema.safeParse({ mode: 'mornings', tie_breakers: ['mornings'] })
        .success,
    ).toBe(false);
    expect(rankingSchema.safeParse({ mode: 'avoid_days' }).success).toBe(false);
    expect(
      constraintsSchema.safeParse({ not_before: '13:00', not_after: '12:00' })
        .success,
    ).toBe(false);
  });
});
