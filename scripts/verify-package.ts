import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';

// Test what npm users receive, from a directory outside the source checkout.
const temporary = await mkdtemp(join(tmpdir(), 'mcgill-vsb-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const client = new Client({ name: 'package-verification', version: '1.0.0' });
try {
  const packed = JSON.parse(
    execFileSync(
      npm,
      ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary],
      { encoding: 'utf8', timeout: 60000 },
    ),
  ) as { filename: string; files: { path: string }[] }[];
  const artifact = packed[0]!;
  assert(artifact.files.some((file) => file.path === 'dist/server.js'));
  assert(artifact.files.some((file) => file.path === 'LICENSE'));
  assert(artifact.files.some((file) => file.path === 'README.md'));
  for (const file of artifact.files) {
    assert(
      ['package.json', 'LICENSE', 'README.md'].includes(file.path) ||
        (file.path.startsWith('dist/') && file.path.endsWith('.js')) ||
        file.path.startsWith('docs/'),
      `Unexpected public package file: ${file.path}`,
    );
  }
  execFileSync(
    npm,
    [
      'install',
      '--prefix',
      temporary,
      '--cache',
      join(temporary, 'cache'),
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--registry=https://registry.npmjs.org/',
      resolve(temporary, artifact.filename),
    ],
    { encoding: 'utf8', timeout: 120000 },
  );
  const executable = join(
    temporary,
    'node_modules/mcgill-vsb-mcp/dist/server.js',
  );
  assert(
    (await readFile(executable, 'utf8')).startsWith('#!/usr/bin/env node\n'),
  );
  await client.connect(
    new StdioClientTransport({
      command: npm,
      args: ['exec', '--no', '--', 'mcgill-vsb-mcp'],
      cwd: temporary,
      stderr: 'inherit',
    }),
  );
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    'check_conflicts',
    'generate_schedules',
    'get_sections',
    'search_courses',
  ]);
  const result = await client.callTool({
    name: 'check_conflicts',
    arguments: {
      sections: [
        {
          id: 'package-smoke-test',
          course_code: 'COMP 202',
          term: '2027 Winter',
          section: '001',
          component: 'lecture',
          active: true,
          meetings: [
            {
              days: ['monday'],
              start_minutes: 600,
              end_minutes: 660,
              start_date: '2027-01-04',
              end_date: '2027-04-16',
            },
          ],
        },
      ],
    },
  });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  const output = z
    .object({ conflict: z.boolean(), complete: z.boolean() })
    .parse(result.structuredContent);
  assert.equal(output.conflict, false);
  assert.equal(output.complete, true);
  console.log(
    `Verified ${artifact.filename}: allowed files, clean production installation, npm executable, four tools, and conflict calculation.`,
  );
} finally {
  await client.close();
  await rm(temporary, { recursive: true, force: true });
}
