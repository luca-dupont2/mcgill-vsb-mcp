# McGill VSB MCP

An [MCP](https://modelcontextprotocol.io) server that gives your AI agents direct access to McGill timetable data through VSB.

Your agents can quickly and on-demand : search course offerings, fetch sections and meeting times, check conflicts, and explore schedule combinations. It queries McGill's public Visual Schedule Builder feed and returns structured data the agent can reuse across questions. Repeated requests use a short process-local cache.

No McGill login, API key, browser session, or project database is required.

## Tools

| Tool                 | Purpose                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| `list_terms`         | Discover terms currently published by VSB                                                             |
| `search_courses`     | Search a published term by course code, subject, title, or keywords                                   |
| `get_sections`       | Fetch sections, timed meetings, dates, and permitted lecture/lab/tutorial combinations                |
| `get_sections_batch` | Fetch up to 12 courses in one call, with a separate result or error for each course                   |
| `check_conflicts`    | Check current section IDs or previously fetched section objects                                       |
| `generate_schedules` | Explore combinations with time/day restrictions, busy intervals, section pins, and ranking objectives |

Agents can pass fetched section objects to `check_conflicts` without another network request. Schedule calculations run locally using the published course data.

Full section lookups also include course descriptions. Both views retain published credits, faculty, campus, delivery mode, and section notes; search results include faculty and credits. Empty metadata is omitted.

Section lookups include reported seats remaining, full/open status, and waitlist counts. Use `refresh: true` for a new VSB observation. Total capacity and reservation breakdowns are returned only when published; availability does not establish registration eligibility.

Section lookups and schedule generation accept `view: "compact"` to reduce response size while retaining source details, warnings, and verification flags. The default `full` view preserves complete section objects and dated attendance details. Compact section IDs work with `check_conflicts`; full objects are required for checks without a network request.

## Install and connect

Install [Node.js](https://nodejs.org/en/download) 22.13 or newer.

Use an MCP client that supports local stdio servers.

### CLI agent harnesses

For any harness that supports local stdio MCP servers, configure these launch settings:

| Setting   | Value                        |
| --------- | ---------------------------- |
| Transport | `stdio`                      |
| Command   | `npx`                        |
| Arguments | `-y`, `mcgill-vsb-mcp@0.5.0` |

Configuration formats may differ between harnesses.

<details>
<summary>Codex CLI</summary>

Run these commands in your terminal:

```bash
codex mcp add mcgill-vsb-mcp -- npx -y mcgill-vsb-mcp@0.5.0
codex mcp list
```

Start a new Codex session and run `/mcp` to check the active connection. Alternatively, add this table to `~/.codex/config.toml`:

```toml
[mcp_servers.mcgill-vsb-mcp]
command = "npx"
args = ["-y", "mcgill-vsb-mcp@0.5.0"]
```

See the [Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

</details>

<details>
<summary>Claude Code</summary>

Run this command to make the server available across your projects:

```bash
claude mcp add --transport stdio --scope user mcgill-vsb-mcp -- npx -y mcgill-vsb-mcp@0.5.0
```

Start a new Claude Code session and run `/mcp` to check the connection. See [Claude Code's MCP guide](https://code.claude.com/docs/en/mcp).

</details>

### Desktop and editor clients

[![Install in Cursor](https://img.shields.io/badge/Install_in-Cursor-black)](https://cursor.com/link/mcp/install?name=mcgill-vsb-mcp&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIm1jZ2lsbC12c2ItbWNwQDAuNS4wIl19)
[![Install in VS Code](https://img.shields.io/badge/Install_in-VS_Code-007ACC)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522mcgill-vsb-mcp%2522%252C%2522type%2522%253A%2522stdio%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522mcgill-vsb-mcp%25400.5.0%2522%255D%257D)

These buttons add the configuration to the installed client. Review and approve it, then enable the server's tools. Node.js must already be installed. The first connection downloads the package and can take longer than later connections.

<details>
<summary>Cursor / Claude Desktop / other stdio clients</summary>

For Cursor, edit `~/.cursor/mcp.json` to use the server across projects, or `.cursor/mcp.json` for a single project. In Claude Desktop, open **Settings → Developer → Edit Config**. Other clients have their own MCP configuration location.

Merge this entry into your client's configuration, preserving existing servers:

```json
{
  "mcpServers": {
    "mcgill-vsb-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcgill-vsb-mcp@0.5.0"]
    }
  }
}
```

Enable the server in Cursor's MCP settings and use Agent mode. Fully quit and reopen Claude Desktop after saving its configuration.

If a Windows client cannot launch `npx`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "mcgill-vsb-mcp@0.5.0"]`.

See [Cursor's MCP guide](https://cursor.com/docs/mcp) and the [local MCP server setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

</details>

<details>
<summary>VS Code / GitHub Copilot</summary>

Use the install button above, or run this command with the [VS Code CLI](https://code.visualstudio.com/docs/configure/command-line) on your PATH:

```bash
code --add-mcp '{"name":"mcgill-vsb-mcp","type":"stdio","command":"npx","args":["-y","mcgill-vsb-mcp@0.5.0"]}'
```

The command uses bash or zsh. For manual configuration, run **MCP: Open User Configuration** from the Command Palette. Add the following entry to `servers`, preserving existing entries. VS Code uses `servers`, rather than `mcpServers`:

```json
{
  "servers": {
    "mcgill-vsb-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcgill-vsb-mcp@0.5.0"]
    }
  }
}
```

Start the server from the configuration editor and accept the trust prompt. Use Copilot's agent chat with the tools enabled. See [VS Code's MCP guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers).

</details>

### Build from source instead

For development or a local source installation, install [pnpm](https://pnpm.io/installation) and Git, then run:

```bash
git clone https://github.com/luca-dupont2/mcgill-vsb-mcp.git
cd mcgill-vsb-mcp
pnpm install --frozen-lockfile
pnpm build
node -p "require('node:path').resolve('dist/server.js')"
```

Use `"command": "node"` and `"args": ["/absolute/path/to/mcgill-vsb-mcp/dist/server.js"]` in your client's configuration. Replace the example path with the printed absolute path. Keep the checkout on your computer and rebuild after source updates.

### Check the connection

Confirm that your client lists the six tools above. The client launches the server when needed. Running `npx -y mcgill-vsb-mcp@0.5.0` in a separate terminal waits for MCP messages on stdin; it does not connect an agent by itself.

Try this prompt:

> Use McGill VSB MCP to search for ECSE courses in Winter 2027. Show three results with their course codes and titles.

Call `list_terms` to discover currently published terms. With a source checkout, `pnpm query terms` also lists them.

### Troubleshooting

- **Node or npx not found:** Install Node.js 22.13 or newer and restart the client so it receives the updated PATH. Check the client's MCP logs. On Windows, use the `cmd` configuration above if needed.
- **Package download failed:** Check internet access to `registry.npmjs.org`. The first launch needs to download the package and its dependencies.
- **No tools listed:** Reload the MCP connection or restart the client. Confirm that the server is enabled and accept any trust prompt.
- **Upstream request failed:** Check your internet connection and system clock. VSB may be unavailable, or the requested term may no longer be published.

You can give your agent this instruction:

> Use the McGill VSB MCP tools for course offerings, section times, reported seat/waitlist availability, conflicts, and schedule combinations. Use refresh=true for a new seat observation, report null counts as unavailable, and do not infer registration eligibility. Discover published terms with list_terms. Use get_sections_batch for multiple courses and compact views when detailed attendance or reusable full section objects are unnecessary. Resolve relative terms such as "next winter" to an explicit year and season before querying. Report incomplete or provisional results when the tools indicate missing data.

Only terms currently published by VSB are available. Accepted forms include `2027 Winter`, `Winter 2027`, and `2027-winter`.

## Try the CLI

With a [source checkout](#install-and-connect), the CLI uses the same tools and adapter:

```bash
pnpm query terms
pnpm query search "ECSE" --term "2027 Winter" --limit 3
pnpm query sections "ECSE 206" --term "2027 Winter" --view compact
pnpm query sections-batch "ECSE 206" "MATH 263" --term "2027 Winter" --view compact
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
pnpm verify:package
```

Tests run offline using synthetic cases and a small set of anonymous public timetable [fixtures](tests/fixtures/README.md). CI runs these checks on pushes and pull requests. `pnpm verify:package` packs the release, installs it with production dependencies in a temporary directory, and checks the npm executable and MCP tools. It requires npm registry access. `pnpm dev` runs the source server during development.

After building, run `pnpm verify:live` to exercise all six tools through the compiled stdio server against McGill. Run `pnpm verify:ranking` to check all six VSB ranking modes, conflict checks, pins, and exclusions. These scripts use public example courses; live assertions can fail if offerings change or McGill is unreachable. `MCGILL_SMOKE_TERM` overrides their default term. Save local reports under `.local/`, which Git ignores.

## License and attribution

The project code uses the [MIT license](LICENSE).
