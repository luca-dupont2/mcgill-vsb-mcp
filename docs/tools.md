# Tool reference

Successful tools return `structuredContent` and an identical compact JSON text representation. Domain and upstream errors set `isError: true` and return an actionable error code. The official SDK rejects malformed boundary arguments before the tool handler runs.

## `list_terms`

```json
{}
```

Returns the terms currently published by VSB, each with `id`, `label`, `year`, and `season`, plus the source name and URL. Use a returned `label` with the other tools. The list uses the same process-local cache as course requests. It does not imply that every course is offered in every listed term.

## Response views

`get_sections`, `get_sections_batch`, and `generate_schedules` accept `view: "full"` or `view: "compact"`. The default is `full`, which preserves the existing response fields. Search results and conflict checks already return focused results and have no view option.

Compact section results omit repeated `course_code` and `term` fields from each section, and omit numeric `start_minutes` and `end_minutes` from meetings. They retain readable times, date ranges, section IDs, seat/waitlist observations, status, instructors and locations when published, component bundles, linkage, warnings, and source provenance. Each section adds `complete`, which is false when timed meetings or complete date bounds are missing. Compact section objects cannot be passed directly to `check_conflicts`; pass their IDs, or request full section objects.

Compact schedule results omit each schedule's `meetings` and detailed `attendance`. They retain section IDs, summary metrics, ranking scores and provenance, completeness, warnings, and every request-level field, including search coverage, verified and provisional counts, analysis dates, and source timestamps. Request the full view to inspect dated attendance exceptions. Compact responses reduce output size, not upstream requests or schedule calculations.

## `get_sections_batch`

```json
{
  "course_codes": ["ECSE 206", "MATH 263"],
  "term": "2027 Winter",
  "view": "compact"
}
```

Retrieves sections for 1–12 input course codes in one term. Requests run sequentially against VSB. Normalized duplicate codes are retrieved once, with their first occurrence determining result order.

The response contains canonical `term`, ordered `results`, `successful`, `failed`, and `all_succeeded`. Each successful entry has `course_code`, `ok: true`, and `data` containing the same response as `get_sections`. Each failed entry has `course_code`, `ok: false`, and an `error` object with the actionable error code and message. Invalid course syntax and upstream failures are recorded per course without discarding successful results.

A batch with per-course failures, including an entirely failed batch, returns a normal MCP result with `all_succeeded: false`. Inspect every entry's `ok` flag. Invalid request structure, an invalid or unpublished common term, or a failure to discover terms fails the whole tool call with `isError: true`. Malformed course codes retain the input string in their error entries.

## `search_courses`

```json
{ "query": "ECSE 206", "term": "2027 Winter" }
```

Example response:

```json
{
  "term": "2027 Winter",
  "courses": [
    {
      "code": "ECSE 206",
      "title": "Intro to Signals and Systems",
      "term": "2027 Winter"
    }
  ],
  "page": 0,
  "has_more": false,
  "source": "McGill VSB"
}
```

`query` supports codes, subject prefixes, titles, and description keywords as supported by VSB. Search returns courses offered in the requested term. Titles come from the course feed rather than HTML suggestion snippets.

`page` selects a zero-based VSB suggestion page. `limit` defaults to 20 and permits 1–20 results from that page. `has_more` means either upstream pages remain or the requested limit omitted matches on the current page. If you request a smaller limit, repeat that page with `limit: 20` before moving to the next page. Stale suggestions for unavailable courses are skipped; genuine upstream errors still fail the request. Results are sorted by canonical course code within each page. Source search relevance and synonym matching belong to VSB.

## `get_sections`

```json
{ "course_code": "ECSE 206", "term": "2027-winter" }
```

The output includes `course`, canonical `term`, all published `sections`, `bundles`, `linkage`, `warnings`, and source provenance. Each bundle is a complete allowed combination of section IDs supplied by VSB, including required lectures, labs, and tutorials. It is not a guessed Cartesian product of component types.

An actual Winter 2027 lecture section has this shape:

```json
{
  "id": "202701:ECSE206:1973",
  "course_code": "ECSE 206",
  "term": "2027 Winter",
  "section": "001",
  "component": "lecture",
  "crn": "1973",
  "status": "A",
  "active": true,
  "meetings": [
    {
      "days": ["monday"],
      "start": "10:05",
      "end": "11:25",
      "start_minutes": 605,
      "end_minutes": 685,
      "start_date": "2027-01-05",
      "end_date": "2027-04-14"
    },
    {
      "days": ["wednesday"],
      "start": "10:05",
      "end": "11:25",
      "start_minutes": 605,
      "end_minutes": 685,
      "start_date": "2027-01-05",
      "end_date": "2027-04-14"
    }
  ]
}
```

