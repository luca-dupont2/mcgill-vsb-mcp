import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { parseSeats, seatAttributes } from './seats.js';
import type { SeatSettings } from './seats.js';
import { meetingSchema, normalizeCourseCode } from '../models.js';
import type {
  CourseSections,
  Day,
  Meeting,
  Section,
  Term,
  VsbScoreBlock,
} from '../models.js';

const arrayTags = new Set([
  'course',
  'offering',
  'uselection',
  'selection',
  'block',
  'timeblock',
  'error',
  'rs',
  'linkCourse',
]);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => arrayTags.has(name),
});
function xml(input: string): unknown {
  if (
    /<!DOCTYPE|<!ENTITY/i.test(input) ||
    XMLValidator.validate(input) !== true
  ) {
    throw new AppError('upstream_data_invalid', 'VSB returned invalid XML.');
  }
  return parser.parse(input) as unknown;
}
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new AppError(
      'upstream_data_invalid',
      'VSB response does not match the expected schema.',
      {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
    );
  return parsed.data;
}
const errorNode = z.union([z.string(), z.object({ '#text': z.string() })]);
const errorsSchema = z.union([
  z.string(),
  z.object({ error: z.array(errorNode).default([]) }),
]);
const numeric = z.string().regex(/^\d+$/).transform(Number);
const timeblock = z.object({
  id: z.string().min(1),
  day: numeric,
  t1: numeric,
  t2: numeric,
  d1: numeric.optional(),
  d2: numeric.optional(),
  xm: z.string().optional(),
  ot: z.string().optional(),
});
const block = z.object({
  ...(Object.fromEntries(
    seatAttributes.map((key) => [key, z.string().optional()]),
  ) as Record<(typeof seatAttributes)[number], z.ZodOptional<z.ZodString>>),
  key: z.string().min(1),
  cartid: z.string().optional(),
  secNo: z.string().min(1),
  type: z.string().min(1),
  status: z.string().optional(),
  teacher: z.string().optional(),
  location: z.string().optional(),
  timeblockids: z.string(),
  loos: z.string().optional(),
  n: z.string().optional(),
  credits: z.string().optional(),
  creditsMax: z.string().optional(),
  campus: z.string().optional(),
  ot: z.string().optional(),
});
const selection = z.object({
  block: z.array(block).min(1),
  cmkey: z.string().optional(),
  credits: z.string().optional(),
  creditsMax: z.string().optional(),
});
const uselection = z.object({
  bs: z
    .string()
    .regex(/^(?:-?\d+(?:,-?\d+)*)?$/)
    .optional(),
  selection: z.array(selection).min(1),
  timeblock: z.array(timeblock).default([]),
});
const course = z.object({
  key: z.string(),
  code: z.string(),
  number: z.string(),
  faculty: z.string().optional(),
  linkCourse: z.array(z.unknown()).default([]),
  uselection: z.array(uselection).default([]),
  offering: z
    .array(z.object({ title: z.string().min(1), desc: z.string().optional() }))
    .min(1),
});
const response = z.object({
  addcourse: z.object({
    errors: errorsSchema.optional(),
    classdata: z
      .object({
        course: z.array(course).default([]),
        term: z.object({ n: z.string() }).optional(),
      })
      .optional(),
  }),
});

