import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { presentCourseSections } from '../models.js';
import { codeInput, termInput } from './schemas.js';
export const sectionsSchema = z
  .object({ course_code: codeInput, term: termInput })
  .strict();
export async function getSections(
  data: McGillData,
  input: z.infer<typeof sectionsSchema>,
) {
  return presentCourseSections(
    await data.getSections(input.course_code, input.term),
  );
}
