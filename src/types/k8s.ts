/**
 * K8s Capacity Sizer - Type Definitions
 *
 * All TypeScript interfaces for workload capacity data, recommendations, and UI state.
 */

// ============================================================================
// Sizing Status & Severity
// ============================================================================

export type SizingStatus = 'optimal' | 'over-provisioned' | 'under-provisioned' | 'misconfigured' | 'no-data';

export type SeverityLevel = 'green' | 'yellow' | 'red' | 'gray';

// ============================================================================
// Recommendation
// ============================================================================

export interface Recommendation {
  /** Overall sizing status for this dimension */
  status: SizingStatus;
  /** Color-coded severity for UI display */
  severity: SeverityLevel;
  /** Human-readable explanation of the recommendation */
  message: string;
  /** Ratio of actual peak usage to configured value (e.g., 0.33 = using 33%). Null if no configured value. */
  ratio: number | null;
  /** Recommended value with appropriate headroom. Null if no usage data. */
  suggestedValue: number | null;
}

// ============================================================================
// Workload Capacity Data
// ============================================================================

export interface WorkloadCapacityData {
  workloadName: string;
  namespace: string;

  // CPU (millicores)
  cpuRequests: number | null;
  cpuLimits: number | null;
  cpuMedian: number;
  cpuPeak: number;

  // Memory (bytes)
  memoryRequests: number | null;
  memoryLimits: number | null;
  memoryMedian: number;
  memoryPeak: number;

  // Recommendations for each dimension
  cpuRequestRecommendation: Recommendation;
  cpuLimitRecommendation: Recommendation;
  memoryRequestRecommendation: Recommendation;
  memoryLimitRecommendation: Recommendation;

  // Overall workload status (worst of the four recommendations)
  overallStatus: SizingStatus;
  overallSeverity: SeverityLevel;

  // Flags
  isGuaranteedQoS: boolean;
  isBestEffortQoS: boolean;
  isBursty: boolean;
  isMisconfigured: boolean;
}

// ============================================================================
// Summary
// ============================================================================

export interface CapacitySummary {
  totalWorkloads: number;
  optimalCount: number;
  overProvisionedCount: number;
  underProvisionedCount: number;
  noDataCount: number;
  noConfigCount: number; // Workloads with usage data but no requests/limits (BestEffort QoS)
  estimatedCpuWasteMilli: number;
  estimatedMemoryWasteBytes: number;
}

// ============================================================================
// Time Range
// ============================================================================

export interface TimeRangeOption {
  label: string;
  /** DQL timeframe value, e.g., 'now-1h', 'now-24h', 'now-7d' */
  value: string;
}

export const TIME_RANGE_OPTIONS: TimeRangeOption[] = [
  { label: 'Last 1 hour', value: 'now()-1h' },
  { label: 'Last 6 hours', value: 'now()-6h' },
  { label: 'Last 24 hours', value: 'now()-24h' },
  { label: 'Last 3 days', value: 'now()-3d' },
  { label: 'Last 7 days', value: 'now()-7d' },
  { label: 'Last 14 days', value: 'now()-14d' },
  { label: 'Last 30 days', value: 'now()-30d' },
];

// ============================================================================
// Grail Query Response Types
// ============================================================================

export interface GrailQueryResult {
  success: boolean;
  data: Record<string, any>[];
  error?: string;
  metadata?: {
    recordCount: number;
    scannedDataBytes?: number;
    executionTimeMillis?: number;
  };
}

// ============================================================================
// Hook Return Type
// ============================================================================

export interface UseK8sCapacityDataReturn {
  // Data
  clusters: string[];
  namespaces: string[];
  workloads: WorkloadCapacityData[];
  summary: CapacitySummary;

  // Filter state
  selectedCluster: string;
  selectedNamespace: string;
  timeRange: string;

  // UI state
  loading: boolean;
  loadingFilters: boolean;
  error: string | null;
  selectedWorkload: string | null;

  // Actions
  setSelectedCluster: (cluster: string) => void;
  setSelectedNamespace: (ns: string) => void;
  setTimeRange: (range: string) => void;
  setSelectedWorkload: (name: string | null) => void;
  refetch: () => void;
}