Instructor and location are omitted when absent. Meeting date ranges are inclusive local calendar dates; clock times are McGill's local times in Montreal. IDs include the term and upstream section key. Treat them as opaque identifiers. An empty meeting list means no timed meetings are published, not guaranteed free time.

## Seat and waitlist observations

`get_sections` and `get_sections_batch` include a `seats` object on each section in both response views. Set `refresh: true` to bypass cached course data; the default is `false`. The CLI equivalent is `--refresh` with `sections` or `sections-batch`. The course-level `source.retrieved_at` timestamps the observation. Default caching lasts five minutes, configurable with `MCGILL_CACHE_TTL_MS`; these are observations rather than a continuously updated seat feed.

| Field                    | Meaning                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `status`                 | `available`, `full`, `closed`, `cancelled`, `unlimited`, or `unknown`, as reported by VSB                    |
| `remaining`              | Published open seats in this section                                                                         |
| `capacity`               | Published maximum enrollment; currently withheld in sampled McGill responses                                 |
| `enrolled`               | Capacity minus remaining, only when both are known and consistent                                            |
| `non_reserved_remaining` | Published non-reserved open seats, only when reservation reporting is enabled                                |
| `reserved_remaining`     | Remaining minus non-reserved remaining, only when both are known and consistent; not total reserved capacity |
| `combined`               | Separate `remaining`, `capacity`, and derived `enrolled` for a shared combined-section limit, when published |
| `waitlist`               | `status` (`available`, `full`, `none`, or `unknown`), `remaining`, `capacity`, and derived `enrolled`        |

A representative observation (counts change):

```json
{
  "status": "available",
  "remaining": 12,
  "capacity": null,
  "enrolled": null,
  "non_reserved_remaining": null,
  "reserved_remaining": null,
  "combined": { "remaining": null, "capacity": null, "enrolled": null },
  "waitlist": {
    "status": "available",
    "remaining": 7,
    "capacity": 10,
    "enrolled": 3
  }
}
```

`null` means unavailable, never zero. Zero is retained when VSB reports it. Unknown seat availability, withheld/invalid counts, and unlimited-seat sentinels do not become numeric counts. If VSB disables exact count reporting, availability statuses remain but counts are null. Reservation reporting is currently disabled in McGill's public settings; the MCP does not interpret the feed's default reservation values as a verified breakdown. No program-specific reservation pools or personal eligibility are available from these observations.

