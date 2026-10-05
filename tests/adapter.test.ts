import { describe, expect, it, vi } from 'vitest';
import { McGillAdapter } from '../src/adapters/mcgill.js';
import { TtlCache } from '../src/cache.js';
import { fixture } from './helpers.js';

function fakeSource() {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('globalsettings.jsp'))
      return new Response(fixture('globalsettings.js'));
    if (url.pathname.endsWith('suggestions'))
      return new Response(fixture('suggestions.xml'));
    const code = url.searchParams.get('course_0_0');
    const files: Record<string, string> = {
      'ECSE-206': 'ecse206-winter2027.xml',
      'ECSE-205': 'ecse205-winter2027.xml',
    };
    if (code && files[code]) return new Response(fixture(files[code]));
    return new Response(
      '<addcourse><errors><error>could not be found in any enabled term.</error></errors></addcourse>',
    );
  });
  return { fetcher, adapter: new McGillAdapter({ fetch: fetcher }) };
}
describe('adapter requests', () => {
  it('normalizes codes and terms, caches retrieval and preserves source observation time', async () => {
    const { fetcher, adapter } = fakeSource();
    const first = await adapter.getSections('ECSE-206', 'Winter 2027');
    first.sections.length = 0;
    const second = await adapter.getSections('ecse206', '2027-winter');
    expect(second.sections).toHaveLength(2);
    expect(second.source).toMatchObject({ name: 'McGill VSB' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = new URL(String(fetcher.mock.calls[1]![0]));
    expect(url.searchParams.get('course_0_0')).toBe('ECSE-206');
    const t = Number(url.searchParams.get('t'));
    expect(Number(url.searchParams.get('e'))).toBe(
      (t % 3) + (t % 39) + (t % 42),
    );
  });
  it('rejects unavailable terms before retrieving sections', async () => {
    const { fetcher, adapter } = fakeSource();
    await expect(
      adapter.getSections('ECSE 206', '2029 Winter'),
    ).rejects.toMatchObject({
      code: 'term_unavailable',
      details: { available_terms: ['2026 Fall', '2027 Winter'] },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fetches real titles for search results and caches the search', async () => {
    const { fetcher, adapter } = fakeSource();
    const result = await adapter.searchCourses('circuits', '2027 Winter');
    expect(result).toMatchObject({
      hasMore: true,
      courses: [{ code: 'ECSE 205' }, { code: 'ECSE 206' }],
    });
    expect(result.courses[1]!.title).toBe('Intro to Signals and Systems');
    const calls = fetcher.mock.calls.length;
    await adapter.searchCourses('circuits', '2027 Winter');
    expect(fetcher).toHaveBeenCalledTimes(calls);
    const url = new URL(String(fetcher.mock.calls[1]![0]));
    expect(url.searchParams.get('cams')).toContain('MACDONALD');
    expect(url.searchParams.get('sio')).toBe('1');
  });
  it.each(['2026 Fall', '2027 Winter'])(
    'skips stale suggestions and fills the limit for %s',
    async (term) => {
      const fetcher = vi.fn<typeof fetch>(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith('globalsettings.jsp'))
          return new Response(fixture('globalsettings.js'));
        if (url.pathname.endsWith('suggestions'))
          return new Response(
            '<add_suggest><results><rs info="">ECSE 202</rs><rs info="">ECSE 206</rs></results></add_suggest>',
          );
        if (url.searchParams.get('course_0_0') === 'ECSE-202')
          return new Response(
            '<addcourse><errors><error>ECSE 202 is not currently available in any term.</error></errors></addcourse>',
          );
        return new Response(
          fixture('ecse206-winter2027.xml').replace(
            'n="202701"',
            `n="${term === '2026 Fall' ? '202609' : '202701'}"`,
          ),
        );
      });
      const result = await new McGillAdapter({ fetch: fetcher }).searchCourses(
        'ECSE',
        term,
        1,
      );
      expect(result.courses.map((c) => c.code)).toEqual(['ECSE 206']);
      expect(result.hasMore).toBe(false);
    },
  );
  it('does not hide genuine upstream errors during search', async () => {
    const fetcher = async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('globalsettings.jsp'))
        return new Response(fixture('globalsettings.js'));
      if (url.pathname.endsWith('suggestions'))
        return new Response(fixture('suggestions.xml'));
      return new Response(
        '<addcourse><errors><error>Please correct your device clock.</error></errors></addcourse>',
      );
    };
    await expect(
      new McGillAdapter({ fetch: fetcher }).searchCourses(
        'ECSE',
        '2027 Winter',
      ),
    ).rejects.toMatchObject({ code: 'upstream_error' });
  });
  it('surfaces HTTP, network, oversized, and malformed upstream failures', async () => {
    for (const fetcher of [
      async () => new Response('bad', { status: 503 }),
      async () => {
        throw new Error('network');
      },
      async () => new Response('x'.repeat(8000001)),
      async () => new Response('<invalid>'),
    ]) {
      await expect(
        new McGillAdapter({ fetch: fetcher }).listTerms(),
      ).rejects.toMatchObject({ code: expect.stringMatching(/^upstream_/) });
    }
  });
});
describe('TTL cache', () => {
  it('expires entries and coalesces concurrent loads', async () => {
    let now = 100;
    const cache = new TtlCache<number>(10, 2, () => now);
    const load = vi.fn(async () => 42);
    expect(
      await Promise.all([cache.get('key', load), cache.get('key', load)]),
    ).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
    now = 109;
    await cache.get('key', load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 110;
    await cache.get('key', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not cache failures and bounds memory', async () => {
    const cache = new TtlCache<number>(100, 1);
    await expect(
      cache.get('a', async () => {
        throw new Error('oops');
      }),
    ).rejects.toThrow('oops');
    expect(await cache.get('a', async () => 1)).toBe(1);
    await cache.get('b', async () => 2);
    const load = vi.fn(async () => 3);
    expect(await cache.get('a', load)).toBe(3);
    expect(load).toHaveBeenCalledOnce();
  });
});
