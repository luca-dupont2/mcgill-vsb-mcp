import { AppError } from './errors.js';
import { days, presentMeeting } from './models.js';
import type { Day, Meeting, Section } from './models.js';
const DAY_MS = 86400000;
export const dateNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / DAY_MS;
export const isoDate = (date: number) =>
  new Date(date * DAY_MS).toISOString().slice(0, 10);
export const weekday = (date: number): Day => days[(((date + 3) % 7) + 7) % 7]!;
export function hasOccurrence(meeting: Meeting): boolean {
  if (!meeting.startDate || !meeting.endDate) return true;
  const start = dateNumber(meeting.startDate),
    end = dateNumber(meeting.endDate);
  return meeting.days.some(
    (day) =>
      start + ((days.indexOf(day) - days.indexOf(weekday(start)) + 7) % 7) <=
      end,
  );
}
export type DatedMeeting = Meeting & { sectionId: string };
export function attendanceContext(sections: Section[]) {
  const dated = sections
    .flatMap((s) => s.meetings)
    .filter((m) => m.startDate && m.endDate && hasOccurrence(m));
  const start = dated.length
    ? Math.min(...dated.map((m) => dateNumber(m.startDate!)))
    : undefined;
  const end = dated.length
    ? Math.max(...dated.map((m) => dateNumber(m.endDate!)))
    : undefined;
  if (start !== undefined && end !== undefined && end - start >= 366)
    throw new AppError(
      'unsupported_date_range',
      'Attendance analysis supports a maximum 366-day window. Check the source date ranges.',
    );
  const calendars = new Map<string, Map<number, DatedMeeting[]>>();
  for (const s of sections) {
    if (calendars.has(s.id)) continue;
    const calendar = new Map<number, DatedMeeting[]>();
    for (const m of s.meetings) {
      if (!m.startDate || !m.endDate) continue;
      const from = dateNumber(m.startDate),
        to = dateNumber(m.endDate);
      for (const day of new Set(m.days)) {
        const first =
          from + ((days.indexOf(day) - days.indexOf(weekday(from)) + 7) % 7);
        for (let date = first; date <= to; date += 7) {
          const value = { ...m, sectionId: s.id };
          const existing = calendar.get(date) ?? [];
          if (
            !existing.some(
              (e) =>
                e.startMinutes === m.startMinutes &&
                e.endMinutes === m.endMinutes &&
                e.sectionId === s.id,
            )
          )
            existing.push(value);
          calendar.set(date, existing);
        }
      }
    }
    calendars.set(s.id, calendar);
  }
  return { start, end, calendars };
}
export type AttendanceContext = ReturnType<typeof attendanceContext>;
export function analyzeAttendance(
  sections: Section[],
  context: AttendanceContext,
) {
  const complete = sections.every(
    (s) =>
      s.meetings.length && s.meetings.every((m) => m.startDate && m.endDate),
  );
  const calendar = new Map<number, DatedMeeting[]>();
  for (const s of sections)
    for (const [date, meetings] of context.calendars.get(s.id) ?? [])
      calendar.set(date, [...(calendar.get(date) ?? []), ...meetings]);
  let gaps = 0,
    spans = 0,
    classMinutes = 0;
  for (const daily of calendar.values()) {
    daily.sort(
      (a, b) =>
        a.startMinutes - b.startMinutes ||
        a.endMinutes - b.endMinutes ||
        a.sectionId.localeCompare(b.sectionId),
    );
    let end = daily[0]!.startMinutes;
    for (const m of daily) {
      gaps += Math.max(0, m.startMinutes - end);
      classMinutes += Math.max(0, m.endMinutes - Math.max(end, m.startMinutes));
      end = Math.max(end, m.endMinutes);
    }
    spans += end - daily[0]!.startMinutes;
  }
  const weeks = new Map<number, Set<Day>>();
  if (context.start !== undefined && context.end !== undefined)
    for (let date = context.start; date <= context.end; date++) {
      const monday = date - days.indexOf(weekday(date));
      const week = weeks.get(monday) ?? new Set<Day>();
      if (calendar.has(date)) week.add(weekday(date));
      weeks.set(monday, week);
    }
  const patterns = new Map<
    string,
    { days: Day[]; week_count: number; complete_week_count: number }
  >();
  for (const [monday, week] of weeks) {
    const pattern = days.filter((d) => week.has(d)),
      key = pattern.join(',');
    const count = patterns.get(key) ?? {
      days: pattern,
      week_count: 0,
      complete_week_count: 0,
    };
    count.week_count++;
    if (monday >= context.start! && monday + 6 <= context.end!)
      count.complete_week_count++;
    patterns.set(key, count);
  }
  const useComplete = [...patterns.values()].some(
    (p) => p.complete_week_count > 0,
  );
  const ordered = [...patterns.values()].sort(
    (a, b) =>
      (useComplete
        ? b.complete_week_count - a.complete_week_count
        : b.week_count - a.week_count) ||
      a.days.length - b.days.length ||
      a.days.join(',').localeCompare(b.days.join(',')),
  );
  const regular = ordered[0]?.days ?? [];
  const extraDates = [...calendar.entries()]
    .filter(([date]) => !regular.includes(weekday(date)))
    .sort((a, b) => a[0] - b[0])
    .map(([date, meetings]) => ({
      date: isoDate(date),
      day: weekday(date),
      meetings: meetings.map((m) => ({
        section_id: m.sectionId,
        ...presentMeeting(m),
      })),
    }));
  const weekCount =
    context.start === undefined ? 0 : (context.end! - context.start + 1) / 7;
  return {
    complete,
    metric_scope: complete
      ? 'all_published_timed_meetings'
      : 'known_dated_meetings_only',
    analysis_window:
      context.start === undefined
        ? null
        : {
            start_date: isoDate(context.start),
            end_date: isoDate(context.end!),
            calendar_days: context.end! - context.start + 1,
            week_equivalents: weekCount,
          },
    campus_dates: complete ? calendar.size : null,
    average_weekly_campus_days:
      complete && weekCount ? calendar.size / weekCount : null,
    total_gap_minutes: complete ? gaps : null,
    average_weekly_gap_minutes: complete && weekCount ? gaps / weekCount : null,
    total_campus_span_minutes: complete ? spans : null,
    total_class_minutes: complete ? classMinutes : null,
    regular_weekdays: complete ? regular : null,
    typical_week_basis: !complete
      ? 'unavailable'
      : useComplete
        ? 'modal_complete_weeks'
        : 'modal_observed_weeks',
    exceptional_dates: complete ? extraDates : null,
    week_patterns: complete ? ordered : null,
  } as const;
}
