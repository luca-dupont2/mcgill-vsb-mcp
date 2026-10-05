import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { constraintsSchema, rankingSchema } from '../schedule-options.js';
import { generateSchedules } from '../scheduling.js';
import { codeInput, preferencesSchema, termInput } from './schemas.js';
export const generateSchema = z
  .object({
    course_codes: z.array(codeInput).min(1).max(12),
    term: termInput,
    max_results: z.number().int().min(1).max(100).default(20),
    constraints: constraintsSchema.optional(),
    ranking: rankingSchema.optional(),
    preferences: preferencesSchema
      .optional()
      .describe(
        'Deprecated compatibility field. Soft objectives only; cannot be combined with ranking.',
      ),
  })
  .strict()
  .refine(
    (input) => !(input.ranking && input.preferences),
    'Supply ranking or legacy preferences, not both.',
  );
export async function generateCourseSchedules(
  data: McGillData,
  input: z.infer<typeof generateSchema>,
) {
  const courses = [];
  for (const code of input.course_codes)
    courses.push(await data.getSections(code, input.term));
  return generateSchedules(courses, {
    maxResults: input.max_results,
    ...(input.constraints ? { constraints: input.constraints } : {}),
    ...(input.ranking ? { ranking: input.ranking } : {}),
    ...(input.preferences ? { preferences: input.preferences } : {}),
  });
}
