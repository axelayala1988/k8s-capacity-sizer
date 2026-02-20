import { queryExecutionClient } from '@dynatrace-sdk/client-query';

interface QueryPayload {
  from?: string;
  cluster?: string;
  namespace?: string;
  limit?: number;
}

interface WorkloadRow {
  workloadName: string;
  namespace: string;
  cpuAvg: number | null;
  cpuMax: number | null;
  cpuReq: number | null;
  cpuLim: number | null;
  memAvg: number | null;
  memMax: number | null;
  memReq: number | null;
  memLim: number | null;
}

async function runDQL(query: string): Promise<any> {
  try {
    console.log('[GRAIL] Executing timeseries query:', query);
    const response = await queryExecutionClient.queryExecute({
      body: {
        query,
        requestTimeoutMilliseconds: 60000,
        fetchTimeoutSeconds: 120,
      },
    });
    console.log('[GRAIL] Initial query state:', response.state);
    console.log('[GRAIL] Response keys:', Object.keys(response));
    console.log('[GRAIL] Full response:', JSON.stringify(response, null, 2));

    // If query completed immediately, return results
    if (response.state === 'SUCCEEDED') {
      console.log('[GRAIL] Query completed immediately. Record count:', response.result?.records?.length || 0);
      if (response.result?.records && response.result.records.length > 0) {
        console.log('[GRAIL] First record:', JSON.stringify(response.result.records[0], null, 2));
        console.log('[GRAIL] First record keys:', Object.keys(response.result.records[0]));
      } else {
        console.log('[GRAIL] No records in response.result.records');
        console.log('[GRAIL] response.result keys:', response.result ? Object.keys(response.result) : 'null');
      }
      return response.result;
    }

    // If query is still running, poll for results
    if (response.requestToken) {
      console.log('[GRAIL] Query did not complete immediately. Polling with token:', response.requestToken);
      return await pollQuery(response.requestToken);
    }

    console.error('[GRAIL] Query did not succeed and no requestToken provided. State:', response.state);
    return null;
  } catch (e) {
    console.error('[GRAIL] DQL query failed:', e);
    console.error('[GRAIL] Failed query was:', query);
    throw e;
  }
}

async function pollQuery(requestToken: string): Promise<any> {
  const maxAttempts = 30; // Poll for up to 30 attempts (30 seconds with 1s intervals)
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`[GRAIL] Polling attempt ${attempts}/${maxAttempts}...`);

    try {
      const pollResponse = await queryExecutionClient.queryPoll({
        requestToken,
      });

      console.log('[GRAIL] Poll state:', pollResponse.state);

      if (pollResponse.state === 'SUCCEEDED') {
        console.log('[GRAIL] Query completed via polling. Record count:', pollResponse.result?.records?.length || 0);
        return pollResponse.result;
      }

      if (pollResponse.state === 'FAILED' || pollResponse.state === 'CANCELLED') {
        console.error('[GRAIL] Query failed or was cancelled. State:', pollResponse.state);
        return null;
      }

      // Query still running, wait before next poll
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    } catch (e) {
      console.error('[GRAIL] Poll failed:', e);
      throw e;
    }
  }

  console.error('[GRAIL] Polling timed out after', maxAttempts, 'attempts');
  return null;
}

async function runDQLWithTimeframe(query: string, start: string, end: string): Promise<any> {
  try {
    console.log('[GRAIL] Executing timeseries query with timeframe params:', query);
    console.log('[GRAIL] Timeframe:', start, 'to', end);
    const response = await queryExecutionClient.queryExecute({
      body: {
        query,
        defaultTimeframeStart: start,
        defaultTimeframeEnd: end,
        requestTimeoutMilliseconds: 1000,
        fetchTimeoutSeconds: 60,
        maxResultRecords: 1000,
        maxResultBytes: 1000000,
      },
    });
    console.log('[GRAIL] Initial query state:', response.state);

    // If query completed immediately, return results
    if (response.state === 'SUCCEEDED') {
      console.log('[GRAIL] Query completed immediately. Record count:', response.result?.records?.length || 0);
      return response.result;
    }

    // If query is still running, poll for results
    if (response.requestToken) {
      console.log('[GRAIL] Query did not complete immediately. Polling with token:', response.requestToken);
      return await pollQuery(response.requestToken);
    }

    console.error('[GRAIL] Query did not succeed and no requestToken provided. State:', response.state);
    return null;
  } catch (e) {
    console.error('[GRAIL] DQL query failed:', e);
    console.error('[GRAIL] Failed query was:', query);
    throw e;
  }
}

