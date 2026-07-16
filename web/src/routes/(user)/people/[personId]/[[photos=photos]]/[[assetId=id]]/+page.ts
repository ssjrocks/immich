import { getPerson, getPersonStatistics, getPersonVideoOccurrences } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import type { PageLoad } from './$types';

export const load = (async ({ params, url }) => {
  await authenticate(url);

  const [person, statistics, videoOccurrences] = await Promise.all([
    getPerson({ id: params.personId }),
    getPersonStatistics({ id: params.personId }),
    getPersonVideoOccurrences({ id: params.personId }),
  ]);
  const $t = await getFormatter();

  return {
    person,
    statistics,
    videoOccurrences,
    meta: {
      title: person.name || $t('person'),
    },
  };
}) satisfies PageLoad;
