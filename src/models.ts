import { z } from 'zod';
import { AppError } from './errors.js';

export const days = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;
export type Day = (typeof days)[number];
export type Term = {
  year: number;
  season: 'Winter' | 'Summer' | 'Fall';
  id: string;
  label: string;
};

export function normalizeTerm(input: string): Term {
  const match =
    /^(?:(\d{4})[\s-]+(winter|summer|fall)|(winter|summer|fall)[\s-]+(\d{4}))$/i.exec(
      input.trim(),
    );
  if (!match)
    throw new AppError(
      'invalid_term',
      'Use a term such as "2027 Winter", "Winter 2027", or "2027-winter".',
    );
  const year = Number(match[1] ?? match[4]);
  const season = (match[2] ?? match[3])!.toLowerCase();
  const canonical = {
    winter: 'Winter',
    summer: 'Summer',
    fall: 'Fall',
  } as const;
  const month = { winter: '01', summer: '05', fall: '09' } as const;
  const key = season as keyof typeof canonical;
  return {
    year,
    season: canonical[key],
    id: `${year}${month[key]}`,
    label: `${year} ${canonical[key]}`,
  };
}

export function normalizeCourseCode(input: string): string {
  const match = /^([A-Z][A-Z0-9]{2,3})[\s-]*(\d{3}[A-Z]\d?|\d{3})$/i.exec(
    input.trim(),
  );
  if (!match)
    throw new AppError(
      'invalid_course_code',
      'Use a McGill course code such as "ECSE 206".',
      { course_code: input },
    );
  return `${match[1]!.toUpperCase()} ${match[2]!.toUpperCase()}`;
}

export const dateSchema = z.iso.date();
export const meetingSchema = z
  .object({
    days: z.array(z.enum(days)).min(1).max(7),
    startMinutes: z.number().int().min(0).max(1439),
    endMinutes: z.number().int().min(1).max(1440),
    startDate: dateSchema.optional(),
    endDate: dateSchema.optional(),
    location: z.string().optional(),
  })
  .refine(
    (m) => m.startMinutes < m.endMinutes,
    'Meeting end must be after start.',
  )
  .refine(
    (m) => !m.startDate || !m.endDate || m.startDate <= m.endDate,
    'Meeting dates must be ordered.',
  );
export type Meeting = z.infer<typeof meetingSchema>;
export type SeatAvailability = {
  status:
    'available' | 'full' | 'closed' | 'cancelled' | 'unlimited' | 'unknown';
  remaining: number | null;
  capacity: number | null;
  enrolled: number | null;
  non_reserved_remaining: number | null;
  reserved_remaining: number | null;
  combined: {
    remaining: number | null;
    capacity: number | null;
    enrolled: number | null;
  };
  waitlist: {
    status: 'available' | 'full' | 'none' | 'unknown';
    remaining: number | null;
    capacity: number | null;
    enrolled: number | null;
  };
};
export type Section = {
  id: string;
  courseCode: string;
  term: string;
  section: string;
  crn?: string;
  component: string;
  instructor?: string;
  status?: string;
  active: boolean;
  seats?: SeatAvailability;
  meetings: Meeting[];
};
export type Course = { code: string; title: string; term: string };
/** VSB uses these date boundaries for segment scoring, independently of inclusive attendance dates. */
export type VsbScoreBlock = {
  day: Day;
  startMinutes: number;
  endMinutes: number;
  startBoundary: string;
  endBoundary: string;
};
export type CourseSections = {
  course: Course;
  term: string;
  sections: Section[];
  bundles: string[][];
  linkage: 'provided' | 'unavailable';
  bundleScoreBlocks?: Record<string, VsbScoreBlock[]>;
  warnings: string[];
  source?: { name: string; url: string; retrieved_at: string };
};

export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export function parseTime(time: string): number {
  z.union([timeSchema, z.literal('24:00')]).parse(time);
  const [hours, minutes] = time.split(':').map(Number);
  return hours! * 60 + minutes!;
}
export function presentMeeting(m: Meeting) {
  return {
    days: m.days,
    start: formatTime(m.startMinutes),
    end: formatTime(m.endMinutes),
    start_minutes: m.startMinutes,
    end_minutes: m.endMinutes,
    ...(m.startDate ? { start_date: m.startDate } : {}),
    ...(m.endDate ? { end_date: m.endDate } : {}),
    ...(m.location ? { location: m.location } : {}),
  };
}
export function presentSection(s: Section) {
  return {
    id: s.id,
    course_code: s.courseCode,
    term: s.term,
    section: s.section,
    component: s.component,
    ...(s.crn ? { crn: s.crn } : {}),
    ...(s.instructor ? { instructor: s.instructor } : {}),
    ...(s.status ? { status: s.status } : {}),
    active: s.active,
    ...(s.seats ? { seats: s.seats } : {}),
    meetings: s.meetings.map(presentMeeting),
  };
}
export function presentCourseSections(c: CourseSections) {
  const { bundleScoreBlocks: _internal, ...output } = c;
  void _internal;
  return { ...output, sections: c.sections.map(presentSection) };
}