export default async function (payload: QueryPayload) {
  const { from: rawFrom = 'now()-24h', cluster, namespace, limit = 200 } = payload || {};

  const errors: string[] = [];
  const diagnostics: string[] = [];

  try {
    // Build filters for DQL
    const clusterFilter = cluster ? `| filter k8s.cluster.name == "${cluster}"` : '';
    const nsFilter = namespace ? `| filter k8s.namespace.name == "${namespace}"` : '';

    diagnostics.push(`Querying workload metrics with filters: cluster=${cluster || 'all'}, namespace=${namespace || 'all'}, timeframe=${rawFrom}`);
    diagnostics.push('STRATEGY: Two-query approach — capture ALL workloads with usage, then overlay requests/limits');

    // ── Query 1: Get ALL workloads with USAGE metrics (baseline) ──────────────
    const usageQuery = `timeseries {
  avg(dt.kubernetes.container.cpu_usage),
  max(dt.kubernetes.container.cpu_usage),
  avg(dt.kubernetes.container.memory_working_set),
  max(dt.kubernetes.container.memory_working_set)
}, by: { k8s.workload.name, k8s.namespace.name, k8s.cluster.name }, from:${rawFrom}
${clusterFilter}
${nsFilter}`;

    diagnostics.push('Query 1 (Usage):');
    diagnostics.push(usageQuery.trim());

    const usageResult = await runDQL(usageQuery);
    const usageRecords = usageResult?.records || [];
    diagnostics.push(`Usage query returned ${usageRecords.length} records`);

    // ── Query 2: Get requests/limits separately (may return fewer results) ──────────────
    const configQuery = `timeseries {
  avg(dt.kubernetes.container.requests_cpu),
  avg(dt.kubernetes.container.limits_cpu),
  avg(dt.kubernetes.container.requests_memory),
  avg(dt.kubernetes.container.limits_memory)
}, by: { k8s.workload.name, k8s.namespace.name, k8s.cluster.name }, from:${rawFrom}
${clusterFilter}
${nsFilter}`;

    diagnostics.push('Query 2 (Requests/Limits):');
    diagnostics.push(configQuery.trim());

    const configResult = await runDQL(configQuery);
    const configRecords = configResult?.records || [];
    diagnostics.push(`Config query returned ${configRecords.length} records`);

    // Build map of config data by workload key
    const configMap = new Map<string, any>();
    for (const r of configRecords) {
      const workloadName = r['k8s.workload.name'] as string;
      if (!workloadName) continue;
      const ns = (r['k8s.namespace.name'] as string) || 'unknown';
      const clusterName = (r['k8s.cluster.name'] as string) || 'unknown';
      const key = `${clusterName}/${ns}/${workloadName}`;
      configMap.set(key, r);
    }

    diagnostics.push(`Built config map with ${configMap.size} entries`);

    // Merge: usage records are baseline, overlay config where available
    const records = usageRecords.map((usageRec) => {
      const workloadName = usageRec['k8s.workload.name'] as string;
      const ns = (usageRec['k8s.namespace.name'] as string) || 'unknown';
      const clusterName = (usageRec['k8s.cluster.name'] as string) || 'unknown';
      const key = `${clusterName}/${ns}/${workloadName}`;

      const configRec = configMap.get(key);

      return {
        ...usageRec,
        'avg(dt.kubernetes.container.requests_cpu)': configRec?.['avg(dt.kubernetes.container.requests_cpu)'] || null,
        'avg(dt.kubernetes.container.limits_cpu)': configRec?.['avg(dt.kubernetes.container.limits_cpu)'] || null,
        'avg(dt.kubernetes.container.requests_memory)': configRec?.['avg(dt.kubernetes.container.requests_memory)'] || null,
        'avg(dt.kubernetes.container.limits_memory)': configRec?.['avg(dt.kubernetes.container.limits_memory)'] || null,
      };
    });

    diagnostics.push(`Merged records: ${records.length} workloads total`);

    // Log first record if we got any data
    if (records.length > 0) {
      diagnostics.push('SUCCESS! First record keys: ' + Object.keys(records[0]).join(', '));
      diagnostics.push('First record sample: ' + JSON.stringify(records[0]).substring(0, 300));
    }

    // Process records - each record contains all metrics for a workload
    const workloadMap = new Map<string, WorkloadRow>();

    // Helper to compute avg/max from timeseries arrays
    const arrayAvg = (arr: number[] | null | undefined): number | null => {
      if (!arr || arr.length === 0) return null;
      const sum = arr.reduce((a, b) => a + b, 0);
      return sum / arr.length;
    };
    const arrayMax = (arr: number[] | null | undefined): number | null => {
      if (!arr || arr.length === 0) return null;
      return Math.max(...arr);
    };

    // Process all records - each record has all CPU + Memory metrics
    for (const r of records) {
      const workloadName = r['k8s.workload.name'] as string;
      if (!workloadName) continue;

      const ns = (r['k8s.namespace.name'] as string) || 'unknown';
      const clusterName = (r['k8s.cluster.name'] as string) || 'unknown';
      const key = `${clusterName}/${ns}/${workloadName}`;

      // Timeseries results come as arrays - need to aggregate
      const cpuUsageArr = r['avg(dt.kubernetes.container.cpu_usage)'] as number[] | null;
      const cpuMaxArr = r['max(dt.kubernetes.container.cpu_usage)'] as number[] | null;
      const cpuReqArr = r['avg(dt.kubernetes.container.requests_cpu)'] as number[] | null;
      const cpuLimArr = r['avg(dt.kubernetes.container.limits_cpu)'] as number[] | null;

      const memUsageArr = r['avg(dt.kubernetes.container.memory_working_set)'] as number[] | null;
      const memMaxArr = r['max(dt.kubernetes.container.memory_working_set)'] as number[] | null;
      const memReqArr = r['avg(dt.kubernetes.container.requests_memory)'] as number[] | null;
      const memLimArr = r['avg(dt.kubernetes.container.limits_memory)'] as number[] | null;

      workloadMap.set(key, {
        workloadName,
        namespace: ns,
        cpuAvg: arrayAvg(cpuUsageArr),
        cpuMax: arrayMax(cpuMaxArr),
        cpuReq: arrayAvg(cpuReqArr),
        cpuLim: arrayAvg(cpuLimArr),
        memAvg: arrayAvg(memUsageArr),
        memMax: arrayMax(memMaxArr),
        memReq: arrayAvg(memReqArr),
        memLim: arrayAvg(memLimArr),
      });
    }

    const data = Array.from(workloadMap.values());
    const totalWorkloads = data.length;

    // Count workloads with missing configs
    let missingConfigCount = 0;
    for (const w of data) {
      const hasAnyConfig = w.cpuReq !== null || w.cpuLim !== null || w.memReq !== null || w.memLim !== null;
      if (!hasAnyConfig && (w.cpuAvg !== null || w.memAvg !== null)) {
        missingConfigCount++;
      }
    }

    if (missingConfigCount > 0) {
      diagnostics.push(`⚠️  CRITICAL: ${missingConfigCount} workloads have usage data but NO requests/limits configured (BestEffort QoS)`);
    }

    const limited = data.slice(0, limit);
    const wasTruncated = limited.length < totalWorkloads;

    diagnostics.push(`Final workload count: ${totalWorkloads}${wasTruncated ? ` (returning first ${limit})` : ''}`);
    if (wasTruncated) {
      errors.push(`TRUNCATED: Showing ${limit} of ${totalWorkloads} workloads.`);
    }

    // Show sample data for debugging
    if (limited.length > 0) {
      diagnostics.push('Sample workload: ' + JSON.stringify(limited[0]));
    }

    return {
      success: true,
      data: limited,
      errors,
      totalCount: totalWorkloads,
      returnedCount: limited.length,
      missingConfigCount,
      diagnostics,
    };

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    errors.push('Grail query failed: ' + errorMsg);
    diagnostics.push('Full error: ' + JSON.stringify(e));

    return {
      success: false,
      data: [],
      errors,
      diagnostics,
      totalCount: 0,
      returnedCount: 0,
      missingConfigCount: 0,
    };
  }
}