The anonymous `api/class-data` response supplies the data. The implementation independently normalizes the public client's field meanings: `os`/`me` for open seats/maximum enrollment, `csos`/`csme` for combined limits, `ws`/`wc` for waitlist spaces/capacity, and `nres` for non-reserved open seats when enabled. Negative sentinels mean unavailable; `os=9999` indicates unlimited seats. No VSB source functions are redistributed. See [VSB's public settings](https://vsb.mcgill.ca/vsb/globalsettings.jsp) and [McGill's VSB FAQ](https://mcgill.service-now.com/itportal?id=kb_article_view&sysparm_article=KB0011230).

Seats remaining does not establish that you can register: reservations, restrictions, combined limits, and registration dates may still apply. Schedule generation continues to check timetable compatibility and does not filter by seats. Retrieve its section IDs with `get_sections` or `get_sections_batch` to inspect current availability.

## `check_conflicts`

Use IDs to fetch current meetings:

```json
{
  "section_ids": ["202701:ECSE206:1974", "202701:PHIL237:4468"]
}
```

Or send `sections` containing complete section objects from `get_sections`. Numeric `start_minutes` and `end_minutes` are authoritative. Optional human-readable `start` and `end` strings are ignored in calculations. Passing objects performs no network requests. Supply exactly one of `section_ids` or `sections`; an optional `term` must match every supplied section.

The observed live conflict is:

```json
{
  "term": "2027 Winter",
  "conflict": true,
  "overlaps": [
    {
      "certainty": "confirmed",
      "a": "202701:ECSE206:1974",
      "b": "202701:PHIL237:4468",
      "days": ["friday"],
      "start": "12:35",
      "end": "13:25",
      "start_minutes": 755,
      "end_minutes": 805,
      "start_date": "2027-01-05",
      "end_date": "2027-04-14"
    }
  ],
  "complete": true,
  "warnings": [
    "Checks use the currently published VSB meetings; source notes and omitted activities may affect attendance."
  ]
}
```

No detected overlap yields `conflict: false` and `overlaps: []`. `complete: false` means at least one section lacks timed meetings or complete date bounds. Each overlap has `certainty: "confirmed"` when both meetings have complete dates, or `certainty: "possible"` otherwise. `conflict: true` includes conservative possible overlaps. `complete: true` describes the supplied timed and dated meetings; VSB may still omit optional activities.

The rule is a shared weekday with `A.start < B.end` and `B.start < A.end`, plus overlapping date bounds when present. The shared weekday must actually occur in the intersecting date range. Classes that end when another starts do not conflict. Duplicate identical section objects are deduplicated; contradictory objects with the same ID fail explicitly.

## `generate_schedules`

```json
{
  "course_codes": ["ECSE 205", "MATH 263"],
  "term": "2027 Winter",
  "max_results": 5,
  "constraints": { "not_after": "18:00" },
  "ranking": {
    "mode": "most_days_off",
    "tie_breakers": ["avoid_days", "minimize_gaps"],
    "avoid_days": ["friday"]
  }
}
```

`constraints` removes schedules. `ranking` orders the remaining candidate schedules. Constraints and ranking are optional; without a ranking, section IDs provide deterministic order. Agents can pin/exclude section IDs, forbid weekdays, set inclusive earliest/latest time bounds, and provide dated or recurring busy intervals. Hard exclusions include one-time meetings.

All six VSB sort modes are exposed: `most_days_off`, `mornings`, `midday_classes`, `evenings`, `time_off_campus`, `most_on_campus`. They implement VSB's captured browser-side scoring formulas using preserved source scoring blocks. Additional objectives are `minimize_gaps`, `avoid_days`, `avoid_times`, and `section_id`. Tie breakers are ordered objectives; no hidden weighting combines them. The legacy `preferences` field remains supported as soft ranking, is deprecated, and cannot be combined with `ranking`.

Each schedule returns section IDs, normalized meetings, earliest/latest times, attendance metrics, every objective's score, comparison values, score provenance, and completeness.

`days_on_campus` describes the modal regular weekly pattern, not every attendance weekday combined. `total_gap_minutes` is the actual total across the returned analysis window; it replaces the old weekly-template metric. Exceptions retain their meetings in the full response. Missing date bounds or times produce null calendar metrics and explicit incomplete results.

VSB scoring and actual attendance are distinct: VSB assigns same-date scoring blocks zero duration. The six VSB modes preserve that behavior, while attendance and hard constraints include those meetings. Agents can use actual-date objectives or hard exclusions when that difference matters. Per-schedule `ranking.scores` and request-level objective directions describe what was optimized. Unknown scores are null; rankings with unknown selected objectives cannot establish a true optimum.

See [the complete ranking and attendance contract](ranking.md) for all fields, formulas, missing-data behavior, migration details, and scoring limits.

`max_results` defaults to 20 and permits 1–100. Requests permit at most 12 courses and explore at most 100,000 bundle search nodes. Metadata includes `candidate_schedules_found`, `valid_schedules_found`, `provisional_schedules_found`, `verification_complete`, `search_complete`, `results_truncated`, and `search_nodes_visited`, which counts explored bundle search nodes. If the search completes, ranking covers all candidate combinations. If it hits the node limit, ranking covers only explored combinations, and the warning says so. A smaller output limit does not terminate enumeration early. `ranking.coverage` distinguishes all candidate schedules from only explored candidates. Its labels retain the word `valid` for compatibility. `course_diagnostics` counts usable and rejected bundles by reason.

`valid_schedules_found` counts only combinations whose published meetings have times and complete date bounds. `provisional_schedules_found` counts combinations with missing times or dates; the two counts sum to `candidate_schedules_found`. Counts cover the entire explored search, including results omitted by `max_results`. `verification_complete` means no explored candidates are provisional; `search_complete` separately describes enumeration coverage. Ranking coverage labels include provisional candidates.

A course with no sections or no usable active bundles yields no schedules with a warning. Missing linkage for a course with sections fails with `linkage_unavailable`. Cross-course section linkage fails with `unsupported_linkage`; the server does not guess.

## Errors

Successful tools return structured JSON and an identical text representation. Domain and upstream errors set `isError: true` and include an error code and message. Common errors include `invalid_term`, `term_unavailable` with `available_terms`, `invalid_course_code`, `course_not_found`, `course_not_offered`, `invalid_section_id`, `section_not_found`, `mixed_terms`, `duplicate_course`, `linkage_unavailable`, `unsupported_linkage`, `upstream_unavailable`, and `upstream_data_invalid`.

For example:

```json
{
  "error": "course_not_found",
  "message": "No matching course returned by VSB.",
  "course_code": "ECSE 999",
  "term": "2027 Winter"
}
```
