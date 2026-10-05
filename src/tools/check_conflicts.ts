import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';
import { AppError } from '../errors.js';
import { normalizeTerm } from '../models.js';
import type { Section } from '../models.js';
import { checkConflicts } from '../scheduling.js';
import { sectionInput, termInput, toSection } from './schemas.js';
export const conflictsSchema = z
  .object({
    section_ids: z.array(z.string().min(1).max(100)).min(1).max(100).optional(),
    sections: z.array(sectionInput).min(1).max(100).optional(),
    term: termInput.optional(),
  })
  .strict()
  .refine(
    (x) => Boolean(x.section_ids) !== Boolean(x.sections),
    'Supply exactly one of section_ids or sections.',
  );
export async function checkSelectedConflicts(
  data: McGillData,
  input: z.infer<typeof conflictsSchema>,
) {
  let sections: Section[];
  const sourceWarnings = new Set<string>();
  if (input.sections) sections = input.sections.map(toSection);
  else {
    sections = [];
    for (const id of [...new Set(input.section_ids!)]) {
      const match =
        /^(\d{4})(01|05|09):([A-Z][A-Z0-9]{2,3}\d{3}(?:[A-Z]\d?)?):([^:]+)$/.exec(
          id,
        );
      if (!match)
        throw new AppError(
          'invalid_section_id',
          'Use the opaque id returned by get_sections.',
          { section_id: id },
        );
      const season = { '01': 'Winter', '05': 'Summer', '09': 'Fall' }[
        match[2]!
      ]!;
      const term = `${match[1]} ${season}`;
      const course = await data.getSections(match[3]!, term);
      for (const warning of course.warnings) sourceWarnings.add(warning);
      const section = course.sections.find((s) => s.id === id);
      if (!section)
        throw new AppError(
          'section_not_found',
          'This section is not present in the current source response.',
          { section_id: id, term },
        );
      sections.push(section);
    }
  }
  if (
    input.term &&
    sections.some((s) => s.term !== normalizeTerm(input.term!).label)
  )
    throw new AppError(
      'mixed_terms',
      'Requested term does not match the supplied sections.',
    );
  const result = checkConflicts(sections);
  result.warnings.push(...sourceWarnings);
  if (input.section_ids)
    result.warnings.push(
      'Checks use the currently published VSB meetings; source notes and omitted activities may affect attendance.',
    );
  return { term: sections[0]!.term, ...result };
}
