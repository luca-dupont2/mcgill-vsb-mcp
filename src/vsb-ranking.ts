import type { VsbScoreBlock } from './models.js';
import { days } from './models.js';

export const vsbModes = [
  'most_days_off',
  'mornings',
  'midday_classes',
  'evenings',
  'time_off_campus',
  'most_on_campus',
] as const;
export type VsbMode = (typeof vsbModes)[number];
export const rankingModes = [
  ...vsbModes,
  'minimize_gaps',
  'avoid_days',
  'avoid_times',
  'section_id',
] as const;
export type RankingMode = (typeof rankingModes)[number];
export const objectiveDescriptions: Record<RankingMode, string> = {
  most_days_off:
    'VSB date-segment-weighted absent weekdays; same-date blocks contribute zero.',
  mornings: 'VSB penalty for daily latest end after 11:00.',
  midday_classes:
    'VSB squared distances of daily earliest start/latest end from 13:00.',
  evenings: 'VSB penalty for daily earliest start before 18:00.',
  time_off_campus:
    'VSB negative daily earliest-to-latest campus span, date-segment weighted.',
  most_on_campus:
    'VSB class duration, date-segment weighted; not the first-to-last campus span.',
  minimize_gaps:
    'Actual between-class gap minutes over the shared analysis window.',
  avoid_days:
    'Actual campus dates on avoid_days over the shared analysis window.',
  avoid_times:
    'Actual class minutes outside avoid_before/avoid_after over the shared analysis window.',
  section_id: 'Sorted section IDs, compared lexicographically.',
};

export type Ranking = {
  mode?: RankingMode | undefined;
  tie_breakers?: RankingMode[] | undefined;
  avoid_days?: (typeof days)[number][] | undefined;
  avoid_before?: string | undefined;
  avoid_after?: string | undefined;
};
export const VSB_SCORING = {
  version: 'vsb_date_segments_v1',
  source_url: 'https://vsb.mcgill.ca/vsb/js/engine.js?v=3030',
  captured_at: '2026-10-05',
  formula_scope:
    'six_time_based_sort_scores; source date boundaries; original-result tie shift excluded',
} as const;

/** Independent typed implementation of VSB computeScores. All six scores prefer larger values.
 * Deliberately preserves VSB boundary arithmetic: same-date blocks have zero duration.
 * Attendance and constraints separately use inclusive dates, including those one-time meetings.
 */
export function vsbScores(blocks: VsbScoreBlock[]): Record<VsbMode, number> {
  const boundaries = [
    ...new Set(blocks.flatMap((b) => [b.startBoundary, b.endBoundary])),
  ].sort();
  const scores: Record<VsbMode, number> = {
    most_days_off: blocks.length ? 0 : 9999,
    mornings: 0,
    midday_classes: 0,
    evenings: 0,
    time_off_campus: 0,
    most_on_campus: 0,
  };
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i]!;
    const end = boundaries[i + 1]!;
    const duration = (Date.parse(end) - Date.parse(start)) / 86400000;
    const earliest = Array<number>(7).fill(-1);
    const latest = Array<number>(7).fill(-1);
    for (const b of blocks) {
      if (!(end > b.startBoundary && start < b.endBoundary)) continue;
      // VSB encodes minutes within a weekly clock and extracts each boundary modulo 1440.
      const begin = b.startMinutes % 1440;
      const finish = b.endMinutes % 1440;
      const day = (days.indexOf(b.day) + 1) % 7;
      scores.most_on_campus += (finish - begin) * duration;
      earliest[day] =
        earliest[day] === -1 ? begin : Math.min(earliest[day]!, begin);
      latest[day] =
        latest[day] === -1 ? finish : Math.max(latest[day]!, finish);
    }
    for (let day = 0; day < 7; day++) {
      const begin = earliest[day]!;
      const finish = latest[day]!;
      if (begin === -1) scores.most_days_off += duration;
      else {
        if (begin < 1080)
          scores.evenings -= Math.pow(1080 - begin, 1.6) * duration;
        scores.midday_classes -= Math.pow(begin - 780, 2) * duration;
      }
      if (finish !== -1) {
        if (finish > 660)
          scores.mornings -= Math.pow(finish - 660, 1.6) * duration;
        scores.midday_classes -= Math.pow(finish - 780, 2) * duration;
      }
      if (begin !== -1 && finish !== -1)
        scores.time_off_campus -= (finish - begin) * duration;
    }
  }
  return scores;
}
