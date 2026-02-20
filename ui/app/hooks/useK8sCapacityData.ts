import { useState, useCallback, useEffect } from 'react';
import { queryGrail, queryWorkloadMetricsGrail } from '../utils/appFunctions';
import { analyzeWorkload, calculateSummary } from '../utils/recommendations';
import type { WorkloadCapacityData, CapacitySummary, UseK8sCapacityDataReturn } from '../../../src/types/k8s';

// ============================================================================
// Entity Query Builders (DQL — these work reliably via Grail)
// ============================================================================

function buildClustersQuery(): string {
  return `fetch dt.entity.kubernetes_cluster
| fieldsKeep id, entity.name
| sort entity.name asc`;
}

function buildNamespacesQuery(clusterId?: string): string {
  if (clusterId) {
    return `fetch dt.entity.cloud_application_namespace
| filter clustered_by[dt.entity.kubernetes_cluster] == "${clusterId}"
| fieldsKeep entity.name
| sort entity.name asc`;
  }
  return `fetch dt.entity.cloud_application_namespace
| fieldsKeep entity.name
| sort entity.name asc`;
}

// ============================================================================
// Constants
// ============================================================================

const EMPTY_SUMMARY: CapacitySummary = {
  totalWorkloads: 0, optimalCount: 0, overProvisionedCount: 0,
  underProvisionedCount: 0, noDataCount: 0, noConfigCount: 0,
  estimatedCpuWasteMilli: 0, estimatedMemoryWasteBytes: 0,
};

// ============================================================================
// Hook
// ============================================================================

