import { useState, useCallback, useEffect, useMemo } from 'react';
import { queryGrail, queryWorkloadMetrics } from '../utils/appFunctions';
import { analyzeWorkload, calculateSummary } from '../utils/recommendations';
import type { WorkloadCapacityData, CapacitySummary, UseK8sCapacityDataReturn } from '../../../src/types/k8s';

// ============================================================================
// Entity Query Builders (DQL — these work reliably via Grail)
// ============================================================================

function buildClustersQuery(timeRange: string): string {
  return `fetch dt.entity.kubernetes_cluster, from:${timeRange}
| fieldsKeep id, entity.name
| sort entity.name asc`;
}

function buildNamespacesQuery(timeRange: string): string {
  return `fetch dt.entity.cloud_application_namespace, from:${timeRange}
| fieldsKeep entity.name
| sort entity.name asc`;
}

// ============================================================================
// Constants
// ============================================================================

const EMPTY_SUMMARY: CapacitySummary = {
  totalWorkloads: 0, optimalCount: 0, overProvisionedCount: 0,
  underProvisionedCount: 0, noDataCount: 0,
  estimatedCpuWasteMilli: 0, estimatedMemoryWasteBytes: 0,
};

// ============================================================================
// Hook
// ============================================================================

export function useK8sCapacityData(): UseK8sCapacityDataReturn {
  const [clusters, setClusters] = useState<string[]>([]);
  const [allNamespaces, setAllNamespaces] = useState<string[]>([]);
  const [clusterNamespaceMap, setClusterNamespaceMap] = useState<Record<string, string[]>>({});
  const [workloads, setWorkloads] = useState<WorkloadCapacityData[]>([]);
  const [summary, setSummary] = useState<CapacitySummary>(EMPTY_SUMMARY);

  const [selectedCluster, setSelectedClusterState] = useState<string>('all');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<string>('now()-24h');

  const [loading, setLoading] = useState(false);
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkload, setSelectedWorkload] = useState<string | null>(null);

  // Derive visible namespaces based on selected cluster
  const namespaces = useMemo(() => {
    if (selectedCluster === 'all') return allNamespaces;
    const clusterNs = clusterNamespaceMap[selectedCluster];
    if (!clusterNs || clusterNs.length === 0) return allNamespaces;
    return allNamespaces.filter(ns => clusterNs.includes(ns));
  }, [allNamespaces, selectedCluster, clusterNamespaceMap]);

  // ── Load filter options (clusters + namespaces via entity queries) ────
  const loadFilters = useCallback(async () => {
    setLoadingFilters(true);
    try {
      const [clustersResult, nsResult] = await Promise.all([
        queryGrail(buildClustersQuery(timeRange)),
        queryGrail(buildNamespacesQuery(timeRange)),
      ]);

      if (clustersResult.success) {
        const clusterList: string[] = [];
        for (const r of clustersResult.data) {
          const name = (r as any)['entity.name'] as string;
          if (name) clusterList.push(name);
        }
        setClusters(clusterList);
      }

      if (nsResult.success && nsResult.data.length > 0) {
        const nsNames = nsResult.data
          .map((r: any) => r['entity.name'] as string)
          .filter(Boolean);
        setAllNamespaces(Array.from(new Set(nsNames)).sort());
      }

      // Reset cluster-namespace map (entity model doesn't easily provide this mapping)
      setClusterNamespaceMap({});
    } catch (err) {
      console.error('Error loading filters:', err);
      setError('Failed to load filters: ' + String(err));
    } finally {
      setLoadingFilters(false);
    }
  }, [timeRange]);

  const setSelectedCluster = useCallback((cluster: string) => {
    setSelectedClusterState(cluster);
    setSelectedNamespace('all');
  }, []);

  // ── Load workload data via classic Metrics API v2 ─────────────────────
  const loadWorkloadData = useCallback(async () => {
    setLoading(true);
    setSelectedWorkload(null);
    setError(null);

    try {
      // Determine namespace filter
      let nsParam: string | undefined;
      let nsListParam: string[] | undefined;

      if (selectedNamespace !== 'all') {
        nsParam = selectedNamespace;
      } else if (selectedCluster !== 'all') {
        const clusterNs = clusterNamespaceMap[selectedCluster];
        if (clusterNs && clusterNs.length > 0) nsListParam = clusterNs;
      }

      const result = await queryWorkloadMetrics({
        from: timeRange,
        namespace: nsParam,
        namespaces: nsListParam,
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
  }, [selectedNamespace, selectedCluster, timeRange, clusterNamespaceMap]);

  const refetch = useCallback(() => {
    loadFilters();
  }, [loadFilters]);

  // Load filters on mount and when timeRange changes
  useEffect(() => {
    loadFilters();
  }, [loadFilters]);

  // Load workload data when filters change
  useEffect(() => {
    loadWorkloadData();
  }, [loadWorkloadData]);

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
