import type { DirectCourseApplication, DirectCourseApplicationResponse } from './ssg/api/direct-course-application-api';

/** TPG pagination is 1-based. Never return an incomplete batch as a success. */
export async function collectDirectApplicationPages(
  fetchPage: (page: number) => Promise<DirectCourseApplicationResponse>, pageSize: number, maxPages = 100,
) {
  const applications: DirectCourseApplication[] = [];
  const seen = new Set<string>();
  let total = 0;
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const response = await fetchPage(page);
    pages++;
    const hasError = response.error?.message || response.error?.details?.length
      || (response.error?.code && String(response.error.code) !== '0');
    if (hasError && Number(response.status) !== 404) throw new Error(response.error?.message || 'TPGateway returned an application retrieval error');
    const current = response.data?.courseApplications;
    if (!Array.isArray(current)) throw new Error('Unexpected TPGateway response: application list is missing');
    total = Number(response.meta?.total ?? total);
    if (!current.length) break;
    let added = 0;
    for (const application of current) {
      const id = String(application.applicationId || '').trim();
      if (!id) throw new Error('TPGateway returned an application without an ID');
      if (seen.has(id)) continue;
      seen.add(id); applications.push(application); added++;
    }
    if (!added) throw new Error('TPGateway repeated a page; retrieval is incomplete');
    if (total > 0 && applications.length >= total) break;
    if (current.length < pageSize) break;
    if (page === maxPages) throw new Error('TPGateway pagination limit reached; retrieval is incomplete');
  }
  if (total > applications.length) throw new Error(`Incomplete TPGateway retrieval: received ${applications.length} of ${total} applications`);
  return { applications, total, pages };
}
