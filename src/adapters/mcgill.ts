import { TtlCache } from '../cache.js';
import { AppError } from '../errors.js';
import { normalizeCourseCode, normalizeTerm } from '../models.js';
import type { Course, CourseSections, Term } from '../models.js';
import { parseSections, parseSuggestions, parseTerms } from './parsing.js';

export type McGillData = Pick<
  McGillAdapter,
  'searchCourses' | 'getSections' | 'listTerms'
>;
export type AdapterOptions = {
  ttlMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
};
const BASE = 'https://vsb.mcgill.ca/vsb/';
export class McGillAdapter {
  private readonly courses: TtlCache<CourseSections>;
  private readonly searches: TtlCache<{ courses: Course[]; hasMore: boolean }>;
  private readonly terms: TtlCache<Term[]>;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  constructor(options: AdapterOptions = {}) {
    const ttl = options.ttlMs ?? 300000;
    this.courses = new TtlCache(ttl);
    this.searches = new TtlCache(ttl);
    this.terms = new TtlCache(ttl);
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 15000;
  }
  private async request(
    path: string,
    parameters: Record<string, string> = {},
  ): Promise<string> {
    const t = Math.floor(this.now() / 60000) % 1000;
    const url = new URL(path, BASE);
    url.search = new URLSearchParams({
      ...parameters,
      t: String(t),
      e: String((t % 3) + (t % 39) + (t % 42)),
    }).toString();
    try {
      const result = await this.fetcher(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: { Accept: '*/*', 'User-Agent': 'mcgill-vsb-mcp/0.2.0' },
      });
      if (!result.ok)
        throw new AppError(
          'upstream_unavailable',
          `VSB returned HTTP ${result.status}. Retry later.`,
          { status: result.status },
        );
      // Bound responses even when upstream omits or misstates Content-Length.
      const reader = result.body?.getReader();
      if (!reader)
        throw new AppError(
          'upstream_data_invalid',
          'VSB returned an empty response.',
        );
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 8000000) {
          await reader.cancel();
          throw new AppError(
            'upstream_data_invalid',
            'VSB response exceeds the 8 MB limit. Narrow your query.',
          );
        }
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'upstream_unavailable',
        'Could not reach VSB within the request timeout. Check network access and retry.',
      );
    }
  }
  listTerms(): Promise<Term[]> {
    return this.terms.get('terms', async () =>
      parseTerms(await this.request('globalsettings.jsp')),
    );
  }
  private async availableTerm(input: string): Promise<Term> {
    const term = normalizeTerm(input);
    const available = await this.listTerms();
    if (!available.some((t) => t.id === term.id))
      throw new AppError(
        'term_unavailable',
        'This term is not currently published by VSB.',
        { term: term.label, available_terms: available.map((t) => t.label) },
      );
    return term;
  }
  async getSections(
    inputCode: string,
    inputTerm: string,
  ): Promise<CourseSections> {
    const code = normalizeCourseCode(inputCode);
    const term = await this.availableTerm(inputTerm);
    return this.courses.get(`${term.id}:${code}`, async () => {
      const result = parseSections(
        await this.request('api/class-data', {
          term: term.id,
          course_0_0: code.replace(' ', '-'),
          nouser: '1',
        }),
        code,
        term,
      );
      return {
        ...result,
        source: {
          name: 'McGill VSB',
          url: new URL('api/class-data', BASE).href,
          retrieved_at: new Date(this.now()).toISOString(),
        },
      };
    });
  }
  async searchCourses(
    query: string,
    inputTerm: string,
    limit = 20,
    page = 0,
  ): Promise<{ courses: Course[]; hasMore: boolean }> {
    const term = await this.availableTerm(inputTerm);
    let text = query.trim();
    try {
      text = normalizeCourseCode(text);
    } catch {
      /* Keyword and subject queries are also supported. */
    }
    return this.searches.get(
      `${term.id}:${text.toLowerCase()}:${limit}:${page}`,
      async () => {
        const suggestion = parseSuggestions(
          await this.request('api/courses/suggestions', {
            term: term.id,
            course_add: text,
            page_num: String(page),
            sio: '1',
            sco: '0',
            cams: 'DISTANCE,DOWNTOWN,MACDONALD,OFF-CAMPUS',
            already: '',
          }),
        );
        const courses: Course[] = [];
        // Fetch actual titles rather than exposing suggestions' HTML/description snippets.
        // Sequential retrieval avoids bursts against the public upstream.
        let examined = 0;
        for (const code of suggestion.codes) {
          if (courses.length >= limit) break;
          examined++;
          try {
            courses.push((await this.getSections(code, term.label)).course);
          } catch (e) {
            if (!(
              e instanceof AppError &&
              ['course_not_offered', 'course_not_found'].includes(e.code)
            ))
              throw e;
          }
        }
        return {
          courses: courses.sort((a, b) => a.code.localeCompare(b.code)),
          hasMore: suggestion.hasMore || examined < suggestion.codes.length,
        };
      },
    );
  }
}
