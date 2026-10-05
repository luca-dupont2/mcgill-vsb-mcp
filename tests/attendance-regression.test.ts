import { expect, it } from 'vitest';
import { generateSchedules } from '../src/scheduling.js';
import { course, meeting, section } from './helpers.js';
it('reports one exceptional Thursday without making Thursday a regular campus day', () => {
  const result = generateSchedules([
    course('A', [
      section('A', [
        meeting(600, 660, ['monday'], {
          startDate: '2027-01-04',
          endDate: '2027-01-31',
        }),
        meeting(600, 660, ['thursday'], {
          startDate: '2027-01-07',
          endDate: '2027-01-07',
        }),
      ]),
    ]),
  ]);
  expect(result.schedules[0]).toMatchObject({
    days_on_campus: 1,
    days: ['monday'],
  });
});
