import { metricsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

interface QueryPayload {
  from?: string;
  namespace?: string;
  limit?: number; // Max workloads to return (for large environments)
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

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Extract workload name from a container_group_instance entity display name.
 * Entity names in Dynatrace have format: "pod-name container-name"
 * Pod names follow K8s naming: deployment-<rs-hash>-<pod-hash>
 *
 * Uses known cloud_application entity names to validate extraction.
 */
function extractWorkloadName(entityName: string, knownWorkloads: Set<string>): string {
  // Step 1: Strip container name (everything after the first space)
  const podName = entityName.split(' ')[0];

  // Step 2: Check if the full pod name is itself a known workload (unlikely but safe)
  if (knownWorkloads.has(podName)) return podName;

  const parts = podName.split('-');

  // Step 3: Try Deployment pattern — name-<rs-hash>-<pod-hash>
  if (parts.length >= 3) {
    const last = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    if (/^[a-z0-9]{5}$/.test(last) && /^[a-z0-9]{6,10}$/.test(secondLast)) {
      const candidate = parts.slice(0, parts.length - 2).join('-');
      return candidate;
    }
  }

  // Step 4: Try StatefulSet pattern — name-<ordinal>
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
      return parts.slice(0, parts.length - 1).join('-');
    }
    // DaemonSet/Job — name-<hash>, only strip if result matches a known workload
    if (/^[a-z0-9]{5,10}$/.test(last)) {
      const candidate = parts.slice(0, parts.length - 1).join('-');
      if (knownWorkloads.has(candidate)) return candidate;
    }
  }

  return podName;
}

async function runDQL(query: string): Promise<Record<string, any>[]> {
  try {
    const response = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 30000, fetchTimeoutSeconds: 60 },
    });
    if (response.state === 'SUCCEEDED' && response.result?.records) {
      return response.result.records as Record<string, any>[];
    }
    return [];
  } catch {
    return [];
  }
}

// ── Main Function ───────────────────────────────────────────────────────

