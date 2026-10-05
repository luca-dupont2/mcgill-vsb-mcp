import { analyzeAttendance, hasOccurrence, weekday } from './attendance.js';
import type { AttendanceContext } from './attendance.js';
import { formatTime, parseTime, presentMeeting } from './models.js';
import type { Section, VsbScoreBlock } from './models.js';
import { VSB_SCORING, vsbModes, vsbScores } from './vsb-ranking.js';
import type { Ranking, RankingMode } from './vsb-ranking.js';

export function summarizeSchedule(
  sections: Section[],
  ranking: Ranking,
  context: AttendanceContext,
  sourceBlocks: VsbScoreBlock[] | undefined,
) {
  const meetings = sections.flatMap((s) =>
    s.meetings.filter(hasOccurrence).map((m) => ({ ...m, sectionId: s.id })),
  );
  const attendance = analyzeAttendance(sections, context);
  const hasDates = sections.every(
    (s) =>
      s.meetings.length && s.meetings.every((m) => m.startDate && m.endDate),
  );
  const fallbackBlocks =
    sourceBlocks ??
    meetings.flatMap((m) =>
      m.days.map((day) => ({
        day,
        startMinutes: m.startMinutes,
        endMinutes: m.endMinutes,
        startBoundary: m.startDate!,
        endBoundary: m.endDate!,
      })),
    );
  const vsb = hasDates ? vsbScores(fallbackBlocks) : undefined;
  const scores: Record<RankingMode, number | null> = {
    ...Object.fromEntries(vsbModes.map((mode) => [mode, vsb?.[mode] ?? null])),
    minimize_gaps: attendance.total_gap_minutes,
    avoid_days: null,
    avoid_times: null,
    section_id: 0,
  } as Record<RankingMode, number | null>;
  if (attendance.complete) {
    const calendar = new Map<number, typeof meetings>();
    for (const s of sections)
      for (const [date, daily] of context.calendars.get(s.id) ?? [])
        calendar.set(date, [...(calendar.get(date) ?? []), ...daily]);
    scores.avoid_days = [...calendar.keys()].filter((d) =>
      ranking.avoid_days?.includes(weekday(d)),
    ).length;
    const before = ranking.avoid_before
      ? parseTime(ranking.avoid_before)
      : undefined;
    const after = ranking.avoid_after
      ? parseTime(ranking.avoid_after)
      : undefined;
    let penalty = 0;
    for (const daily of calendar.values()) {
      let end = -1;
      for (const m of daily.sort(
        (a, b) =>
          a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
      )) {
        const start = Math.max(end, m.startMinutes);
        if (m.endMinutes > start)
          penalty +=
            (before === undefined
              ? 0
              : Math.max(0, Math.min(before, m.endMinutes) - start)) +
            (after === undefined
              ? 0
              : Math.max(0, m.endMinutes - Math.max(after, start)));
        end = Math.max(end, m.endMinutes);
      }
    }
    scores.avoid_times = penalty;
  }
  const objectives = [
    ranking.mode ?? 'section_id',
    ...(ranking.tie_breakers ?? []),
  ];
  const unavailable = objectives.filter((mode) => scores[mode] === null);
  const comparison = objectives.map((mode) =>
    scores[mode] === null
      ? null
      : vsbModes.includes(mode as (typeof vsbModes)[number])
        ? -scores[mode]!
        : scores[mode]!,
  );
  const earliest = meetings.length
    ? Math.min(...meetings.map((m) => m.startMinutes))
    : undefined;
  const latest = meetings.length
    ? Math.max(...meetings.map((m) => m.endMinutes))
    : undefined;
  return {
    sections: sections.map((s) => s.id).sort(),
    earliest_start: earliest === undefined ? null : formatTime(earliest),
    latest_end: latest === undefined ? null : formatTime(latest),
    days_on_campus: attendance.regular_weekdays?.length ?? null,
    days: attendance.regular_weekdays,
    total_gap_minutes: attendance.total_gap_minutes,
    attendance,
    ranking: {
      scores,
      comparison_values: comparison,
      complete: !unavailable.length,
      unavailable_objectives: unavailable,
      vsb_score_input: !hasDates
        ? 'unavailable'
        : sourceBlocks
          ? 'source_bundle_blocks'
          : 'normalized_meetings',
      scoring_version: VSB_SCORING.version,
    },
    complete: attendance.complete,
    meetings: meetings.map((m) => ({
      section_id: m.sectionId,
      ...presentMeeting(m),
    })),
    warnings: !attendance.complete
      ? [
          'Attendance metrics cover only meetings with complete date bounds; missing times or dates prevent complete timetable verification.',
        ]
      : [],
  };
}
export function compareSchedules(
  a: ReturnType<typeof summarizeSchedule>,
  b: ReturnType<typeof summarizeSchedule>,
) {
  for (let i = 0; i < a.ranking.comparison_values.length; i++) {
    const av = a.ranking.comparison_values[i]!,
      bv = b.ranking.comparison_values[i]!;
    if (av === null && bv !== null) return 1;
    if (bv === null && av !== null) return -1;
    if (av !== null && bv !== null && av !== bv) return av - bv;
  }
  return a.sections.join('|').localeCompare(b.sections.join('|'));
}
