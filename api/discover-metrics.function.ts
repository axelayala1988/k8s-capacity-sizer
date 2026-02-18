import { metricsClient } from '@dynatrace-sdk/client-classic-environment-v2';

interface DiscoverPayload {
  searchTerms?: string[];
}

/**
 * Discovers available metric keys using the classic Metrics API v2.
 * Metrics may be in the classic store even when not available via DQL timeseries.
 */
export default async function (payload: DiscoverPayload) {
  const { searchTerms = ['kubernetes container cpu', 'kubernetes container memory', 'containers cpu', 'containers memory'] } = payload || {};

  const allMetrics: Array<{ key: string; name: string; unit: string }> = [];
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  for (const term of searchTerms) {
    try {
      const result = await metricsClient.allMetrics({
        text: term,
        pageSize: 200,
        acceptType: 'application/json; charset=utf-8',
      });

      if (result.metrics) {
        for (const m of result.metrics) {
          const key = (m as any).metricId || '';
          if (key && !seenKeys.has(key)) {
            seenKeys.add(key);
            allMetrics.push({
              key,
              name: (m as any).displayName || '',
              unit: (m as any).unit || '',
            });
          }
        }
      }
    } catch (error) {
      errors.push(`"${term}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Sort by key for readability
  allMetrics.sort((a, b) => a.key.localeCompare(b.key));

  return {
    success: true,
    data: allMetrics,
    errors,
    totalFound: allMetrics.length,
  };
}
