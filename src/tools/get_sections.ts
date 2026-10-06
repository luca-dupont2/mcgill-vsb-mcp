import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { codeInput, termInput } from './schemas.js';
import { presentSectionsView, responseView } from './response-view.js';
export const sectionsSchema = z
  .object({
    course_code: codeInput,
    term: termInput,
    view: responseView,
    refresh: z
      .boolean()
      .default(false)
      .describe(
        'Bypass the course cache for a new VSB seat/timetable observation. Does not guarantee registration eligibility.',
      ),
  })
  .strict();
export async function getSections(
  data: McGillData,
  input: z.infer<typeof sectionsSchema>,
) {
  return presentSectionsView(
    await data.getSections(input.course_code, input.term, input.refresh),
    input.view,
  );
}
