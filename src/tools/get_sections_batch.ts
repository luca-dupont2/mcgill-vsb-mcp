import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { AppError, errorResult } from '../errors.js';
import { normalizeCourseCode, normalizeTerm } from '../models.js';
import { codeInput, termInput } from './schemas.js';
import { presentSectionsView, responseView } from './response-view.js';

export const batchSectionsSchema = z
  .object({
    course_codes: z.array(codeInput).min(1).max(12),
    term: termInput,
    view: responseView,
  })
  .strict();

export async function getSectionsBatch(
  data: McGillData,
  input: z.infer<typeof batchSectionsSchema>,
) {
  const term = normalizeTerm(input.term);
  const available = await data.listTerms();
  if (!available.some((t) => t.id === term.id))
    throw new AppError(
      'term_unavailable',
      'This term is not currently published by VSB.',
      {
        term: term.label,
        available_terms: available.map((t) => t.label),
      },
    );
  const results = [];
  const seen = new Set<string>();
  // Keep requests sequential to avoid bursts against the public feed.
  for (const inputCode of input.course_codes) {
    let code = inputCode;
    try {
      code = normalizeCourseCode(inputCode);
      if (seen.has(code)) continue;
      seen.add(code);
      const course = await data.getSections(code, term.label);
      results.push({
        course_code: code,
        ok: true,
        data: presentSectionsView(course, input.view),
      });
    } catch (error) {
      results.push({ course_code: code, ok: false, error: errorResult(error) });
    }
  }
  return {
    term: term.label,
    results,
    successful: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    all_succeeded: results.every((r) => r.ok),
  };
}
