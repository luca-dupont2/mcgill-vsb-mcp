import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createServer } from '../src/server.js';
import type { McGillData } from '../src/adapters/mcgill.js';
import { parseSections } from '../src/adapters/parsing.js';
import { normalizeTerm, normalizeCourseCode } from '../src/models.js';
import { fixture } from './helpers.js';
import { AppError } from '../src/errors.js';

const fixtures: Record<string, string> = {
  'ECSE 206': 'ecse206-winter2027.xml',
  'ECSE 205': 'ecse205-winter2027.xml',
  'MATH 263': 'math263-winter2027.xml',
  'PHIL 237': 'phil237-winter2027.xml',
  'COMP 202': 'comp202-winter2027.xml',
  'ECSE 201': 'ecse201-winter2027.xml',
};
const data: McGillData = {
  async listTerms() {
    return [normalizeTerm('2027 Winter')];
  },
  async getSections(code, term) {
    code = normalizeCourseCode(code);
    if (!fixtures[code])
      throw new AppError('course_not_found', 'No matching course.', {
        course_code: code,
        term,
      });
    return parseSections(fixture(fixtures[code]!), code, normalizeTerm(term));
  },
  async searchCourses(_query, term) {
    return {
      courses: [(await this.getSections('ECSE 206', term)).course],
      hasMore: false,
    };
  },
};
describe('MCP SDK client/server integration', () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  beforeEach(async () => {
    client = new Client({ name: 'test-client', version: '1.0.0' });
    server = createServer(data);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
  });
  afterEach(async () => {
    await client.close();
    await server.close();
  });
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toBeDefined();
    return result.structuredContent! as Record<string, unknown>;
  }
  it('advertises exactly four read-only tools', async () => {
    const result = await client.listTools();
    expect(result.tools.map((t) => t.name).sort()).toEqual([
      'check_conflicts',
      'generate_schedules',
      'get_sections',
      'search_courses',
    ]);
    expect(result.tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
  });
  it('searches and retrieves normalized real fixture sections over MCP', async () => {
    expect(
      await call('search_courses', { query: 'ECSE 206', term: '2027 Winter' }),
    ).toMatchObject({ courses: [{ code: 'ECSE 206' }] });
    expect(
      await call('get_sections', {
        course_code: 'ECSE 206',
        term: '2027 Winter',
      }),
    ).toMatchObject({
      sections: [
        {
          component: 'lecture',
          meetings: [
            { start: '10:05', start_minutes: 605 },
            { start: '10:05' },
          ],
        },
        { component: 'tutorial' },
      ],
    });
  });
  it('checks both section IDs and output section objects', async () => {
    const a = await call('get_sections', {
      course_code: 'ECSE 206',
      term: '2027 Winter',
    });
    const b = await call('get_sections', {
      course_code: 'PHIL 237',
      term: '2027 Winter',
    });
    const sections = [
      ...(a.sections as Record<string, unknown>[]),
      ...(b.sections as Record<string, unknown>[]),
    ];
    const ids = sections.map((s) => s.id);
    const byId = await call('check_conflicts', { section_ids: ids });
    const byObject = await call('check_conflicts', { sections });
    expect(byId.conflict).toBe(byObject.conflict);
    expect(byId.overlaps).toEqual(byObject.overlaps);
  });
  it('preserves uncertainty for caller-supplied undated meetings through MCP', async () => {
    const source = await call('get_sections', {
      course_code: 'ECSE 206',
      term: '2027 Winter',
    });
    const first = (source.sections as Record<string, unknown>[])[0]!;
    const undated = {
      ...first,
      meetings: (first.meetings as Record<string, unknown>[]).map((m) => ({
        days: m.days,
        start_minutes: m.start_minutes,
        end_minutes: m.end_minutes,
      })),
    };
    const result = await call('check_conflicts', {
      sections: [undated, { ...undated, id: 'CALLER-SECOND' }],
    });
    expect(result).toMatchObject({
      conflict: true,
      complete: false,
      overlaps: [{ certainty: 'possible' }, { certainty: 'possible' }],
    });
  });
  it('returns provisional timetable counts for untimed published sections through MCP', async () => {
    const result = await call('generate_schedules', {
      course_codes: ['ECSE 201'],
      term: '2027 Winter',
    });
    expect(result).toMatchObject({
      valid_schedules_found: 0,
      provisional_schedules_found: 1,
      candidate_schedules_found: 1,
      verification_complete: false,
      schedules: [{ complete: false }],
    });
  });
  it('generates linked multi-course timetables over MCP', async () => {
    const result = await call('generate_schedules', {
      course_codes: ['ECSE 205', 'MATH 263', 'COMP 202'],
      term: '2027 Winter',
      ranking: {
        mode: 'avoid_days',
        avoid_days: ['friday'],
        tie_breakers: ['minimize_gaps'],
      },
    });
    expect(result.search_complete).toBe(true);
    expect(result.valid_schedules_found).toBeGreaterThan(0);
    for (const s of result.schedules as Record<string, unknown>[]) {
      expect(s.sections as string[]).toHaveLength(5);
      expect(
        await call('check_conflicts', { section_ids: s.sections }),
      ).toMatchObject({ conflict: false });
    }
  });
  it('exposes every VSB mode, constraints and scoring provenance through MCP', async () => {
    for (const mode of [
      'most_days_off',
      'mornings',
      'midday_classes',
      'evenings',
      'time_off_campus',
      'most_on_campus',
    ]) {
      const result = await call('generate_schedules', {
        course_codes: ['MATH 263'],
        term: '2027 Winter',
        ranking: { mode, tie_breakers: ['minimize_gaps'] },
        constraints: { not_after: '24:00' },
      });
      expect(result.ranking).toMatchObject({
        mode,
        complete: true,
        coverage: 'all_valid_schedules',
      });
      const first = (result.schedules as Record<string, unknown>[])[0]!;
      expect(first.ranking).toMatchObject({
        complete: true,
        vsb_score_input: 'source_bundle_blocks',
      });
    }
    const empty = await call('generate_schedules', {
      course_codes: ['ECSE 206'],
      term: '2027 Winter',
      constraints: { unavailable_days: ['monday'] },
    });
    expect(empty.returned).toBe(0);
    const sections = await call('get_sections', {
      course_code: 'MATH 263',
      term: '2027 Winter',
    });
    expect(sections).not.toHaveProperty('bundleScoreBlocks');
  });
  it('returns structured actionable source errors', async () => {
    const result = await client.callTool({
      name: 'get_sections',
      arguments: { course_code: 'ECSE 999', term: '2027 Winter' },
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: 'course_not_found', course_code: 'ECSE 999' },
    });
  });
  it('validates boundary types, meeting intervals, and mutually exclusive inputs', async () => {
    for (const [name, args] of [
      ['search_courses', { query: '', term: '2027 Winter' }],
      ['generate_schedules', { course_codes: [], term: '2027 Winter' }],
      ['check_conflicts', {}],
      ['check_conflicts', { section_ids: ['id'], sections: [] }],
      [
        'generate_schedules',
        {
          course_codes: ['ECSE 206'],
          term: '2027 Winter',
          preferences: { avoid_before: '25:00' },
        },
      ],
    ] as const) {
      expect(await client.callTool({ name, arguments: args })).toMatchObject({
        isError: true,
      });
    }
  });
});
