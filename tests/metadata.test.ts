import { describe, expect, it } from 'vitest';
import { parseSections } from '../src/adapters/parsing.js';
import { normalizeTerm, presentCourse } from '../src/models.js';
import { presentSectionsView } from '../src/tools/response-view.js';
import { fixture } from './helpers.js';

const term = normalizeTerm('2027 Winter');
const source = fixture('ecse206-winter2027.xml');
const parse = (input = source) => parseSections(input, 'ECSE 206', term);

describe('public VSB course metadata', () => {
  it('preserves description, faculty, course credits and zero-credit components', () => {
    const course = parse();
    expect(course.course).toMatchObject({
      faculty: 'Faculty of Engineering',
      credits: 3,
      creditsMax: 3,
      description: expect.stringContaining('Fourier'),
    });
    expect(course.sections[0]).toMatchObject({
      credits: 3,
      campus: 'DOWNTOWN',
      delivery: 'on_campus',
      deliveryCode: 'c',
    });
    expect(course.sections[1]!.credits).toBe(0);
    expect(
      parseSections(fixture('math263-winter2027.xml'), 'MATH 263', term).course
        .credits,
    ).toBe(3);
  });
  it('cleans section notes and retains the existing warning', () => {
    const course = parseSections(
      fixture('phil237-winter2027.xml'),
      'PHIL 237',
      term,
    );
    expect(course.sections[0]!.notes).toBe(
      'Plus Conference Waitlist section-use Quick Add',
    );
    expect(course.warnings).toContain(
      `Section ${course.sections[0]!.id} note: Plus Conference Waitlist section-use Quick Add`,
    );
    expect(course.sections[0]!.notes).not.toContain('<br');
  });
  it.each([
    ['o', 'online'],
    ['l', 'online'],
    ['co', 'mixed'],
    ['cl', 'mixed'],
    ['f', 'off_campus'],
    ['cf', 'mixed'],
    ['new-code', 'unknown'],
  ])(
    'normalizes delivery %s without discarding the source code',
    (code, expected) => {
      const course = parse(source.replace('ot="c"', `ot="${code}"`));
      expect(course.sections[0]).toMatchObject({
        delivery: expected,
        deliveryCode: code,
      });
    },
  );
  it('omits absent or malformed metadata without breaking the timetable', () => {
    const course = parse(
      source
        .replace(/ desc="[^"]*"/g, '')
        .replace(/ faculty="[^"]*"/g, '')
        .replace(/ credits="[^"]*"/g, ' credits="bad"')
        .replace(/ creditsMax="[^"]*"/g, ' creditsMax="-1"')
        .replace(/ campus="[^"]*"/g, '')
        .replace(/ ot="c"/g, ''),
    );
    expect(course.course).not.toHaveProperty('description');
    expect(course.course).not.toHaveProperty('faculty');
    expect(course.course).not.toHaveProperty('credits');
    expect(course.sections[0]).not.toHaveProperty('credits');
    expect(course.sections[0]).not.toHaveProperty('campus');
    expect(course.sections[0]).not.toHaveProperty('delivery');
    expect(course.sections[0]!.meetings).toHaveLength(2);
  });
  it('does not infer course credits from inconsistent alternatives or sum all offered sections', () => {
    const compSource = fixture('comp202-winter2027.xml');
    expect(parseSections(compSource, 'COMP 202', term).course.credits).toBe(3);
    const inconsistent = compSource.replace(
      /(<selection[^>]*\bcredits=")3\.0/,
      '$16.0',
    );
    expect(
      parseSections(inconsistent, 'COMP 202', term).course,
    ).not.toHaveProperty('credits');
    const range = parse(sourceForRange());
    expect(range.course).toMatchObject({ credits: 3, creditsMax: 6 });
    const inverted = parse(
      source.replaceAll('creditsMax="3.0"', 'creditsMax="2.0"'),
    );
    expect(inverted.course).not.toHaveProperty('creditsMax');
    expect(inverted.sections[0]).not.toHaveProperty('creditsMax');
  });
  it('keeps short metadata in compact views and descriptions only in full lookups', () => {
    const course = parse();
    const full = presentSectionsView(course);
    const compact = presentSectionsView(course, 'compact');
    expect(full.course).toHaveProperty('description');
    expect(compact.course).not.toHaveProperty('description');
    expect(compact.course).toMatchObject({
      faculty: 'Faculty of Engineering',
      credits: 3,
      credits_max: 3,
    });
    expect(full.sections[0]).toMatchObject({
      credits: 3,
      credits_max: 3,
      campus: 'DOWNTOWN',
      delivery: 'on_campus',
      delivery_code: 'c',
    });
    expect(compact.sections[1]).toHaveProperty('credits', 0);
    expect(presentCourse(course.course, true)).not.toHaveProperty('creditsMax');
    expect(presentCourse(course.course, true)).not.toHaveProperty(
      'description',
    );
  });
});
function sourceForRange() {
  return source.replaceAll('creditsMax="3.0"', 'creditsMax="6.0"');
}
