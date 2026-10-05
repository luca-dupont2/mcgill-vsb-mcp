import { z } from 'zod';
import { days, dateSchema, parseTime, timeSchema } from './models.js';
import { rankingModes } from './vsb-ranking.js';
import type { Ranking, RankingMode } from './vsb-ranking.js';
import { AppError } from './errors.js';
const endTime = z.union([timeSchema, z.literal('24:00')]);
const unavailableTime = z
  .object({
    days: z.array(z.enum(days)).min(1).max(7),
    start: timeSchema,
    end: endTime,
    start_date: dateSchema.optional(),
    end_date: dateSchema.optional(),
  })
  .strict()
  .refine(
    (t) => parseTime(t.start) < parseTime(t.end),
    'Unavailable interval end must be after start.',
  )
  .refine(
    (t) => !t.start_date || !t.end_date || t.start_date <= t.end_date,
    'Unavailable dates must be ordered.',
  );
export const constraintsSchema = z
  .object({
    unavailable_days: z
      .array(z.enum(days))
      .max(7)
      .optional()
      .describe(
        'Hard exclusion: reject any meeting on these days, including dated exceptions.',
      ),
    not_before: timeSchema
      .optional()
      .describe('Hard earliest permitted start time, inclusive.'),
    not_after: endTime
      .optional()
      .describe('Hard latest permitted end time, inclusive.'),
    unavailable_times: z
      .array(unavailableTime)
      .max(50)
      .optional()
      .describe(
        'Hard busy intervals. Missing dates apply throughout the term; touching times are allowed.',
      ),
    required_section_ids: z
      .array(z.string().min(1).max(100))
      .max(100)
      .optional(),
    excluded_section_ids: z
      .array(z.string().min(1).max(100))
      .max(100)
      .optional(),
  })
  .strict()
  .refine(
    (c) =>
      !c.not_before ||
      !c.not_after ||
      parseTime(c.not_before) < parseTime(c.not_after),
    'Constraint time bounds must leave a positive window.',
  );
export type Constraints = z.infer<typeof constraintsSchema>;
export const rankingSchema = z
  .object({
    mode: z
      .enum(rankingModes)
      .default('section_id')
      .describe(
        'Primary soft ranking objective. VSB modes use its captured date-segment formulas; larger VSB scores are better. mornings penalizes ending after 11:00; midday_classes targets 13:00; evenings penalizes starting before 18:00; time_off_campus minimizes first-to-last span; most_on_campus maximizes class minutes. Same-date VSB scoring blocks contribute zero; constraints still include those meetings. Local minimize_gaps, avoid_days and avoid_times use actual dates.',
      ),
    tie_breakers: z
      .array(z.enum(rankingModes).exclude(['section_id']))
      .max(9)
      .default([])
      .describe(
        'Ordered secondary objectives. Section IDs always break remaining ties.',
      ),
    avoid_days: z
      .array(z.enum(days))
      .min(1)
      .max(7)
      .optional()
      .describe(
        'Soft campus-date penalty; requires avoid_days in the ordered objectives.',
      ),
    avoid_before: timeSchema.optional(),
    avoid_after: endTime.optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const modes = [r.mode, ...r.tie_breakers];
    if (new Set(modes).size !== modes.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Ranking objectives must be unique.',
      });
    if (r.mode === 'section_id' && r.tie_breakers.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a primary objective when using tie_breakers.',
      });
    if (modes.includes('avoid_days') !== Boolean(r.avoid_days?.length))
      ctx.addIssue({
        code: 'custom',
        message:
          'avoid_days requires both the avoid_days objective and a nonempty avoid_days list.',
      });
    if (
      modes.includes('avoid_times') !== Boolean(r.avoid_before || r.avoid_after)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'avoid_times requires both the avoid_times objective and avoid_before or avoid_after.',
      });
    if (
      r.avoid_before &&
      r.avoid_after &&
      parseTime(r.avoid_before) >= parseTime(r.avoid_after)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Preferred time bounds must leave a positive window.',
      });
  });
export type Preferences = {
  avoid_before?: string | undefined;
  avoid_after?: string | undefined;
  prefer_days_off?: boolean | undefined;
  minimize_gaps?: boolean | undefined;
  avoid_days?: (typeof days)[number][] | undefined;
};
export function resolveRanking(
  ranking?: Ranking,
  preferences?: Preferences,
): Ranking {
  if (ranking && preferences)
    throw new AppError(
      'invalid_request',
      'Supply ranking or legacy preferences, not both.',
    );
  if (ranking) return rankingSchema.parse(ranking);
  if (!preferences) return { mode: 'section_id', tie_breakers: [] };
  const modes: RankingMode[] = [];
  if (preferences.avoid_days?.length) modes.push('avoid_days');
  if (preferences.avoid_before || preferences.avoid_after)
    modes.push('avoid_times');
  if (preferences.prefer_days_off) modes.push('most_days_off');
  if (preferences.minimize_gaps) modes.push('minimize_gaps');
  return rankingSchema.parse({
    mode: modes[0] ?? 'section_id',
    tie_breakers: modes.slice(1),
    ...(preferences.avoid_days?.length
      ? { avoid_days: preferences.avoid_days }
      : {}),
    ...(preferences.avoid_before
      ? { avoid_before: preferences.avoid_before }
      : {}),
    ...(preferences.avoid_after
      ? { avoid_after: preferences.avoid_after }
      : {}),
  });
}
