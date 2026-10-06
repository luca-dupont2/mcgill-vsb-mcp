#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { McGillAdapter } from './adapters/mcgill.js';
import type { McGillData } from './adapters/mcgill.js';
import { adapterConfig } from './config.js';
import { errorResult } from './errors.js';
import { VERSION } from './version.js';
import { listTerms, termsSchema } from './tools/list_terms.js';
import {
  getSectionsBatch,
  batchSectionsSchema,
} from './tools/get_sections_batch.js';
import { searchCourses, searchSchema } from './tools/search_courses.js';
import { getSections, sectionsSchema } from './tools/get_sections.js';
import {
  checkSelectedConflicts,
  conflictsSchema,
} from './tools/check_conflicts.js';
import {
  generateCourseSchedules,
  generateSchema,
} from './tools/generate_schedules.js';

async function run(
  action: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  try {
    const output = await action();
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output,
    };
  } catch (error) {
    const output = errorResult(error);
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output,
    };
  }
}
export function createServer(
  data: McGillData = new McGillAdapter(adapterConfig()),
) {
  const server = new McpServer({ name: 'mcgill-vsb-mcp', version: VERSION });
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
  server.registerTool(
    'list_terms',
    {
      description:
        'Discover terms currently published by McGill VSB. Use a returned label with course and schedule tools; do not assume an unpublished term is available.',
      inputSchema: termsSchema,
      annotations,
    },
    () => run(() => listTerms(data)),
  );
  server.registerTool(
    'get_sections_batch',
    {
      description:
        'Fetch sections for up to 12 courses in one published term, sequentially. Normalized duplicate codes are retrieved once. Results preserve input order and include per-course errors; inspect all_succeeded and each ok flag. Includes reported seats remaining and waitlist counts; null counts are unavailable. Set refresh=true for a new observation. Choose view=compact for readable meeting times or full for reusable section objects.',
      inputSchema: batchSectionsSchema,
      annotations,
    },
    (input) => run(() => getSectionsBatch(data, input)),
  );
  server.registerTool(
    'search_courses',
    {
      description:
        'Search McGill VSB by course code, subject, title, or keywords for a published term. Bounded pages; has_more indicates additional upstream suggestions.',
      inputSchema: searchSchema,
      annotations,
    },
    (input) => run(() => searchCourses(data, input)),
  );
  server.registerTool(
    'get_sections',
    {
      description:
        'Retrieve McGill sections, meeting dates, component bundles, reported seats remaining, and waitlist counts. Null seat counts are unavailable; availability does not establish eligibility. Set refresh=true to bypass cached course data. Default view=full returns reusable section objects; view=compact omits repeated course/term fields and numeric times. Compact section ids can be used with check_conflicts.',
      inputSchema: sectionsSchema,
      annotations,
    },
    (input) => run(() => getSections(data, input)),
  );
  server.registerTool(
    'check_conflicts',
    {
      description:
        'Check selected section_ids against current VSB data OR pass section objects from get_sections. Times that touch do not conflict; dates and weekdays must overlap. Missing times or date bounds yields complete=false; overlaps report confirmed or possible certainty.',
      inputSchema: conflictsSchema,
      annotations,
    },
    (input) => run(() => checkSelectedConflicts(data, input)),
  );
  server.registerTool(
    'generate_schedules',
    {
      description:
        'Enumerate non-conflicting combinations using VSB component bundles. Hard constraints reject schedules; ranking.mode selects six VSB sorts or local objectives, with ordered tie_breakers. Attendance metrics use inclusive dates and report exceptional meetings. Verified and provisional counts, unknown scores, and bounded search are explicit. view=compact omits detailed meetings and attendance, retaining metrics, scores, source, and warnings. Legacy preferences remain soft.',
      inputSchema: generateSchema,
      annotations,
    },
    (input) => run(() => generateCourseSchedules(data, input)),
  );
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    const server = createServer();
    const close = async () => {
      await server.close();
      process.exit(0);
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    await server.connect(new StdioServerTransport());
  } catch (error) {
    console.error(JSON.stringify(errorResult(error)));
    process.exitCode = 1;
  }
}
