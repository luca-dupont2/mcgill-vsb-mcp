import { z } from 'zod';
import { presentCourseSections, presentSection } from '../models.js';
import type { CourseSections } from '../models.js';

export const responseView = z
  .enum(['full', 'compact'])
  .default('full')
  .describe(
    'full preserves all result fields. compact omits repeated section identifiers and numeric times, or detailed schedule meetings and attendance. Source, warnings, and completeness remain.',
  );

export function presentSectionsView(course: CourseSections, view = 'full') {
  if (view === 'full') return presentCourseSections(course);
  return {
    course: course.course,
    term: course.term,
    view: 'compact',
    sections: course.sections.map((section) => {
      const {
        course_code: _code,
        term: _term,
        meetings,
        ...summary
      } = presentSection(section);
      void _code;
      void _term;
      return {
        ...summary,
        complete:
          section.meetings.length > 0 &&
          section.meetings.every((m) => Boolean(m.startDate && m.endDate)),
        meetings: meetings.map(
          ({ start_minutes: _start, end_minutes: _end, ...meeting }) => {
            void _start;
            void _end;
            return meeting;
          },
        ),
      };
    }),
    bundles: course.bundles,
    linkage: course.linkage,
    warnings: course.warnings,
    ...(course.source ? { source: course.source } : {}),
  };
}
