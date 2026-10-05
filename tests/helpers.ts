import { readFileSync } from 'node:fs';
import type { CourseSections, Meeting, Section } from '../src/models.js';
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}
export function meeting(
  startMinutes: number,
  endMinutes: number,
  days: Meeting['days'] = ['tuesday'],
  extra: Partial<Meeting> = {},
): Meeting {
  return { startMinutes, endMinutes, days, ...extra };
}
export function section(
  id: string,
  meetings: Meeting[],
  extra: Partial<Section> = {},
): Section {
  return {
    id,
    courseCode: 'TEST 100',
    section: id,
    term: '2027 Winter',
    component: 'lecture',
    active: true,
    meetings,
    ...extra,
  };
}
export function course(
  code: string,
  sections: Section[],
  bundles = sections.map((s) => [s.id]),
): CourseSections {
  return {
    course: { code, title: code, term: '2027 Winter' },
    term: '2027 Winter',
    sections,
    bundles,
    linkage: 'provided',
    warnings: [],
  };
}
