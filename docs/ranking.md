# Ranking and attendance contract

The MCP exposes scheduling controls for agents as JSON. It does not control the VSB web interface. The anonymous `api/class-data` endpoint supplies course selections, component linkage, times, date bounds, and encoded scoring blocks. The browser itself ranks schedules locally; the MCP independently implements the six formulas from [VSB engine.js](https://vsb.mcgill.ca/vsb/js/engine.js?v=3030), inspected on 2026-10-05.

## Hard constraints

`constraints` removes invalid bundles before enumeration. All fields are optional:

```json
{
  "unavailable_days": ["friday"],
  "not_before": "10:00",
  "not_after": "18:00",
  "unavailable_times": [
    {
      "days": ["tuesday"],
      "start": "12:00",
      "end": "13:00",
      "start_date": "2026-09-01",
      "end_date": "2026-12-03"
    }
  ],
  "required_section_ids": ["ID_FROM_GET_SECTIONS"],
  "excluded_section_ids": []
}
```

Clock bounds are inclusive: a 10:00 class satisfies `not_before: "10:00"`. Busy intervals use strict overlap, so a class starting at 13:00 does not overlap 12:00–13:00. Missing busy-interval date bounds apply without that bound. End times may be `24:00`; starts must be before midnight. Dates are inclusive calendar dates. Weekday exclusions apply to every actual occurrence, including a one-time make-up class. An impossible weekday/date combination has no occurrence and cannot violate a constraint.

Section requirements must refer to the requested courses and term. Required and excluded IDs cannot intersect. A required component still needs its complete source bundle: pinning a lecture does not remove its required lab. Diagnostics count rejected bundles by reason. Inter-course clashes are pruned during enumeration and are not included in these per-course rejection counts.

Untimed bundles are excluded when attendance constraints cannot be checked. Missing dates on timed sections are treated conservatively as unbounded, consistent with conflict checking. These sections may pass conservative constraints, but their calendar metrics remain incomplete.

## Soft ranking

`ranking` changes order, never validity. `mode` is the primary objective; `tie_breakers` are ordered secondary objectives. Remaining ties use lexicographically sorted section IDs. Without ranking, section IDs provide deterministic order. No arbitrary weighting combines different objectives.

```json
{
  "mode": "most_days_off",
  "tie_breakers": ["avoid_days", "minimize_gaps"],
  "avoid_days": ["friday"]
}
```

| VSB UI label    | MCP mode          | Score meaning; larger is better                                       |
| --------------- | ----------------- | --------------------------------------------------------------------- |
| Most days off   | `most_days_off`   | Absent weekdays × date-segment duration                               |
| Mornings        | `mornings`        | Negative penalty for latest class ending after 11:00, exponent 1.6    |
| Mid-day classes | `midday_classes`  | Negative squared distance of earliest start and latest end from 13:00 |
| Evenings        | `evenings`        | Negative penalty for earliest start before 18:00, exponent 1.6        |
| Time off campus | `time_off_campus` | Negative earliest-to-latest daily campus span × segment duration      |
| Most on-campus  | `most_on_campus`  | Class duration × segment duration, matching VSB's `timeInClass` score |

These meanings come from source code, not assumptions about the UI labels. In particular, VSB's “Most on-campus” rewards time in classes, not the span between first and last class. “Time off campus” includes both classes and gaps in its span penalty. Both count all seven weekdays.

Additional modes use actual dated occurrences; smaller is better:

- `minimize_gaps`: total between-class gap minutes over the analysis window.
- `avoid_days`: count of actual campus dates on `ranking.avoid_days`. Requires a nonempty day list.
- `avoid_times`: class minutes outside `avoid_before` / `avoid_after`. Requires at least one boundary.
- `section_id`: deterministic section-ID order; use only as the primary mode without tie breakers.

Duplicate objectives and unused/missing objective parameters fail schema validation. Preference boundaries are positive windows. `preferences` remains accepted as a deprecated soft-only interface. It translates into `avoid_days`, `avoid_times`, `most_days_off`, `minimize_gaps` in that priority order when enabled. Supplying both `preferences` and `ranking` is rejected.

## Exact scoring scope and deliberate differences

VSB encodes time/date pairs in each allowed source selection's `bs` attribute. Normalization retains decoded scoring blocks separately from agent-facing meetings. Ranking uses these blocks, preserving source consolidations and date boundaries. If blocks are absent, fully dated normalized meetings provide a formula-compatible fallback, identified as `normalized_meetings`; this fallback does not claim exact source-block parity.

VSB's scoring date intervals are half-open. Its same-date blocks contribute zero duration, even though those classes require attendance. Its clock boundaries are decoded modulo 1440. The MCP preserves these rules for the six VSB modes. Actual attendance, conflict checks, and hard constraints use inclusive dates and include single-day meetings. This distinction is explicit rather than silently correcting VSB while claiming parity.

The MCP omits VSB's tiny original-result-order tie adjustment and uses deterministic section IDs instead. A tied schedule may therefore appear in a different position from the web app. Rankings describe published active source bundles, not the browser's selected/pinned courses, blocked times, closed-class switches, seat filters, or manually edited state. The MCP provides its own explicit pins and busy intervals. It does not expose enrollment availability filters because it does not establish seat availability.

`ranking.vsb_scoring` identifies the captured scoring version, source URL, and scope. Each schedule returns `ranking.scores` for every supported objective, `comparison_values` in objective order (ascending, VSB values negated), score-input provenance, unavailable objectives, and completeness. A `null` score is unknown. Known scores sort before unknown scores; any missing selected objective marks the overall ranking incomplete and prevents claiming a true optimum.

`valid_schedules_found` counts fully timed and dated candidates only. `provisional_schedules_found` counts incomplete candidates, and `candidate_schedules_found` is their sum. Counts include explored combinations omitted by the output limit. `verification_complete` is false if any explored candidate is provisional, independently of ranking-score completeness. Ranking coverage labels include both kinds of candidate.

`search_complete` distinguishes a complete enumeration from the 100,000-node ceiling. `ranking.coverage` is `all_valid_schedules` or `explored_valid_schedules`; `results_truncated` separately covers output limits. The output cap does not stop enumeration. Agents should inspect these flags before describing a result as best.

## Date-aware attendance

Every fully bounded meeting expands into its actual local calendar dates using UTC date arithmetic. Identical attendance intervals are deduplicated. Touching/overlapping daily intervals are merged when counting class minutes and gaps. Date-disjoint classes never create phantom gaps.

All eligible bundles in a request share one analysis window: the earliest published meeting start through the latest meeting end after applying hard constraints. It is a source-derived window, not an inferred official academic term calendar. It is returned explicitly and limited to 366 days. Missing dates are not filled in from other sections.

Schedule summaries expose:

- `campus_dates`: actual dates requiring attendance.
- `average_weekly_campus_days`: campus dates divided by window days / 7.
- `total_gap_minutes` and `average_weekly_gap_minutes`: actual gaps across the window and their weekly equivalent.
- `total_class_minutes` and `total_campus_span_minutes`: dated class time and daily spans.
- `regular_weekdays`: the modal weekday pattern across complete Monday–Sunday weeks. If there are no complete weeks, observed weeks are used. Ties prefer fewer weekdays, then deterministic weekday names. `typical_week_basis` states the method.
- `exceptional_dates`: attendance dates on weekdays outside that modal pattern, including their meetings and section IDs.
- `week_patterns`: frequencies of every actual weekly pattern, including partial boundary weeks.

Top-level `days` and `days_on_campus` describe that regular pattern. Top-level `total_gap_minutes` now means the actual total over the analysis window, not the previous weekly-template total. Earliest/latest times include all occurring meetings, including exceptions. With missing times or date bounds, attendance completeness is false and these aggregate calendar metrics are null; known dated meetings remain available in schedule meetings. The inferred regular pattern is descriptive, not a guarantee that every week follows it.

## Verification

`tests/fixtures/scoring-expectations.json` records independently calculated scores with their arithmetic. Tests cover overlapping date segments, single-date blocks, decoded source bundle values, and dated attendance exceptions. No original VSB scoring function is redistributed or executed.

```bash
pnpm test
pnpm build
pnpm verify:ranking
```

The live script launches the compiled stdio MCP with a public example course pair. It checks all six modes for score availability, descending order, and complete conflict-free results, then verifies pins and exclusions. Scoring formulas are checked offline against independent expectations. Live assertions can fail if those offerings change.
