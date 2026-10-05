import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { codeInput, termInput } from './schemas.js';
import { presentSectionsView, responseView } from './response-view.js';
export const sectionsSchema = z
  .object({ course_code: codeInput, term: termInput, view: responseView })
  .strict();
export async function getSections(
  data: McGillData,
  input: z.infer<typeof sectionsSchema>,
) {
  return presentSectionsView(
    await data.getSections(input.course_code, input.term),
    input.view,
  );
}
