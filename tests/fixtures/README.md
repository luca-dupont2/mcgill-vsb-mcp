# Fixture provenance

The XML course fixtures were captured anonymously from McGill VSB on 2026-10-05 using the public `https://vsb.mcgill.ca/vsb/api/class-data` endpoint with term `202701` and the named course. They contain public scheduling facts and no student information, credentials, or authenticated instructor/location data.

| File                     | Coverage                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `ecse206-winter2027.xml` | Lecture with two weekly meetings, linked tutorial, dates, missing instructor/location                     |
| `ecse205-winter2027.xml` | Three allowed tutorial choices                                                                            |
| `math263-winter2027.xml` | Ten bundles, repeated lecture records, multiple component alternatives                                    |
| `comp202-winter2027.xml` | Two lecture alternatives; positive three-course integration                                               |
| `phil237-winter2027.xml` | Multi-day lecture, conference note                                                                        |
| `ecse201-winter2027.xml` | Untimed internship                                                                                        |
| `globalsettings.js`      | Minimal public enabled-term and seat-visibility settings excerpt                                          |
| `suggestions.xml`        | Synthetic minimal search response following the observed format, including HTML annotation and pagination |

Only representative responses are stored. These are test inputs, not a redistributed course catalog. [The adapter parser](../../src/adapters/parsing.ts) defines the supported network format. Tests mutate these fixtures in memory to exercise malformed records, contradictory duplicates, canceled statuses, supplied locations, and missing linkage. Synthetic scheduling fixtures in `tests/helpers.ts` are independent of current McGill offerings.

## Scoring expectations

`scoring-expectations.json` contains independently calculated numeric expectations and the arithmetic used to obtain them. The synthetic case covers partially overlapping date segments, separated Monday classes, an evening Friday class, and a single-date Thursday meeting. Tests also verify empty inputs and zero-duration scoring separately from inclusive attendance.

The source bundle tests compare decoded blocks with the original XML's numeric `bs` values. No VSB scoring function is redistributed or executed. The production implementation is independently authored from the documented scoring behavior.
