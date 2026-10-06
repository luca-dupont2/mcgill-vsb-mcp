import { parseArgs } from 'node:util';
import { McGillAdapter } from './adapters/mcgill.js';
import { adapterConfig } from './config.js';
import { AppError, errorResult } from './errors.js';
import { searchCourses, searchSchema } from './tools/search_courses.js';
import { getSections, sectionsSchema } from './tools/get_sections.js';
import {
  getSectionsBatch,
  batchSectionsSchema,
} from './tools/get_sections_batch.js';
import {
  checkSelectedConflicts,
  conflictsSchema,
} from './tools/check_conflicts.js';
import {
  generateCourseSchedules,
  generateSchema,
} from './tools/generate_schedules.js';
function jsonOption(value: string, name: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new AppError(
      'invalid_request',
      `${name} must be valid JSON matching the generate_schedules schema.`,
    );
  }
}
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      term: { type: 'string' },
      limit: { type: 'string' },
      ranking: { type: 'string' },
      constraints: { type: 'string' },
      view: { type: 'string' },
      refresh: { type: 'boolean' },
    },
  });
  const [command, ...arguments_] = positionals;
  const data = new McGillAdapter(adapterConfig());
  let result: unknown;
  if (command === 'terms')
    result = { terms: (await data.listTerms()).map((t) => t.label) };
  else if (command === 'sections-batch')
    result = await getSectionsBatch(
      data,
      batchSectionsSchema.parse({
        course_codes: arguments_,
        refresh: values.refresh,
        term: values.term,
        ...(values.view ? { view: values.view } : {}),
      }),
    );
  else if (command === 'sections')
    result = await getSections(
      data,
      sectionsSchema.parse({
        course_code: arguments_.join(' '),
        refresh: values.refresh,
        term: values.term,
        ...(values.view ? { view: values.view } : {}),
      }),
    );
  else if (command === 'search')
    result = await searchCourses(
      data,
      searchSchema.parse({
        query: arguments_.join(' '),
        term: values.term,
        ...(values.limit ? { limit: Number(values.limit) } : {}),
      }),
    );
  else if (command === 'conflicts')
    result = await checkSelectedConflicts(
      data,
      conflictsSchema.parse({
        section_ids: arguments_,
        ...(values.term ? { term: values.term } : {}),
      }),
    );
  else if (command === 'schedules')
    result = await generateCourseSchedules(
      data,
      generateSchema.parse({
        course_codes: arguments_,
        ...(values.view ? { view: values.view } : {}),
        ...(values.ranking
          ? { ranking: jsonOption(values.ranking, '--ranking') }
          : {}),
        ...(values.constraints
          ? { constraints: jsonOption(values.constraints, '--constraints') }
          : {}),
        term: values.term,
        ...(values.limit ? { max_results: Number(values.limit) } : {}),
      }),
    );
  else
    throw new AppError(
      'invalid_command',
      'Use terms, search <query>, sections <course>, sections-batch <quoted course codes>, conflicts <section ids>, or schedules <quoted course codes>. Supply --term for search, sections, sections-batch, and schedules. Sections and schedules accept --view full or compact. Sections and sections-batch accept --refresh for new seat observations.',
    );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify(errorResult(error), null, 2));
  process.exitCode = 1;
}
