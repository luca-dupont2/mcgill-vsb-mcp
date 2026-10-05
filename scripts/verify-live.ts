import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { sectionInput } from '../src/tools/schemas.js';
import { errorResult } from '../src/errors.js';

// Launch the actual compiled executable. This is intentionally outside pnpm test.
const client = new Client({
  name: 'mcgill-live-verification',
  version: '1.0.0',
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/server.js')],
  stderr: 'inherit',
});
const observations: Record<string, unknown>[] = [];
async function call(name: string, arguments_: Record<string, unknown>) {
  const result = await client.callTool(
    { name, arguments: arguments_ },
    { timeout: 120000 },
  );
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
}
try {
  await client.connect(transport);
  const discovery = await call('list_terms', {});
  const terms = z
    .array(z.object({ label: z.string(), season: z.string() }))
    .parse(discovery.terms);
  observations.push({ tool: 'list_terms', result: discovery });
  const term =
    process.env.MCGILL_SMOKE_TERM ??
    terms.filter((t) => t.season === 'Winter').at(-1)?.label ??
    terms.at(-1)!.label;
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 6);
  const search = await call('search_courses', {
    query: 'ECSE 206',
    term,
    limit: 3,
  });
  const found = z
    .array(z.object({ code: z.string(), title: z.string() }))
    .parse(search.courses);
  assert(found.some((c) => c.code === 'ECSE 206'));
  observations.push({
    tool: 'search_courses',
    query: 'ECSE 206',
    courses: found,
  });
  for (const published of terms) {
    const broad = await call('search_courses', {
      query: 'ECSE',
      term: published.label,
      limit: 20,
    });
    assert(z.array(z.unknown()).parse(broad.courses).length > 0);
    observations.push({
      tool: 'search_courses',
      query: 'ECSE',
      term: published.label,
      returned: z.array(z.unknown()).parse(broad.courses).length,
      has_more: broad.has_more,
    });
  }
  const keyword = await call('search_courses', {
    query: 'circuits',
    term,
    limit: 3,
  });
  assert(z.array(z.unknown()).parse(keyword.courses).length > 0);
  observations.push({
    tool: 'search_courses',
    query: 'circuits',
    courses: keyword.courses,
  });
  const ecse = await call('get_sections', { course_code: 'ECSE 206', term });
  const batch = await call('get_sections_batch', {
    course_codes: ['ECSE 206', 'MATH 263', 'ECSE 999'],
    term,
    view: 'compact',
  });
  assert.equal(batch.successful, 2);
  assert.equal(batch.failed, 1);
  const batchResults = z
    .array(
      z.object({
        ok: z.boolean(),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .parse(batch.results);
  const compact = await call('get_sections', {
    course_code: 'ECSE 206',
    term,
    view: 'compact',
  });
  assert.deepEqual(batchResults[0]!.data, compact);
  assert(JSON.stringify(compact).length < JSON.stringify(ecse).length);
  assert.deepEqual(compact.source, ecse.source);
  observations.push({
    tool: 'get_sections_batch',
    successful: batch.successful,
    failed: batch.failed,
    full_bytes: JSON.stringify(ecse).length,
    compact_bytes: JSON.stringify(compact).length,
  });
  const phil = await call('get_sections', { course_code: 'PHIL 237', term });
  const ecseSections = z.array(sectionInput).parse(ecse.sections);
  const philSections = z.array(sectionInput).parse(phil.sections);
  assert(ecseSections.some((s) => s.meetings.length > 0));
  observations.push({
    tool: 'get_sections',
    course: ecse.course,
    sections: ecse.sections,
    bundles: ecse.bundles,
    source: ecse.source,
  });
  const all = [...ecseSections, ...philSections];
  const conflictsIds = await call('check_conflicts', {
    section_ids: all.map((s) => s.id),
  });
  const conflictsObjects = await call('check_conflicts', { sections: all });
  assert.deepEqual(conflictsIds.overlaps, conflictsObjects.overlaps);
  assert.equal(conflictsIds.conflict, conflictsObjects.conflict);
  observations.push({
    tool: 'check_conflicts',
    inputs: 'section_ids and section objects',
    result: conflictsIds,
  });
  const generated = await call('generate_schedules', {
    course_codes: ['ECSE 205', 'MATH 263'],
    term,
    max_results: 5,
    ranking: {
      mode: 'avoid_days',
      avoid_days: ['friday'],
      tie_breakers: ['minimize_gaps'],
    },
  });
  const compactGenerated = await call('generate_schedules', {
    course_codes: ['ECSE 205', 'MATH 263'],
    term,
    max_results: 5,
    view: 'compact',
    ranking: {
      mode: 'avoid_days',
      avoid_days: ['friday'],
      tie_breakers: ['minimize_gaps'],
    },
  });
  assert.equal(
    compactGenerated.valid_schedules_found,
    generated.valid_schedules_found,
  );
  assert.deepEqual(compactGenerated.sources, generated.sources);
  assert(
    JSON.stringify(compactGenerated).length < JSON.stringify(generated).length,
  );
  const schedules = z
    .array(
      z.object({
        sections: z.array(z.string()),
        total_gap_minutes: z.number(),
        days_on_campus: z.number(),
      }),
    )
    .parse(generated.schedules);
  assert(
    schedules.length > 0,
    'Expected at least one live ECSE 205 / MATH 263 timetable. If offerings changed, use another fixture-supported pair.',
  );
  for (const schedule of schedules) {
    const check = await call('check_conflicts', {
      section_ids: schedule.sections,
    });
    assert.equal(check.conflict, false);
  }
  observations.push({
    tool: 'generate_schedules',
    course_codes: ['ECSE 205', 'MATH 263'],
    returned: generated.returned,
    valid_schedules_found: generated.valid_schedules_found,
    search_complete: generated.search_complete,
    schedules,
  });
  const threeCourses = await call('generate_schedules', {
    course_codes: ['ECSE 205', 'MATH 263', 'COMP 202'],
    term,
    max_results: 5,
  });
  const triples = z
    .array(z.object({ sections: z.array(z.string()) }))
    .parse(threeCourses.schedules);
  assert(triples.length > 0, 'Expected a valid live three-course timetable.');
  for (const schedule of triples)
    assert.equal(
      (await call('check_conflicts', { section_ids: schedule.sections }))
        .conflict,
      false,
    );
  observations.push({
    tool: 'generate_schedules',
    course_codes: ['ECSE 205', 'MATH 263', 'COMP 202'],
    returned: threeCourses.returned,
    valid_schedules_found: threeCourses.valid_schedules_found,
    search_complete: threeCourses.search_complete,
    schedules: triples,
  });
  const requestedExample = await call('generate_schedules', {
    course_codes: ['ECSE 205', 'MATH 263', 'PHIL 237'],
    term,
    max_results: 3,
  });
  observations.push({
    tool: 'generate_schedules',
    course_codes: ['ECSE 205', 'MATH 263', 'PHIL 237'],
    returned: requestedExample.returned,
    valid_schedules_found: requestedExample.valid_schedules_found,
    search_complete: requestedExample.search_complete,
  });
  console.log(
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        term,
        transport: 'stdio',
        sdk: '@modelcontextprotocol/server 2.3.0',
        observations,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify(errorResult(error), null, 2));
  process.exitCode = 1;
} finally {
  await client.close();
  await transport.close();
}
