import { z } from 'zod';
import {
  days,
  dateSchema,
  normalizeCourseCode,
  normalizeTerm,
  meetingSchema,
  timeSchema,
} from '../models.js';
import type { Section } from '../models.js';

export const termInput = z.string().min(1).max(40);
export const codeInput = z.string().min(1).max(20);
const externalMeeting = z
  .object({
    days: z.array(z.enum(days)).min(1).max(7),
    start_minutes: z.number().int().min(0).max(1439),
    end_minutes: z.number().int().min(1).max(1440),
    start: z.string().optional(),
    end: z.string().optional(),
    start_date: dateSchema.optional(),
    end_date: dateSchema.optional(),
    location: z.string().max(500).optional(),
  })
  .refine(
    (m) => m.start_minutes < m.end_minutes,
    'Meeting end must be after start.',
  )
  .refine(
    (m) => !m.start_date || !m.end_date || m.start_date <= m.end_date,
    'Meeting dates must be ordered.',
  );
export const sectionInput = z.object({
  id: z.string().min(1).max(100),
  course_code: codeInput,
  term: termInput,
  section: z.string().min(1).max(20),
  crn: z.string().max(20).optional(),
  component: z.string().min(1).max(80),
  instructor: z.string().max(500).optional(),
  status: z.string().max(30).optional(),
  active: z.boolean(),
  meetings: z.array(externalMeeting).max(100),
});
export function toSection(s: z.infer<typeof sectionInput>): Section {
  return {
    id: s.id,
    courseCode: normalizeCourseCode(s.course_code),
    term: normalizeTerm(s.term).label,
    section: s.section,
    component: s.component,
    active: s.active,
    ...(s.crn ? { crn: s.crn } : {}),
    ...(s.instructor ? { instructor: s.instructor } : {}),
    ...(s.status ? { status: s.status } : {}),
    meetings: s.meetings.map((m) =>
      meetingSchema.parse({
        days: m.days,
        startMinutes: m.start_minutes,
        endMinutes: m.end_minutes,
        ...(m.start_date ? { startDate: m.start_date } : {}),
        ...(m.end_date ? { endDate: m.end_date } : {}),
        ...(m.location ? { location: m.location } : {}),
      }),
    ),
  };
}
export const preferencesSchema = z
  .object({
    avoid_before: timeSchema.optional(),
    avoid_after: timeSchema.optional(),
    prefer_days_off: z.boolean().optional(),
    minimize_gaps: z.boolean().optional(),
    avoid_days: z.array(z.enum(days)).max(7).optional(),
  })
  .strict();