export function vsbDate(code: number): string {
  if (!Number.isInteger(code) || code < 1 || code > 73049)
    throw new AppError(
      'upstream_data_invalid',
      'VSB meeting date is outside the supported range.',
    );
  return new Date(Date.UTC(2008, 0, 1) + (code - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
}
const vsbDays: Day[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const components: Record<string, string> = {
  Lec: 'lecture',
  Lab: 'lab',
  Tut: 'tutorial',
  Conf: 'conference',
  Sem: 'seminar',
  'Lab-Tuto': 'lab-tutorial',
  Intern: 'internship',
  Pract: 'practicum',
  Studio: 'studio',
};
function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}
function plainText(value: string | undefined): string | undefined {
  return optionalText(value?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
}
function credits(value: string | undefined): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed <= Number.MAX_SAFE_INTEGER
    ? parsed
    : undefined;
}
function delivery(code: string): NonNullable<Section['delivery']> {
  // VSB labels c as on-campus, o/l as online, and f as off-campus.
  if (!/^[colf]+$/.test(code)) return 'unknown';
  const modes = [code.includes('c'), /[ol]/.test(code), code.includes('f')];
  if (modes.filter(Boolean).length > 1) return 'mixed';
  return modes[0] ? 'on_campus' : modes[1] ? 'online' : 'off_campus';
}
function locations(input: string | undefined): Record<string, string> {
  if (!input) return {};
  try {
    return z.record(z.string(), z.string()).parse(JSON.parse(input));
  } catch {
    throw new AppError(
      'upstream_data_invalid',
      'VSB per-meeting locations are not valid JSON.',
    );
  }
}

export function parseSections(
  input: string,
  requestedCode: string,
  term: Term,
  seatSettings: SeatSettings = { specificCounts: true, reservedCounts: false },
): CourseSections {
  const root = validate(response, xml(input)).addcourse;
  const messages =
    typeof root.errors === 'object'
      ? root.errors.error.map((e) => (typeof e === 'string' ? e : e['#text']))
      : root.errors?.trim()
        ? [root.errors.trim()]
        : [];
  if (messages.length) {
    const text = messages.join('; ');
    const code = /could not be found/i.test(text)
      ? 'course_not_found'
      : /only available in the term|not currently available in any term/i.test(
            text,
          )
        ? 'course_not_offered'
        : 'upstream_error';
    throw new AppError(code, text, {
      course_code: requestedCode,
      term: term.label,
    });
  }
  if (!root.classdata)
    throw new AppError('upstream_data_invalid', 'VSB omitted classdata.');
  if (root.classdata.term && root.classdata.term.n !== term.id)
    throw new AppError(
      'upstream_data_invalid',
      'VSB returned a different term.',
    );
  const c = root.classdata.course.find(
    (c) => normalizeCourseCode(`${c.code} ${c.number}`) === requestedCode,
  );
  if (!c)
    throw new AppError(
      'course_not_found',
      'No matching course returned by VSB.',
      { course_code: requestedCode, term: term.label },
    );
  if (c.linkCourse.length)
    throw new AppError(
      'unsupported_linkage',
      'VSB specifies cross-course section linkage that this MVP cannot verify.',
      { course_code: requestedCode },
    );
  const sections = new Map<string, Section>();
  const bundles = new Map<string, string[]>();
  const bundleScoreBlocks: Record<string, VsbScoreBlock[]> = {};
  const warnings = new Set<string>([
    'Public VSB may omit instructor and location. VSB may omit optional activities that do not require registration.',
  ]);
  for (const u of c.uselection) {
    const times = new Map<string, z.infer<typeof timeblock>>();
    for (const time of u.timeblock) {
      const existing = times.get(time.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(time))
        throw new AppError(
          'upstream_data_invalid',
          'VSB returned contradictory meeting identifiers.',
          { timeblock_id: time.id },
        );
      times.set(time.id, time);
    }
    for (const sel of u.selection) {
      if (sel.cmkey && normalizeCourseCode(sel.cmkey) !== requestedCode)
        throw new AppError(
          'unsupported_linkage',
          'VSB supplied a selection linked to a different course.',
        );
      const bundle: string[] = [];
      for (const b of sel.block) {
        const id = `${term.id}:${requestedCode.replace(' ', '')}:${b.key}`;
        const meetings: Meeting[] = [];
        const locs = locations(b.loos);
        for (const tid of b.timeblockids.split(',').filter(Boolean)) {
          const t = times.get(tid);
          if (!t)
            throw new AppError(
              'upstream_data_invalid',
              'Section references a missing meeting.',
              { section_id: id, timeblock_id: tid },
            );
          const day = vsbDays[t.day - 1];
          if (!day)
            throw new AppError(
              'upstream_data_invalid',
              'VSB supplied an invalid weekday.',
            );
          if (t.xm === '1') {
            warnings.add(
              'Exam timeblocks are excluded; this server checks class timetables.',
            );
            continue;
          }
          if (!t.d1 || !t.d2)
            warnings.add(
              `Section ${id} has missing meeting date bounds; conflicts assume unconstrained missing dates.`,
            );
          const location = optionalText(locs[tid] ?? b.location);
          const m = validate(meetingSchema, {
            days: [day],
            startMinutes: t.t1,
            endMinutes: t.t2,
            ...(t.d1 && t.d1 > 0 ? { startDate: vsbDate(t.d1) } : {}),
            ...(t.d2 && t.d2 > 0 ? { endDate: vsbDate(t.d2) } : {}),
            ...(location ? { location } : {}),
          });
          if (
            !meetings.some(
              (existing) => JSON.stringify(existing) === JSON.stringify(m),
            )
          )
            meetings.push(m);
          if (t.ot)
            warnings.add(`Section ${id} has an upstream meeting note: ${t.ot}`);
        }
        meetings.sort(
          (a, b) =>
            vsbDays.indexOf(a.days[0]!) - vsbDays.indexOf(b.days[0]!) ||
            a.startMinutes - b.startMinutes ||
            (a.startDate ?? '').localeCompare(b.startDate ?? ''),
        );
        const instructor = optionalText(b.teacher);
        const crn = optionalText(b.key);
        const status = optionalText(b.status);
        const sectionCredits = credits(b.credits);
        const sectionCreditsMax = credits(b.creditsMax);
        const campus = optionalText(b.campus);
        const deliveryCode = optionalText(b.ot);
        const notes = plainText(b.n);
        const s: Section = {
          id,
          courseCode: requestedCode,
          term: term.label,
          section: b.secNo,
          component: components[b.type] ?? b.type.toLowerCase(),
          active: status === 'A',
          seats: parseSeats(b, seatSettings),
          meetings,
          ...(crn ? { crn } : {}),
          ...(instructor ? { instructor } : {}),
          ...(status ? { status } : {}),
          ...(sectionCredits !== undefined ? { credits: sectionCredits } : {}),
          ...(sectionCreditsMax !== undefined &&
          (sectionCredits === undefined || sectionCreditsMax >= sectionCredits)
            ? { creditsMax: sectionCreditsMax }
            : {}),
          ...(campus ? { campus } : {}),
          ...(deliveryCode
            ? { delivery: delivery(deliveryCode), deliveryCode }
            : {}),
          ...(notes ? { notes } : {}),
        };
        if (!status)
          warnings.add(
            `Section ${id} has unknown status and is excluded from generated schedules.`,
          );
        if (!meetings.length)
          warnings.add(
            `Section ${id} has no published timed meetings; its time conflicts cannot be ruled out.`,
          );
        if (notes) warnings.add(`Section ${id} note: ${notes}`);
        const previous = sections.get(id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(s))
          throw new AppError(
            'upstream_data_invalid',
            'VSB returned inconsistent duplicate section records.',
            { section_id: id },
          );
        sections.set(id, s);
        bundle.push(id);
      }
      bundle.sort();
      const bundleKey = bundle.join('|');
      bundles.set(bundleKey, bundle);
      if (u.bs !== undefined && !u.timeblock.some((t) => t.xm === '1')) {
        const encoded = u.bs ? u.bs.split(',').map(Number) : [];
        if (
          encoded.length % 2 ||
          encoded.some(
            (n) => !Number.isSafeInteger(n) || n < -1 || n > 0xffffffff,
          )
        )
          throw new AppError(
            'upstream_data_invalid',
            'VSB ranking blocks have invalid encoding.',
          );
        const scoreBlocks: VsbScoreBlock[] = [];
        for (let i = 0; i < encoded.length; i += 2) {
          const clock = encoded[i]!,
            date = encoded[i + 1]!;
          if (clock === -1 && date === -1) continue;
          if (clock < 0 || date < 0)
            throw new AppError(
              'upstream_data_invalid',
              'VSB ranking block has an invalid sentinel.',
            );
          const begin = (clock & 0x3fff0000) >>> 16,
            finish = clock & 0x3fff;
          const day = vsbDays[Math.floor(begin / 1440)];
          const startBoundary = vsbDate(date >>> 16),
            endBoundary = vsbDate(date & 0xffff);
          if (!day || startBoundary > endBoundary)
            throw new AppError(
              'upstream_data_invalid',
              'VSB ranking block has invalid days or date boundaries.',
            );
          scoreBlocks.push({
            day,
            startMinutes: begin % 1440,
            endMinutes: finish % 1440,
            startBoundary,
            endBoundary,
          });
        }
        if (
          bundleScoreBlocks[bundleKey] &&
          JSON.stringify(bundleScoreBlocks[bundleKey]) !==
            JSON.stringify(scoreBlocks)
        )
          throw new AppError(
            'upstream_data_invalid',
            'VSB returned inconsistent duplicate ranking bundles.',
          );
        bundleScoreBlocks[bundleKey] = scoreBlocks;
      }
    }
  }
  const description = plainText(
    [
      ...new Set(
        c.offering.map((o) => plainText(o.desc)).filter((d) => d !== undefined),
      ),
    ].join('\n\n'),
  );
  const faculty = optionalText(c.faculty);
  // Selection credits describe each required part of a complete source choice.
  // Compare complete alternatives rather than summing all offered sections.
  const totals = c.uselection.map((u) => {
    const values = u.selection.map((s) => credits(s.credits));
    return values.every((v) => v !== undefined)
      ? values.reduce((sum, v) => sum + v, 0)
      : undefined;
  });
  const maxima = c.uselection.map((u) => {
    const values = u.selection.map((s) => credits(s.creditsMax ?? s.credits));
    return values.every((v) => v !== undefined)
      ? values.reduce((sum, v) => sum + v, 0)
      : undefined;
  });
  const courseCredits =
    totals.length && totals.every((v) => v !== undefined && v === totals[0])
      ? totals[0]
      : undefined;
  const courseCreditsMax =
    maxima.length && maxima.every((v) => v !== undefined && v === maxima[0])
      ? maxima[0]
      : undefined;
  return {
    course: {
      code: requestedCode,
      title: c.offering
        .map((o) => o.title)
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(' / '),
      term: term.label,
      ...(description ? { description } : {}),
      ...(faculty ? { faculty } : {}),
      ...(courseCredits !== undefined ? { credits: courseCredits } : {}),
      ...(courseCreditsMax !== undefined &&
      courseCredits !== undefined &&
      courseCreditsMax >= courseCredits
        ? { creditsMax: courseCreditsMax }
        : {}),
    },
    term: term.label,
    sections: [...sections.values()].sort((a, b) => a.id.localeCompare(b.id)),
    bundles: [...bundles.values()].sort((a, b) =>
      a.join('|').localeCompare(b.join('|')),
    ),
    linkage: c.uselection.length ? 'provided' : 'unavailable',
    bundleScoreBlocks,
    warnings: [...warnings].sort(),
  };
}

const suggestionSchema = z.object({
  add_suggest: z.object({
    results: z.object({
      rs: z
        .array(
          z.object({
            '#text': z.string(),
            info: z.string(),
            reason: z.string().optional(),
          }),
        )
        .default([]),
    }),
  }),
});
export function parseSuggestions(input: string): {
  codes: string[];
  hasMore: boolean;
} {
  const r = validate(suggestionSchema, xml(input)).add_suggest.results.rs;
  return {
    codes: [
      ...new Set(
        r
          .filter((x) => x['#text'] !== '_more_' && !/\bonly\)/i.test(x.info))
          .map((x) => normalizeCourseCode(x['#text'])),
      ),
    ],
    hasMore: r.some((x) => x['#text'] === '_more_'),
  };
}

export function parseTerms(input: string): Term[] {
  const ids = [...input.matchAll(/terms\.push\(["'](\d{6})["']\)/g)].map(
    (m) => m[1]!,
  );
  if (!ids.length)
    throw new AppError(
      'upstream_data_invalid',
      'VSB did not publish recognizable term identifiers.',
    );
  return [...new Set(ids)].sort().map((id) => {
    const season = { '01': 'Winter', '05': 'Summer', '09': 'Fall' }[
      id.slice(4)
    ];
    if (!season)
      throw new AppError(
        'upstream_data_invalid',
        'VSB published an unsupported term.',
      );
    return {
      year: Number(id.slice(0, 4)),
      season: season as Term['season'],
      id,
      label: `${id.slice(0, 4)} ${season}`,
    };
  });
}
