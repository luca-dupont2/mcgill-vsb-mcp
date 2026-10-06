import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { normalizeTerm, presentCourse } from '../models.js';
import { termInput } from './schemas.js';
export const searchSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    term: termInput,
    limit: z.number().int().min(1).max(20).default(20),
    page: z.number().int().min(0).max(100).default(0),
  })
  .strict();
export async function searchCourses(
  data: McGillData,
  input: z.infer<typeof searchSchema>,
) {
  const result = await data.searchCourses(
    input.query,
    input.term,
    input.limit,
    input.page,
  );
  return {
    term: normalizeTerm(input.term).label,
    courses: result.courses.map((course) => presentCourse(course, true)),
    page: input.page,
    has_more: result.hasMore,
    source: 'McGill VSB',
  };
}
