import { z } from 'zod';
import type { McGillData } from '../adapters/mcgill.js';

export const termsSchema = z.object({}).strict();
export async function listTerms(data: McGillData) {
  const terms = await data.listTerms();
  return {
    terms: terms.map(({ id, label, year, season }) => ({
      id,
      label,
      year,
      season,
    })),
    source: {
      name: 'McGill VSB',
      url: 'https://vsb.mcgill.ca/vsb/globalsettings.jsp',
    },
  };
}