export function useK8sCapacityData(): UseK8sCapacityDataReturn {
  const [clusters, setClusters] = useState<string[]>([]);
  const [clusterIdMap, setClusterIdMap] = useState<Record<string, string>>({}); // name -> id
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadCapacityData[]>([]);
  const [summary, setSummary] = useState<CapacitySummary>(EMPTY_SUMMARY);

  const [selectedCluster, setSelectedClusterState] = useState<string>('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('');
  const [timeRange, setTimeRange] = useState<string>('now()-24h');

  const [loading, setLoading] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkload, setSelectedWorkload] = useState<string | null>(null);

  // ── Load clusters ────
  const loadClusters = useCallback(async () => {
    try {
      const clustersResult = await queryGrail(buildClustersQuery());

      if (clustersResult.success) {
        const clusterList: string[] = [];
        const idMap: Record<string, string> = {};

        for (const r of clustersResult.data) {
          const id = (r as any)['id'] as string;
          const name = (r as any)['entity.name'] as string;
          if (name && id) {
            clusterList.push(name);
            idMap[name] = id;
          }
        }

        setClusters(clusterList);
        setClusterIdMap(idMap);
      }
    } catch (err) {
      console.error('Error loading clusters:', err);
      setError('Failed to load clusters: ' + String(err));
    }
  }, []);

  // ── Load namespaces for selected cluster ────
  const loadNamespaces = useCallback(async (clusterName: string) => {
    setLoadingFilters(true);
    try {
      const clusterId = clusterIdMap[clusterName];
      const nsResult = await queryGrail(buildNamespacesQuery(clusterId));

      if (nsResult.success && nsResult.data.length > 0) {
        const nsNames = nsResult.data
          .map((r: any) => r['entity.name'] as string)
          .filter(Boolean);
        setNamespaces(Array.from(new Set(nsNames)).sort());
      } else {
        setNamespaces([]);
      }
    } catch (err) {
      console.error('Error loading namespaces:', err);
      setError('Failed to load namespaces: ' + String(err));
    } finally {
      setLoadingFilters(false);
    }
  }, [clusterIdMap]);

  const setSelectedCluster = useCallback((cluster: string) => {
    setSelectedClusterState(cluster);
    // Reset namespace selection when cluster changes
    setSelectedNamespace('');
    // Load namespaces for the selected cluster
    if (cluster) {
      loadNamespaces(cluster);
    }
  }, [loadNamespaces]);

  // ── Load workload data via Grail timeseries queries ─────────────────────
  const loadWorkloadData = useCallback(async () => {
    setLoading(true);
    setSelectedWorkload(null);
    setError(null);

    try {
      // Determine cluster and namespace filters
      let clusterParam: string | undefined;
      let nsParam: string | undefined;

      if (selectedCluster && selectedCluster !== 'all') {
        clusterParam = selectedCluster;
      }

      if (selectedNamespace && selectedNamespace !== 'all') {
        nsParam = selectedNamespace;
      }

      const result = await queryWorkloadMetricsGrail({
        from: timeRange,
        cluster: clusterParam,
        namespace: nsParam,
      });

      // Build diagnostic info for display
      const diagLines: string[] = [];
      if (result.diagnostics && result.diagnostics.length > 0) {
        diagLines.push('=== METRIC DISCOVERY ===');
        diagLines.push(...result.diagnostics);
      }
      if (result.discoveredKeys) {
        diagLines.push('');
        diagLines.push('Mapped metric keys:');
        for (const [role, key] of Object.entries(result.discoveredKeys)) {
          diagLines.push('  ' + role + ': ' + (key || '(not found)'));
        }
      }
      if (result.allMetricKeys && result.allMetricKeys.length > 0) {
        diagLines.push('');
        diagLines.push('All discovered K8s metric keys (' + result.allMetricKeys.length + '):');
        for (const key of result.allMetricKeys) {
          diagLines.push('  ' + key);
        }
      }
      if (result.errors && result.errors.length > 0) {
        diagLines.push('');
        diagLines.push('Errors:');
        diagLines.push(...result.errors);
      }

      if (!result.success) {
        setError('DIAGNOSTIC: ' + diagLines.join('\n'));
        setWorkloads([]);
        setSummary(EMPTY_SUMMARY);
        return;
      }

      // Analyze each workload row with the recommendation engine
      const analyzed: WorkloadCapacityData[] = (result.data || []).map((row) =>
        analyzeWorkload({
          workloadName: row.workloadName || 'unknown',
          namespace: row.namespace || 'unknown',
          cpuRequests: row.cpuReq ?? null,
          cpuLimits: row.cpuLim ?? null,
          cpuMedian: row.cpuAvg ?? 0,
          cpuPeak: row.cpuMax ?? 0,
          memoryRequests: row.memReq ?? null,
          memoryLimits: row.memLim ?? null,
          memoryMedian: row.memAvg ?? 0,
          memoryPeak: row.memMax ?? 0,
        })
      );

      // Sort by severity (red first, then yellow, green, gray)
      const severityOrder: Record<string, number> = { red: 0, yellow: 1, green: 2, gray: 3 };
      analyzed.sort((a, b) => {
        const sA = severityOrder[a.overallSeverity] ?? 4;
        const sB = severityOrder[b.overallSeverity] ?? 4;
        if (sA !== sB) return sA - sB;
        return a.workloadName.localeCompare(b.workloadName);
      });

      setWorkloads(analyzed);
      setSummary(calculateSummary(analyzed));

      // Show diagnostics if no data found, or partial errors
      if (analyzed.length === 0 && diagLines.length > 0) {
        setError('DIAGNOSTIC: No workload data found.\n\n' + diagLines.join('\n'));
      } else if (result.errors && result.errors.length > 0) {
        setError('DIAGNOSTIC (partial errors):\n' + result.errors.join('\n'));
      }
    } catch (err) {
      console.error('Error loading workload data:', err);
      setError('Failed to load workload data: ' + String(err));
      setWorkloads([]);
      setSummary(EMPTY_SUMMARY);
    } finally {
      setLoading(false);
    }
  }, [selectedNamespace, selectedCluster, timeRange]);

  const refetch = useCallback(() => {
    loadClusters();
    if (selectedCluster) {
      loadNamespaces(selectedCluster);
    }
  }, [loadClusters, loadNamespaces, selectedCluster]);

  // Load clusters on mount
  useEffect(() => {
    loadClusters();
  }, [loadClusters]);

  // Load namespaces when cluster changes
  useEffect(() => {
    if (selectedCluster) {
      loadNamespaces(selectedCluster);
    } else {
      setNamespaces([]);
    }
  }, [selectedCluster, loadNamespaces]);

  // Load workload data when filters change
  useEffect(() => {
    if (selectedCluster && selectedNamespace) {
      loadWorkloadData();
    }
  }, [selectedCluster, selectedNamespace, loadWorkloadData]);

  return {
    clusters,
    namespaces,
    workloads,
    summary,
    selectedCluster,
    selectedNamespace,
    timeRange,
    loading,
    loadingFilters,
    error,
    selectedWorkload,
    setSelectedCluster,
    setSelectedNamespace,
    setTimeRange,
    setSelectedWorkload,
    refetch,
  };
}

export default useK8sCapacityData;