export default async function (payload: QueryPayload) {
  const { from: rawFrom = 'now()-24h', namespace, limit = 200 } = payload || {};
  const metricsFrom = rawFrom.replace('now()', 'now');

  const errors: string[] = [];
  const diagnostics: string[] = [];

  // ── Step 1: Discover available K8s metrics (workload + container level) ──────
  const metricKeys: Array<{ key: string; name: string; unit: string }> = [];
  const seenKeys = new Set<string>();

  // Search for both workload-level and container-level metrics
  for (const term of [
    'kubernetes workload',
    'cloud.kubernetes.workload',
    'builtin:cloud.kubernetes',
    'kubernetes container',
    'containers cpu',
    'containers memory',
    'containers.cpu',
    'containers.memory'
  ]) {
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
            metricKeys.push({ key, name: (m as any).displayName || '', unit: (m as any).unit || '' });
          }
        }
      }
    } catch (e) {
      errors.push('Discovery: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  diagnostics.push('Discovered ' + metricKeys.length + ' metric keys');

  // Separate workload-level vs container-level metrics
  const workloadMetrics = metricKeys.filter(m =>
    m.key.includes('workload') || m.key.includes('cloud_application')
  );
  const containerMetrics = metricKeys.filter(m => m.key.includes('containers.'));

  diagnostics.push('Workload-level metrics: ' + workloadMetrics.length);
  diagnostics.push('Container-level metrics: ' + containerMetrics.length);
  if (workloadMetrics.length > 0) {
    diagnostics.push('Workload metric keys: ' + JSON.stringify(workloadMetrics.map(m => m.key)));
  }

  // ── Step 2: Identify the 6 needed metrics (prefer workload-level) ─────────
  const availableMetrics = workloadMetrics.length > 0 ? workloadMetrics : containerMetrics;

  function findKey(...patterns: string[]): { key: string; unit: string } | null {
    for (const p of patterns) {
      const found = availableMetrics.find(m => m.key.toLowerCase().includes(p.toLowerCase()));
      if (found) return { key: found.key, unit: found.unit };
    }
    return null;
  }

  const cpuUsageInfo = findKey('cpu.usageMilliCores', 'cpu.usage', 'cpu_usage');
  const cpuReqInfo = findKey('cpu.requestMilliCores', 'cpu.request', 'cpu_request');
  const cpuLimInfo = findKey('cpu.limitMilliCores', 'cpu.limit', 'cpu_limit');
  // Prefer byte-based memory metrics — avoid matching usagePercent first
  let memUsageInfo = findKey('memory.residentSetBytes', 'memory.workingSetBytes', 'memory.usageBytes');
  let memIsPercent = false;
  if (!memUsageInfo) {
    // Fall back to percentage metric if no byte-based one found
    memUsageInfo = findKey('memory.usagePercent');
    if (memUsageInfo) {
      memIsPercent = true;
      diagnostics.push('WARNING: Memory usage metric is percentage-based, will convert using limits');
    }
  }
  const memReqInfo = findKey('memory.requestBytes', 'memory.request', 'memory_request');
  const memLimInfo = findKey('memory.limitBytes', 'memory.limit', 'memory_limit');

  const keys: Record<string, string | null> = {
    cpuUsage: cpuUsageInfo?.key || null,
    cpuRequests: cpuReqInfo?.key || null,
    cpuLimits: cpuLimInfo?.key || null,
    memUsage: memUsageInfo?.key || null,
    memRequests: memReqInfo?.key || null,
    memLimits: memLimInfo?.key || null,
  };

  diagnostics.push('Mapped keys: ' + JSON.stringify(keys));
  diagnostics.push('Container metrics with units: ' + JSON.stringify(containerMetrics.map(m => m.key + ' [' + m.unit + ']')));

  if (!keys.cpuUsage && !keys.memUsage) {
    return {
      success: false, data: [], discoveredKeys: keys,
      allMetricKeys: metricKeys.map(m => m.key).sort(), diagnostics,
      errors: [...errors, 'No container CPU or memory usage metrics found'],
    };
  }

  // ── Step 3: Get metric dimensions ─────────────────────────────────
  const firstKey = keys.cpuUsage || keys.memUsage || '';
  let entityDim = 'dt.entity.container_group_instance';

  try {
    const descriptor = await metricsClient.metric({
      metricKey: firstKey, acceptType: 'application/json; charset=utf-8',
    });
    const dims = ((descriptor as any).dimensionDefinitions || []).map((d: any) => d.key || d.name || '');
    diagnostics.push('Dimensions for ' + firstKey + ': ' + JSON.stringify(dims));
    const entityDims = dims.filter((d: string) => d.startsWith('dt.entity.'));
    if (entityDims.length > 0) entityDim = entityDims[0];
  } catch (e) {
    diagnostics.push('Dimension lookup failed: ' + String(e));
  }

  // ── Step 4: Build entity mapping ──────────────────────────────────

  // 4a: Get cloud_application entities (= K8s workloads) to validate name extraction
  const workloadEntities = await runDQL(
    'fetch dt.entity.cloud_application, from:' + rawFrom +
    ' | fieldsKeep id, entity.name | limit 500'
  );

  const knownWorkloadNames = new Set<string>();
  const workloadIdToName = new Map<string, string>();
  for (const r of workloadEntities) {
    const name = r['entity.name'] as string;
    const id = r['id'] as string;
    if (name) knownWorkloadNames.add(name);
    if (id && name) workloadIdToName.set(id, name);
  }
  diagnostics.push('Known workloads: ' + workloadEntities.length);

  // 4b: Build workload name → namespace mapping
  const workloadNameToNamespace = new Map<string, string>();
  let nsResolved = 0;

  // Get namespace entities
  const nsEntities = await runDQL(
    'fetch dt.entity.cloud_application_namespace, from:' + rawFrom +
    ' | fieldsKeep id, entity.name | limit 200'
  );
  const nsIdToName = new Map<string, string>();
  for (const r of nsEntities) {
    if (r.id && r['entity.name']) nsIdToName.set(r.id, r['entity.name']);
  }

  // Approach A: cloud_application → belongs_to → cloud_application_namespace
  const wlWithNs = await runDQL(
    'fetch dt.entity.cloud_application, from:' + rawFrom +
    ' | expand ns_id = belongs_to[dt.entity.cloud_application_namespace]' +
    ' | fieldsKeep id, entity.name, ns_id | limit 500'
  );
  for (const r of wlWithNs) {
    const wlName = r['entity.name'] as string;
    const nsId = r['ns_id'] as string;
    if (wlName && nsId) {
      const nsName = nsIdToName.get(nsId);
      if (nsName) { workloadNameToNamespace.set(wlName, nsName); nsResolved++; }
    }
  }
  diagnostics.push('Approach A (belongs_to): ' + nsResolved + '/' + wlWithNs.length);

  // Approach B: If A failed, try from namespace side with contains
  if (nsResolved === 0 && nsEntities.length > 0) {
    const nsWithApps = await runDQL(
      'fetch dt.entity.cloud_application_namespace, from:' + rawFrom +
      ' | expand app_id = contains[dt.entity.cloud_application]' +
      ' | fieldsKeep entity.name, app_id | limit 500'
    );
    for (const r of nsWithApps) {
      const nsName = r['entity.name'] as string;
      const appId = r['app_id'] as string;
      if (nsName && appId) {
        const wlName = workloadIdToName.get(appId);
        if (wlName) { workloadNameToNamespace.set(wlName, nsName); nsResolved++; }
      }
    }
    diagnostics.push('Approach B (contains): ' + nsResolved);
  }

  // Approach C: If still empty, inspect raw entity fields for namespace info
  if (nsResolved === 0 && workloadEntities.length > 0) {
    const rawSample = await runDQL(
      'fetch dt.entity.cloud_application, from:' + rawFrom + ' | limit 2'
    );
    if (rawSample.length > 0) {
      diagnostics.push('cloud_application sample fields: ' + JSON.stringify(Object.keys(rawSample[0])));
      // Check for any field containing a known namespace name
      const nsNames = Array.from(nsIdToName.values());
      for (const r of rawSample) {
        for (const [field, value] of Object.entries(r)) {
          if (typeof value === 'string' && nsNames.includes(value) && field !== 'entity.name') {
            diagnostics.push('Found NS in field "' + field + '": ' + value);
          }
        }
      }
    }
  }

  // Approach D: Fallback — if user selected a namespace, assign it to all workloads
  if (nsResolved === 0 && namespace) {
    diagnostics.push('Fallback: using selected namespace "' + namespace + '" for all workloads');
    for (const name of knownWorkloadNames) {
      workloadNameToNamespace.set(name, namespace);
    }
  }

  diagnostics.push('Namespace map: ' + workloadNameToNamespace.size + ' entries');

  // 4c: Get container_group_instance entities for entity ID → pod name mapping
  const cgiEntities = await runDQL(
    'fetch dt.entity.container_group_instance, from:' + rawFrom +
    ' | fieldsKeep id, entity.name | limit 2000'
  );

  const entityIdToEntityName = new Map<string, string>();
  for (const r of cgiEntities) {
    if (r.id && r['entity.name']) entityIdToEntityName.set(r.id, r['entity.name']);
  }
  diagnostics.push('CGI entities: ' + cgiEntities.length);
  // Show samples for debugging
  if (cgiEntities.length > 0) {
    diagnostics.push('CGI ID sample: "' + (cgiEntities[0].id || '') + '"');
    diagnostics.push('CGI name sample: "' + (cgiEntities[0]['entity.name'] || '') + '"');
  }

  // ── Step 5: Query metrics splitBy entity dimension ────────────────
  const workloadMap = new Map<string, WorkloadRow>();
  const seenEntityIds = new Set<string>(); // Track unique entity IDs from metrics

  async function queryMetric(
    metricKey: string | null,
    field: keyof WorkloadRow,
    aggregation: 'avg' | 'max'
  ) {
    if (!metricKey) return;

    const selector = metricKey + ':splitBy("' + entityDim + '"):' + aggregation + ':fold(' + aggregation + ')';

    try {
      const result = await metricsClient.query({
        metricSelector: selector,
        from: metricsFrom,
        acceptType: 'application/json; charset=utf-8',
      });

      if (result.result) {
        for (const series of result.result) {
          if (series.data) {
            for (const dp of series.data) {
              const entityId =
                (dp.dimensionMap && dp.dimensionMap[entityDim]) ||
                (dp.dimensions && dp.dimensions[0]) || '';

              // Track entity IDs for diagnostic purposes
              if (entityId && seenEntityIds.size < 5) seenEntityIds.add(entityId);

              // Resolve entity ID → entity name → workload name
              const entityName = entityIdToEntityName.get(entityId) || entityId;
              const workloadName = extractWorkloadName(entityName, knownWorkloadNames);

              // Resolve namespace
              const ns = workloadNameToNamespace.get(workloadName) || (namespace || 'unknown');

              // Skip if namespace filter active and doesn't match
              if (namespace && ns !== namespace && ns !== 'unknown') continue;

              const mapKey = ns + '/' + workloadName;

              if (!workloadMap.has(mapKey)) {
                workloadMap.set(mapKey, {
                  workloadName, namespace: ns,
                  cpuAvg: null, cpuMax: null, cpuReq: null, cpuLim: null,
                  memAvg: null, memMax: null, memReq: null, memLim: null,
                });
              }

              const row = workloadMap.get(mapKey)!;
              const values = (dp.values || []).filter((v: any) => v !== null) as number[];
              if (values.length > 0) {
                const val = values[values.length - 1];
                const current = (row as any)[field] as number | null;
                if (current === null) {
                  (row as any)[field] = val;
                } else if (aggregation === 'max') {
                  (row as any)[field] = Math.max(current, val);
                } else {
                  (row as any)[field] = (current + val) / 2;
                }
              }
            }
          }
        }
      }
    } catch (e) {
      errors.push('Query ' + metricKey + ' (' + aggregation + '): ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  await Promise.all([
    queryMetric(keys.cpuUsage, 'cpuAvg', 'avg'),
    queryMetric(keys.cpuUsage, 'cpuMax', 'max'),
    queryMetric(keys.cpuRequests, 'cpuReq', 'avg'),
    queryMetric(keys.cpuLimits, 'cpuLim', 'avg'),
    queryMetric(keys.memUsage, 'memAvg', 'avg'),
    queryMetric(keys.memUsage, 'memMax', 'max'),
    queryMetric(keys.memRequests, 'memReq', 'avg'),
    queryMetric(keys.memLimits, 'memLim', 'avg'),
  ]);

  // ── Step 6: Post-processing ───────────────────────────────────────
  const data = Array.from(workloadMap.values());

  // Convert memory percentage to bytes if needed
  if (memIsPercent) {
    for (const row of data) {
      if (row.memLim !== null && row.memLim > 0) {
        if (row.memAvg !== null) row.memAvg = (row.memAvg / 100) * row.memLim;
        if (row.memMax !== null) row.memMax = (row.memMax / 100) * row.memLim;
      } else {
        // Cannot convert without limit — null out the values
        row.memAvg = null;
        row.memMax = null;
      }
    }
    diagnostics.push('Converted memory percentage to bytes using limits');
  }

  // Add entity ID diagnostics
  if (seenEntityIds.size > 0) {
    diagnostics.push('Metric entity IDs sample: ' + JSON.stringify(Array.from(seenEntityIds)));
    diagnostics.push('Entity map has ' + entityIdToEntityName.size + ' entries');
    // Check if any metric entity IDs match map keys
    let matchCount = 0;
    for (const id of seenEntityIds) {
      if (entityIdToEntityName.has(id)) matchCount++;
    }
    diagnostics.push('Match rate: ' + matchCount + '/' + seenEntityIds.size + ' metric entity IDs found in DQL map');
  }

  // Filter by namespace
  const filtered = namespace
    ? data.filter(d => d.namespace === namespace || d.namespace === 'unknown')
    : data;

  // Apply result limit for large environments (prevents response size limit errors)
  const totalWorkloads = filtered.length;
  const limited = filtered.slice(0, limit);
  const wasTruncated = limited.length < totalWorkloads;

  diagnostics.push(`Workloads with data: ${totalWorkloads}${wasTruncated ? ` (returning first ${limit})` : ''}`);
  if (wasTruncated) {
    errors.push(`TRUNCATED: Showing ${limit} of ${totalWorkloads} workloads. Select a specific namespace to see fewer results.`);
  }

  // In production mode (large environments), only return essential data
  // Include diagnostics only if there are errors or no data
  // TEMPORARY: Always include debug info to troubleshoot entity resolution
  const includeDebugInfo = true; // errors.length > 0 || limited.length === 0;

  return {
    success: true,
    data: limited,
    errors,
    totalCount: totalWorkloads,
    returnedCount: limited.length,
    // Only include heavy diagnostic data if needed
    ...(includeDebugInfo ? {
      discoveredKeys: keys,
      allMetricKeys: metricKeys.map(m => m.key).sort(),
      diagnostics,
    } : {}),
  };
}
