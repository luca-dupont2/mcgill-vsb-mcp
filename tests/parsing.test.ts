import { describe, expect, it } from 'vitest';
import {
  parseSections,
  parseSuggestions,
  parseTerms,
  vsbDate,
} from '../src/adapters/parsing.js';
import { normalizeCourseCode, normalizeTerm } from '../src/models.js';
import { fixture } from './helpers.js';
const term = normalizeTerm('2027 Winter');
const ecse = fixture('ecse206-winter2027.xml');
describe('source normalization', () => {
  it('normalizes real VSB times, weekdays, dates, section labels, and bundles', () => {
    const result = parseSections(ecse, 'ECSE 206', term);
    expect(result.course.title).toBe('Intro to Signals and Systems');
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({
      id: '202701:ECSE206:1973',
      section: '001',
      component: 'lecture',
      crn: '1973',
      active: true,
      meetings: [
        {
          days: ['monday'],
          startMinutes: 605,
          endMinutes: 685,
          startDate: '2027-01-05',
          endDate: '2027-04-14',
        },
        { days: ['wednesday'], startMinutes: 605, endMinutes: 685 },
      ],
    });
    expect(result.sections[0]).not.toHaveProperty('instructor');
    expect(result.sections[0]!.meetings[0]).not.toHaveProperty('location');
    expect(result.bundles).toEqual([
      ['202701:ECSE206:1973', '202701:ECSE206:1974'],
    ]);
  });
  it('deduplicates ten source bundles into two lectures and five tutorials', () => {
    const result = parseSections(
      fixture('math263-winter2027.xml'),
      'MATH 263',
      term,
    );
    expect(result.bundles).toHaveLength(10);
    expect(result.sections).toHaveLength(7);
  });
  it('retains untimed components with uncertainty', () => {
    const result = parseSections(
      fixture('ecse201-winter2027.xml'),
      'ECSE 201',
      term,
    );
    expect(result.sections[0]).toMatchObject({
      component: 'internship',
      meetings: [],
    });
    expect(result.warnings.join(' ')).toContain('cannot be ruled out');
  });
  it('keeps instructor and per-meeting location when supplied', () => {
    const enriched = ecse
      .replace(
        'teacher="" location=""',
        'teacher="Ada Example" location="BUILDING"',
      )
      .replace('loos="{}"', 'loos="{&quot;1&quot;:&quot;ROOM 1&quot;}"');
    expect(parseSections(enriched, 'ECSE 206', term).sections[0]).toMatchObject(
      {
        instructor: 'Ada Example',
        meetings: [{ location: 'ROOM 1' }, { location: 'BUILDING' }],
      },
    );
  });
  it('rejects bad times, days, missing meeting references, dates, and malformed XML', () => {
    for (const bad of [
      ecse.replace('t1="605"', 't1="bad"'),
      ecse.replace('day="2"', 'day="9"'),
      ecse.replace('timeblockids="1,2"', 'timeblockids="100"'),
      ecse
        .replace('d1="6945"', 'd1="999999"')
        .replaceAll('d1="6945"', 'd1="999999"'),
      '<addcourse>',
    ]) {
      expect(() => parseSections(bad, 'ECSE 206', term)).toThrow();
    }
    expect(() =>
      parseSections('<!DOCTYPE x [<!ENTITY x "bad">]><x/>', 'ECSE 206', term),
    ).toThrow('invalid XML');
  });
  it('rejects contradictory duplicates and cross-course linkage', () => {
    const math = fixture('math263-winter2027.xml').replace(
      'timeblockids="4,5"',
      'timeblockids="6"',
    );
    expect(() => parseSections(math, 'MATH 263', term)).toThrow(
      'inconsistent duplicate',
    );
    const linked = ecse.replace(
      '<offering',
      '<linkCourse key="OTHER-100" selectionKey="x"/><offering',
    );
    expect(() => parseSections(linked, 'ECSE 206', term)).toThrow(
      'cross-course',
    );
  });
  it('distinguishes not found, not offered, and upstream errors', () => {
    for (const [message, code] of [
      ['could not be found in any enabled term.', 'course_not_found'],
      ['is only available in the term Fall 2026.', 'course_not_offered'],
      ['is not currently available in any term.', 'course_not_offered'],
      ['Please correct your device clock.', 'upstream_error'],
    ]) {
      try {
        parseSections(
          `<addcourse><errors><error>${message}</error></errors></addcourse>`,
          'ECSE 999',
          term,
        );
        throw new Error('Expected error');
      } catch (e) {
        expect(e).toHaveProperty('code', code);
      }
    }
  });
  it('handles courses without sections and marks linkage unavailable', () => {
    const noSections = ecse.replace(/<uselection[\s\S]*?<\/uselection>/, '');
    expect(parseSections(noSections, 'ECSE 206', term)).toMatchObject({
      sections: [],
      bundles: [],
      linkage: 'unavailable',
    });
  });
  it('keeps cancelled sections explicit and excludes missing status', () => {
    expect(
      parseSections(ecse.replace('status="A"', 'status="C"'), 'ECSE 206', term)
        .sections[0],
    ).toMatchObject({ status: 'C', active: false });
    expect(
      parseSections(ecse.replace('status="A"', ''), 'ECSE 206', term)
        .sections[0]!.active,
    ).toBe(false);
  });
  it('supports term forms and McGill multi-term course suffixes', () => {
    for (const input of ['2027 Winter', 'Winter 2027', '2027-winter'])
      expect(normalizeTerm(input)).toEqual(term);
    expect(normalizeCourseCode('math-133')).toBe('MATH 133');
    expect(normalizeCourseCode('CHEM 110D1')).toBe('CHEM 110D1');
    expect(normalizeCourseCode('NUR1 200')).toBe('NUR1 200');
    expect(() => normalizeTerm('2027 Spring')).toThrow('Use a term');
    expect(() => normalizeCourseCode('https://invalid')).toThrow('course code');
  });
  it('parses terms without executing upstream JavaScript', () => {
    expect(
      parseTerms(fixture('globalsettings.js')).map((t) => t.label),
    ).toEqual(['2026 Fall', '2027 Winter']);
    expect(() => parseTerms('process.exit(0)')).toThrow('identifiers');
    expect(vsbDate(1)).toBe('2008-01-01');
    expect(vsbDate(60)).toBe('2008-02-29');
  });
  it('normalizes suggestion codes, filters other terms, and handles pagination', () => {
    expect(parseSuggestions(fixture('suggestions.xml'))).toEqual({
      codes: ['ECSE 206', 'ECSE 205'],
      hasMore: true,
    });
    expect(
      parseSuggestions('<add_suggest>0<results courses="10"/></add_suggest>'),
    ).toEqual({ codes: [], hasMore: false });
  });
});

describe('additional malformed and uncertain source records', () => {
  it('rejects contradictory duplicate meeting IDs', () => {
    const bad = ecse.replace(
      '<timeblock id="2" day="4"',
      '<timeblock id="1" day="4"',
    );
    expect(() => parseSections(bad, 'ECSE 206', term)).toThrow(
      'contradictory meeting identifiers',
    );
  });
  it('reports missing dates instead of inventing bounds', () => {
    const result = parseSections(
      ecse.replaceAll('d1="6945"', 'd1="0"'),
      'ECSE 206',
      term,
    );
    expect(result.sections[0]!.meetings[0]).not.toHaveProperty('startDate');
    expect(result.warnings.join(' ')).toContain('missing meeting date bounds');
  });
  it('preserves useful source notes and omits exam blocks', () => {
    const result = parseSections(
      ecse
        .replace('xm="0"', 'xm="1"')
        .replace(' n="" txtb=', ' n="Meets on alternating weeks." txtb='),
      'ECSE 206',
      term,
    );
    expect(result.sections[0]!.meetings).toHaveLength(1);
    expect(result.warnings.join(' ')).toContain('alternating weeks');
    expect(result.warnings.join(' ')).toContain('Exam timeblocks');
  });
});
