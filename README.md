# McGill VSB MCP

Give your AI assistant direct access to McGill timetable data, without browser automation.

This local Model Context Protocol server lets agents search course offerings, fetch sections and meeting times, check conflicts, and explore schedule combinations. It queries McGill's public Visual Schedule Builder feed and returns structured data the agent can reuse across questions. Repeated requests use a short process-local cache.

No McGill login, API key, browser session, or project database is required. Your MCP client provides the assistant; this server supplies data and scheduling calculations.

## What your agent can do

Ask questions such as:

- "What sections of ECSE 206 are offered in Winter 2027?"
- "Do these lecture and tutorial sections overlap?"
- "Find schedules for ECSE 205 and MATH 263 with no classes before 10:00."
- "Keep Wednesday afternoon free and rank the remaining schedules by days off."

The server exposes four read-only tools:

| Tool                 | Purpose                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `search_courses`     | Search a published term by course code, subject, title, or keywords                                   |
| `get_sections`       | Fetch sections, timed meetings, dates, and permitted lecture/lab/tutorial combinations                |
| `check_conflicts`    | Check current section IDs or previously fetched section objects                                       |
| `generate_schedules` | Explore combinations with time/day restrictions, busy intervals, section pins, and ranking objectives |

Agents can pass fetched section objects to `check_conflicts` without another network request. Schedule calculations run locally using the published course data.

## Install and connect

Use Node.js 22.13 or newer, pnpm, and an MCP client that can launch local stdio servers. Clone this repository, then run these commands from its root:

```bash
git clone https://github.com/luca-dupont2/mcgill-vsb-mcp.git
cd mcgill-vsb-mcp
pnpm install --frozen-lockfile
pnpm build
```

Add the server to your client's MCP configuration. Replace the example path with the absolute path to your checkout:

```json
{
  "mcpServers": {
    "mcgill-vsb-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/mcgill-vsb-mcp/dist/server.js"]
    }
  }
}
```

Restart or reload your client's MCP connection. Confirm that it lists the four tools above. The client launches the server when needed; running `pnpm start` directly waits for MCP messages on stdin.

You can give your agent this instruction:

> Use the McGill VSB MCP tools for course offerings, section times, conflicts, and schedule combinations. Resolve relative terms such as "next winter" to an explicit year and season before querying. Report incomplete or provisional results when the tools indicate missing data.

Only terms currently published by VSB are available. Accepted forms include `2027 Winter`, `Winter 2027`, and `2027-winter`.

## Try the CLI

The CLI uses the same tools and adapter:

```bash
pnpm query terms
pnpm query search "ECSE" --term "2027 Winter" --limit 3
pnpm query sections "ECSE 206" --term "2027 Winter"
pnpm query schedules "ECSE 205" "MATH 263" --term "2027 Winter" --limit 5
```

Use `pnpm query terms` to find currently available terms. The example offerings can change.

For JSON inputs, pagination, conflict details, and result fields, see the [tool reference](docs/tools.md). The [ranking and attendance reference](docs/ranking.md) explains hard constraints, ranking objectives, dated exceptions, and search limits.

## Data and limits

The server reads the anonymous [McGill VSB](https://vsb.mcgill.ca/) feed directly. It preserves published section relationships and meeting date ranges. VSB's application endpoints are undocumented and can change.

- Clock times are local to Montreal. Published meeting date ranges are inclusive.
- Missing meeting times or dates produce incomplete or provisional results. Possible overlaps remain conservative.
- Instructors and locations may be absent from anonymous responses. VSB can also omit optional activities or describe alternating weeks only in notes.
- Schedule generation supports published within-course component combinations. Cross-course linkage is explicitly unsupported.
- Timetable compatibility does not establish available seats, prerequisite eligibility, or permission to register. Exams and travel time are outside the calculation.

The server handles public timetable questions. It does not access your enrolled courses, assignments, transcript, or personal academic records.

## Configuration

Set these optional variables in the server process's environment or your client's MCP configuration:

| Variable              | Default  | Purpose                                                |
| --------------------- | -------- | ------------------------------------------------------ |
| `MCGILL_CACHE_TTL_MS` | `300000` | Cache lifetime in milliseconds; `0` disables retention |
| `MCGILL_TIMEOUT_MS`   | `15000`  | Timeout for each upstream request                      |

Values must be integer milliseconds no greater than 86,400,000. The timeout must be at least 100 ms. Restart the server to clear its cache. Requests use HTTPS and require a correct system clock. MCP messages use stdout; diagnostics use stderr.

## Development and verification

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Tests run offline using synthetic cases and a small set of anonymous public timetable [fixtures](tests/fixtures/README.md). CI runs these checks on pushes and pull requests. `pnpm dev` runs the source server during development.

After building, run `pnpm verify:live` to exercise all four tools through the compiled stdio server against McGill. Run `pnpm verify:ranking` to check all six VSB ranking modes, conflict checks, pins, and exclusions. These scripts use public example courses; live assertions can fail if offerings change or McGill is unreachable. `MCGILL_SMOKE_TERM` overrides their default term. Save local reports under `.local/`, which Git ignores.

## License and attribution

The project code uses the [MIT license](LICENSE). Public timetable fixtures contain upstream scheduling facts; the project license does not grant rights to McGill or VSB content, names, or branding.

This is an independent project, unaffiliated with McGill University, VSB, or [mcgill.courses](https://mcgill.courses/). It does not use the mcgill.courses API.
