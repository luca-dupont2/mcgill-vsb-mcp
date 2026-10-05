import { AppError } from './errors.js';
import { days, parseTime, presentMeeting } from './models.js';
import type {
  CourseSections,
  Day,
  Meeting,
  Section,
  VsbScoreBlock,
} from './models.js';

import { attendanceContext, hasOccurrence, isoDate } from './attendance.js';
import { constraintsSchema, resolveRanking } from './schedule-options.js';
import type { Constraints, Preferences } from './schedule-options.js';
import { VSB_SCORING, vsbModes, objectiveDescriptions } from './vsb-ranking.js';
import type { Ranking } from './vsb-ranking.js';
import { summarizeSchedule, compareSchedules } from './schedule-summary.js';

function dateOverlap(
  a: Meeting,
  b: Meeting,
): { days: Day[]; startDate?: string; endDate?: string } {
  const start = [a.startDate, b.startDate]
    .filter((x): x is string => !!x)
    .sort()
    .at(-1);
  const end = [a.endDate, b.endDate].filter((x): x is string => !!x).sort()[0];
  if (start && end && start > end) return { days: [] };
  const shared = days
    .filter((day) => a.days.includes(day) && b.days.includes(day))
    .filter((day) => {
      if (!start || !end) return true;
      const date = new Date(`${start}T00:00:00Z`);
      const weekday = (date.getUTCDay() + 6) % 7;
      const offset = (days.indexOf(day) - weekday + 7) % 7;
      return (
        new Date(date.getTime() + offset * 86400000)
          .toISOString()
          .slice(0, 10) <= end
      );
    });
  return {
    days: shared,
    ...(start ? { startDate: start } : {}),
    ...(end ? { endDate: end } : {}),
  };
}
export function meetingOverlap(a: Meeting, b: Meeting): Meeting | undefined {
  if (a.startMinutes >= b.endMinutes || b.startMinutes >= a.endMinutes)
    return undefined;
  const date = dateOverlap(a, b);
  if (!date.days.length) return undefined;
  return {
    ...date,
    startMinutes: Math.max(a.startMinutes, b.startMinutes),
    endMinutes: Math.min(a.endMinutes, b.endMinutes),
  };
}
export function sectionsConflict(a: Section, b: Section): boolean {
  return a.meetings.some((am) =>
    b.meetings.some((bm) => !!meetingOverlap(am, bm)),
  );
}
function hasDateBounds(meeting: Meeting): boolean {
  return Boolean(meeting.startDate && meeting.endDate);
}
export function checkConflicts(input: Section[]) {
  const unique = new Map<string, Section>();
  for (const section of input) {
    const existing = unique.get(section.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(section))
      throw new AppError(
        'inconsistent_section',
        'The same section id was supplied with different data.',
        { section_id: section.id },
      );
    unique.set(section.id, section);
  }
  const sections = [...unique.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (new Set(sections.map((s) => s.term)).size > 1)
    throw new AppError('mixed_terms', 'Compare sections from the same term.');
  const overlaps = [];
  for (let i = 0; i < sections.length; i++)
    for (let j = i + 1; j < sections.length; j++) {
      const a = sections[i]!;
      const b = sections[j]!;
      for (const am of a.meetings)
        for (const bm of b.meetings) {
          const overlap = meetingOverlap(am, bm);
          if (overlap)
            overlaps.push({
              a: a.id,
              b: b.id,
              ...presentMeeting(overlap),
              certainty:
                hasDateBounds(am) && hasDateBounds(bm)
                  ? 'confirmed'
                  : 'possible',
            });
        }
    }
  const warnings = sections.flatMap((s) => {
    if (!s.meetings.length)
      return [
        `Section ${s.id} has no published timed meetings; its time conflicts cannot be ruled out.`,
      ];
    if (s.meetings.some((m) => !hasDateBounds(m)))
      return [
        `Section ${s.id} has missing meeting date bounds; overlaps are conservative possibilities and timetable verification is incomplete.`,
      ];
    return [];
  });
  return {
    conflict: overlaps.length > 0,
    overlaps,
    complete: !warnings.length,
    warnings,
  };
}
export type { Preferences } from './schedule-options.js';
export type GenerateOptions = {
  maxResults?: number;
  maxNodes?: number;
  preferences?: Preferences;
  constraints?: Constraints;
  ranking?: Ranking;
};
export function generateSchedules(
  courses: CourseSections[],
  options: GenerateOptions = {},
) {
  if (!courses.length)
    throw new AppError('invalid_request', 'Supply at least one course.');
  if (new Set(courses.map((c) => c.term)).size !== 1)
    throw new AppError('mixed_terms', 'Generate schedules within one term.');
  if (new Set(courses.map((c) => c.course.code)).size !== courses.length)
    throw new AppError('duplicate_course', 'Supply each course only once.');
  const ranking = resolveRanking(options.ranking, options.preferences);
  const constraints = constraintsSchema.parse(options.constraints ?? {});
  const required = new Set(constraints.required_section_ids ?? []),
    excluded = new Set(constraints.excluded_section_ids ?? []);
  const allIds = new Set(courses.flatMap((c) => c.sections.map((s) => s.id)));
  for (const id of [...required, ...excluded]) {
    if (!allIds.has(id))
      throw new AppError(
        'section_not_found',
        'Constraint section id is not present in the requested courses and term.',
        { section_id: id, term: courses[0]!.term },
      );
    if (required.has(id) && excluded.has(id))
      throw new AppError(
        'contradictory_constraints',
        'A section cannot be both required and excluded.',
        { section_id: id },
      );
  }
  const before = constraints.not_before
    ? parseTime(constraints.not_before)
    : undefined;
  const after = constraints.not_after
    ? parseTime(constraints.not_after)
    : undefined;
  const busy: Meeting[] = (constraints.unavailable_times ?? []).map((t) => ({
    days: t.days,
    startMinutes: parseTime(t.start),
    endMinutes: parseTime(t.end),
    ...(t.start_date ? { startDate: t.start_date } : {}),
    ...(t.end_date ? { endDate: t.end_date } : {}),
  }));
  const hasAttendanceRestrictions =
    before !== undefined ||
    after !== undefined ||
    busy.length > 0 ||
    Boolean(constraints.unavailable_days?.length);
  type Choice = {
    sections: Section[];
    scoreBlocks: VsbScoreBlock[] | undefined;
  };
  const diagnostics = courses.map((c) => ({
    course_code: c.course.code,
    published_bundles: c.bundles.length,
    usable_bundles: 0,
    rejected_bundles: {} as Record<string, number>,
  }));
  const choices: Choice[][] = courses.map((c, index) => {
    if (!c.sections.length) return [];
    if (c.linkage !== 'provided')
      throw new AppError(
        'linkage_unavailable',
        'The source does not provide component linkage; schedules cannot be verified.',
        { course_code: c.course.code },
      );
    const byId = new Map(c.sections.map((s) => [s.id, s]));
    const needed = [...required].filter((id) => byId.has(id));
    const seen = new Set<string>();
    const usable: Choice[] = [];
    for (const ids of c.bundles) {
      const key = [...ids].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const sections = ids.map((id) => {
        const section = byId.get(id);
        if (!section)
          throw new AppError(
            'upstream_data_invalid',
            'A component bundle references a missing section.',
          );
        return section;
      });
      let rejection: string | undefined;
      if (!sections.length || sections.some((s) => !s.active))
        rejection = 'inactive_or_empty';
      else if (sections.some((s) => excluded.has(s.id)))
        rejection = 'excluded_section';
      else if (needed.some((id) => !ids.includes(id)))
        rejection = 'missing_required_section';
      else if (checkConflicts(sections).conflict)
        rejection = 'internal_conflict';
      else if (
        hasAttendanceRestrictions &&
        sections.some((s) => !s.meetings.length)
      )
        rejection = 'unpublished_times';
      else
        for (const m of sections
          .flatMap((s) => s.meetings)
          .filter(hasOccurrence)) {
          if (
            m.days.some(
              (day) =>
                constraints.unavailable_days?.includes(day) &&
                hasOccurrence({ ...m, days: [day] }),
            )
          ) {
            rejection = 'unavailable_day';
            break;
          }
          if (
            (before !== undefined && m.startMinutes < before) ||
            (after !== undefined && m.endMinutes > after)
          ) {
            rejection = 'time_bounds';
            break;
          }
          if (busy.some((block) => meetingOverlap(m, block))) {
            rejection = 'unavailable_time';
            break;
          }
        }
      if (rejection)
        diagnostics[index]!.rejected_bundles[rejection] =
          (diagnostics[index]!.rejected_bundles[rejection] ?? 0) + 1;
      else usable.push({ sections, scoreBlocks: c.bundleScoreBlocks?.[key] });
    }
    diagnostics[index]!.usable_bundles = usable.length;
    return usable;
  });
  const context = attendanceContext(
    choices.flatMap((c) => c.flatMap((b) => b.sections)),
  );
  const maxNodes = options.maxNodes ?? 100000,
    maxResults = options.maxResults ?? 20;
  const schedules: ReturnType<typeof summarizeSchedule>[] = [];
  let visited = 0,
    valid = 0,
    provisional = 0,
    truncated = false,
    rankingComplete = true;
  const walk = (
    depth: number,
    selected: Section[],
    scoreBlocks: VsbScoreBlock[] | undefined,
  ) => {
    if (truncated) return;
    if (depth === choices.length) {
      const summary = summarizeSchedule(
        selected,
        ranking,
        context,
        scoreBlocks,
      );
      if (summary.complete) valid++;
      else provisional++;
      rankingComplete &&= summary.ranking.complete;
      schedules.push(summary);
      schedules.sort(compareSchedules);
      if (schedules.length > maxResults) schedules.pop();
      return;
    }
    for (const bundle of choices[depth]!) {
      if (++visited > maxNodes) {
        truncated = true;
        return;
      }
      if (
        bundle.sections.some((s) =>
          selected.some((existing) => sectionsConflict(s, existing)),
        )
      )
        continue;
      walk(
        depth + 1,
        [...selected, ...bundle.sections],
        scoreBlocks && bundle.scoreBlocks
          ? [...scoreBlocks, ...bundle.scoreBlocks]
          : undefined,
      );
      if (truncated) return;
    }
  };
  walk(0, [], []);
  const objectives = [
    ranking.mode ?? 'section_id',
    ...(ranking.tie_breakers ?? []),
  ];
  return {
    term: courses[0]!.term,
    constraints,
    ranking: {
      ...ranking,
      objectives: objectives.map((name) => ({
        name,
        description: objectiveDescriptions[name],
        direction:
          name === 'section_id'
            ? 'lexicographic_section_ids'
            : vsbModes.includes(name as (typeof vsbModes)[number])
              ? 'maximize'
              : 'minimize',
      })),
      vsb_scoring: VSB_SCORING,
      complete: rankingComplete,
      coverage: truncated ? 'explored_valid_schedules' : 'all_valid_schedules',
      unknown_score_policy: 'known_scores_before_unavailable_scores',
    },
    analysis_window:
      context.start === undefined
        ? null
        : {
            start_date: isoDate(context.start),
            end_date: isoDate(context.end!),
          },
    schedules,
    returned: schedules.length,
    candidate_schedules_found: valid + provisional,
    valid_schedules_found: valid,
    provisional_schedules_found: provisional,
    verification_complete: provisional === 0,
    search_complete: !truncated,
    results_truncated: truncated || valid + provisional > maxResults,
    search_nodes_visited: Math.min(visited, maxNodes),
    course_diagnostics: diagnostics,
    sources: courses.flatMap((c) =>
      c.source ? [{ course_code: c.course.code, ...c.source }] : [],
    ),
    warnings: [
      ...new Set(
        courses
          .flatMap((c) => c.warnings)
          .concat(
            choices.flatMap((choice, i) =>
              choice.length
                ? []
                : [
                    `No active valid section bundles satisfy constraints for ${courses[i]!.course.code}.`,
                  ],
            ),
            diagnostics.some((d) => d.rejected_bundles.unpublished_times)
              ? [
                  'Bundles with unpublished meeting times are excluded when attendance constraints cannot be verified.',
                ]
              : [],
            options.preferences
              ? [
                  'preferences is deprecated; use explicit constraints and ranking. Legacy preferences remain soft objectives.',
                ]
              : [],
            provisional > 0
              ? [
                  'Some candidate schedules are provisional because times or date bounds are missing; valid_schedules_found counts only fully verified timetables.',
                ]
              : [],
            !rankingComplete
              ? [
                  'Some candidate schedules have unavailable ranking scores due to missing times or date bounds; rankings put known scores first and cannot establish the true optimum.',
                ]
              : [],
            truncated
              ? [
                  'Enumeration limit reached; ranking is only over explored candidate combinations.',
                ]
              : [],
          ),
      ),
    ].sort(),
  };
}
