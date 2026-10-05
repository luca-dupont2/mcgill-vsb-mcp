import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import { McGillAdapter } from '../src/adapters/mcgill.js';
import { vsbModes } from '../src/vsb-ranking.js';

// Public example courses, unrelated to a personal course plan.
const course_codes = ['ECSE 205', 'MATH 263'];
const terms = await new McGillAdapter().listTerms();
const term =
  process.env.MCGILL_SMOKE_TERM ??
  terms.filter((t) => t.season === 'Winter').at(-1)?.label ??
  terms.at(-1)!.label;
const client = new Client({
  name: 'ranking-live-verification',
  version: '1.0.0',
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/server.js')],
  stderr: 'inherit',
});
async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 120000 },
  );
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
}
const summarySchema = z.object({
  sections: z.array(z.string()),
  complete: z.boolean(),
  ranking: z.object({
    scores: z.record(z.string(), z.number().nullable()),
    vsb_score_input: z.string(),
  }),
});
try {
  await client.connect(transport);
  const observations = [];
  let chosen: string[] = [];
  for (const mode of vsbModes) {
    const result = await call('generate_schedules', {
      course_codes,
      term,
      max_results: 3,
      ranking: { mode, tie_breakers: ['minimize_gaps'] },
    });
    assert.equal(result.search_complete, true);
    assert.equal(result.verification_complete, true);
    assert.equal(result.provisional_schedules_found, 0);
    const schedules = z.array(summarySchema).parse(result.schedules);
    assert(
      schedules.length > 0,
      'Expected schedules for the public example pair. Update example courses if offerings change.',
    );
    for (let i = 0; i < schedules.length; i++) {
      const schedule = schedules[i]!;
      assert.equal(schedule.complete, true);
      for (const score of vsbModes)
        assert.equal(typeof schedule.ranking.scores[score], 'number');
      assert.equal(schedule.ranking.vsb_score_input, 'source_bundle_blocks');
      const conflicts = await call('check_conflicts', {
        section_ids: schedule.sections,
      });
      assert.equal(conflicts.conflict, false);
      assert.equal(conflicts.complete, true);
      if (i)
        assert(
          schedules[i - 1]!.ranking.scores[mode]! >=
            schedule.ranking.scores[mode]!,
        );
    }
    chosen = schedules[0]!.sections;
    observations.push({
      mode,
      valid_schedules_found: result.valid_schedules_found,
      checked_schedules: schedules.length,
      descending_scores: true,
      verified_conflict_free: true,
    });
  }
  const pinned = await call('generate_schedules', {
    course_codes,
    term,
    constraints: { required_section_ids: chosen },
    ranking: { mode: 'minimize_gaps' },
  });
  assert.equal(pinned.returned, 1);
  assert.deepEqual(
    z.array(summarySchema).parse(pinned.schedules)[0]!.sections,
    chosen,
  );
  const excluded = await call('generate_schedules', {
    course_codes,
    term,
    constraints: { excluded_section_ids: [chosen[0]!] },
    max_results: 100,
  });
  for (const schedule of z.array(summarySchema).parse(excluded.schedules))
    assert(!schedule.sections.includes(chosen[0]!));
  console.log(
    JSON.stringify(
      {
        verified_at: new Date().toISOString(),
        term,
        course_codes,
        transport: 'stdio',
        observations,
        pinned_schedule_verified: true,
        exclusion_verified: true,
        scoring_validation:
          'Offline independent arithmetic fixtures; live checks validate score availability, ordering, and conflicts.',
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
  await transport.close();
}
