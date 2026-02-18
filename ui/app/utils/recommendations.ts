/**
 * Recommendation Engine
 *
 * Pure functions that analyze actual usage vs configured requests/limits
 * and produce sizing recommendations. See RECOMMENDATIONS_LOGIC.md for
 * the complete logic documentation and examples.
 */

import type { Recommendation, SizingStatus, SeverityLevel, WorkloadCapacityData, CapacitySummary } from '../../../src/types/k8s';
import { formatCpu, formatMemory, formatMultiplier, roundCpu, roundMemory } from './formatters';

// ============================================================================
// Constants
// ============================================================================

const REQUEST_HEADROOM = 1.20; // 20% above peak
const LIMIT_HEADROOM = 1.50;   // 50% above peak
const BURST_THRESHOLD = 5;     // peak/median > 5 = bursty

// ============================================================================
// Request Recommendation
// ============================================================================

/**
 * Evaluate a configured request value against actual peak usage.
 * @param configured - The configured request value (millicores or bytes). Null if not set.
 * @param peak - The actual peak usage observed.
 * @param resourceType - 'cpu' or 'memory' for formatting.
 */
export function evaluateRequest(
  configured: number | null,
  peak: number,
  resourceType: 'cpu' | 'memory'
): Recommendation {
  const format = resourceType === 'cpu' ? formatCpu : formatMemory;
  const round = resourceType === 'cpu' ? roundCpu : roundMemory;
  const label = resourceType === 'cpu' ? 'CPU' : 'Memory';

  // No usage data
  if (peak <= 0) {
    if (configured === null || configured === 0) {
      return {
        status: 'no-data',
        severity: 'gray',
        message: `No ${label} usage data and no request configured.`,
        ratio: null,
        suggestedValue: null,
      };
    }
    return {
      status: 'no-data',
      severity: 'gray',
      message: `No ${label} usage data available. Workload may be idle, newly deployed, or not emitting metrics.`,
      ratio: null,
      suggestedValue: null,
    };
  }

  const suggestedRaw = peak * REQUEST_HEADROOM;
  const suggested = round(suggestedRaw);

  // No request configured (null or 0)
  if (configured === null || configured === 0) {
    return {
      status: 'under-provisioned',
      severity: 'red',
      message: `No ${label} request configured — pod has no guaranteed resources. ${
        resourceType === 'cpu'
          ? 'Under contention, it gets no guaranteed CPU time.'
          : 'Under node memory pressure, it will be evicted first.'
      } Suggest setting request to ~${format(suggested)}.`,
      ratio: null,
      suggestedValue: suggested,
    };
  }

  const ratio = peak / configured;

  // Under-provisioned: peak exceeds request
  if (ratio > 1.0) {
    const overBy = Math.round((ratio - 1) * 100);
    return {
      status: 'under-provisioned',
      severity: 'red',
      message: `UNDER-PROVISIONED — peak usage exceeds request by ${overBy}%. ${
        resourceType === 'cpu'
          ? 'Risk of CPU starvation under contention.'
          : 'Risk of eviction under node memory pressure.'
      } Increase to at least ~${format(suggested)}.`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Over-provisioned: extreme (<10%)
  if (ratio < 0.10) {
    return {
      status: 'over-provisioned',
      severity: 'red',
      message: `${label} request is ${formatMultiplier(ratio)} peak usage — extremely over-provisioned. Wasting ${format(configured - suggested)}. Consider reducing to ~${format(suggested)}.`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Over-provisioned: significant (10-30%)
  if (ratio < 0.30) {
    return {
      status: 'over-provisioned',
      severity: 'red',
      message: `${label} request is ${formatMultiplier(ratio)} peak usage — significantly over-provisioned. Consider reducing to ~${format(suggested)}.`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Over-provisioned: slight (30-50%)
  if (ratio < 0.50) {
    return {
      status: 'over-provisioned',
      severity: 'yellow',
      message: `${label} request is ${formatMultiplier(ratio)} peak usage — slightly over-provisioned. Could reduce to ~${format(suggested)}.`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Optimal: well-sized (50-85%)
  if (ratio < 0.85) {
    return {
      status: 'optimal',
      severity: 'green',
      message: `Well-sized — peak usage is ${Math.round(ratio * 100)}% of request.`,
      ratio,
      suggestedValue: null,
    };
  }

  // Optimal: tightly sized (85-100%)
  return {
    status: 'optimal',
    severity: 'green',
    message: `Tightly sized — peak usage is ${Math.round(ratio * 100)}% of request. Monitor for growth.`,
    ratio,
    suggestedValue: null,
  };
}

// ============================================================================
// Limit Recommendation
// ============================================================================

/**
 * Evaluate a configured limit value against actual peak usage.
 * @param configured - The configured limit value (millicores or bytes). Null if not set.
 * @param peak - The actual peak usage observed.
 * @param resourceType - 'cpu' or 'memory' for formatting.
 */
export function evaluateLimit(
  configured: number | null,
  peak: number,
  resourceType: 'cpu' | 'memory'
): Recommendation {
  const format = resourceType === 'cpu' ? formatCpu : formatMemory;
  const round = resourceType === 'cpu' ? roundCpu : roundMemory;
  const label = resourceType === 'cpu' ? 'CPU' : 'Memory';

  // No usage data
  if (peak <= 0) {
    if (configured === null || configured === 0) {
      return {
        status: 'no-data',
        severity: 'gray',
        message: `No ${label} usage data and no limit configured.`,
        ratio: null,
        suggestedValue: null,
      };
    }
    return {
      status: 'no-data',
      severity: 'gray',
      message: `No ${label} usage data available. Cannot assess limit sizing.`,
      ratio: null,
      suggestedValue: null,
    };
  }

  const suggestedRaw = peak * LIMIT_HEADROOM;
  const suggested = round(suggestedRaw);

  // No limit configured
  if (configured === null || configured === 0) {
    return {
      status: 'over-provisioned',
      severity: 'yellow',
      message: `No ${label} limit configured — unbounded resource usage. ${
        resourceType === 'cpu'
          ? 'A CPU spike can starve other pods on the node.'
          : 'A memory leak can take down the entire node.'
      } Suggest setting limit to ~${format(suggested)}.`,
      ratio: null,
      suggestedValue: suggested,
    };
  }

  const ratio = peak / configured;

  // Critical: near or at limit (>=95%)
  if (ratio >= 0.95) {
    return {
      status: 'under-provisioned',
      severity: 'red',
      message: `CRITICAL — peak usage at ${Math.round(ratio * 100)}% of limit. ${
        resourceType === 'cpu'
          ? 'Active CPU throttling likely.'
          : 'OOMKill imminent on any spike.'
      } Increase to at least ~${format(suggested)}.`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Tight: approaching limit (80-95%)
  if (ratio >= 0.80) {
    return {
      status: 'under-provisioned',
      severity: 'yellow',
      message: `Limit is tight — peak usage is ${Math.round(ratio * 100)}% of limit. ${
        resourceType === 'cpu'
          ? 'Risk of throttling during spikes.'
          : 'Approaching OOMKill zone.'
      }`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Optimal (40-80%)
  if (ratio >= 0.40) {
    return {
      status: 'optimal',
      severity: 'green',
      message: `Well-sized — peak usage is ${Math.round(ratio * 100)}% of limit. Good headroom for bursts.`,
      ratio,
      suggestedValue: null,
    };
  }

  // Over-provisioned: moderate (15-40%)
  if (ratio >= 0.15) {
    return {
      status: 'over-provisioned',
      severity: 'yellow',
      message: `${label} limit is ${formatMultiplier(ratio)} peak usage — generous. Could tighten to ~${format(suggested)}.`,
      ratio,
      suggestedValue: suggested,
    };
  }

  // Over-provisioned: extreme (<15%)
  return {
    status: 'over-provisioned',
    severity: 'red',
    message: `${label} limit is ${formatMultiplier(ratio)} peak usage — provides no meaningful constraint. Consider reducing to ~${format(suggested)}.`,
    ratio,
    suggestedValue: suggested,
  };
}

// ============================================================================
// Workload-Level Analysis
// ============================================================================

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  red: 3,
  yellow: 2,
  green: 1,
  gray: 0,
};

function worstSeverity(...severities: SeverityLevel[]): SeverityLevel {
  let worst: SeverityLevel = 'gray';
  let worstRank = 0;
  for (const s of severities) {
    if (SEVERITY_RANK[s] > worstRank) {
      worst = s;
      worstRank = SEVERITY_RANK[s];
    }
  }
  return worst;
}

function statusFromSeverity(severity: SeverityLevel, recommendations: Recommendation[]): SizingStatus {
  if (severity === 'gray') return 'no-data';
  if (severity === 'green') return 'optimal';

  const hasUnder = recommendations.some(r => r.status === 'under-provisioned');
  const hasMisconfig = recommendations.some(r => r.status === 'misconfigured');

  if (hasMisconfig) return 'misconfigured';
  if (hasUnder) return 'under-provisioned';
  return 'over-provisioned';
}

/**
 * Check if request > limit (misconfiguration).
 */
function checkMisconfiguration(
  request: number | null,
  limit: number | null,
  resourceType: 'cpu' | 'memory'
): Recommendation | null {
  if (request !== null && request > 0 && limit !== null && limit > 0 && request > limit) {
    const format = resourceType === 'cpu' ? formatCpu : formatMemory;
    return {
      status: 'misconfigured',
      severity: 'red',
      message: `MISCONFIGURATION — ${resourceType === 'cpu' ? 'CPU' : 'Memory'} request (${format(request)}) exceeds limit (${format(limit)}). Kubernetes will reject this pod spec.`,
      ratio: null,
      suggestedValue: null,
    };
  }
  return null;
}

interface RawWorkloadMetrics {
  workloadName: string;
  namespace: string;
  cpuRequests: number | null;
  cpuLimits: number | null;
  cpuMedian: number;
  cpuPeak: number;
  memoryRequests: number | null;
  memoryLimits: number | null;
  memoryMedian: number;
  memoryPeak: number;
}

/**
 * Analyze a single workload and produce enriched data with recommendations.
 */
export function analyzeWorkload(metrics: RawWorkloadMetrics): WorkloadCapacityData {
  const cpuMisconfig = checkMisconfiguration(metrics.cpuRequests, metrics.cpuLimits, 'cpu');
  const memMisconfig = checkMisconfiguration(metrics.memoryRequests, metrics.memoryLimits, 'memory');

  const cpuRequestRec = cpuMisconfig || evaluateRequest(metrics.cpuRequests, metrics.cpuPeak, 'cpu');
  const cpuLimitRec = cpuMisconfig || evaluateLimit(metrics.cpuLimits, metrics.cpuPeak, 'cpu');
  const memRequestRec = memMisconfig || evaluateRequest(metrics.memoryRequests, metrics.memoryPeak, 'memory');
  const memLimitRec = memMisconfig || evaluateLimit(metrics.memoryLimits, metrics.memoryPeak, 'memory');

  const allRecs = [cpuRequestRec, cpuLimitRec, memRequestRec, memLimitRec];
  const overall = worstSeverity(...allRecs.map(r => r.severity));

  const isGuaranteedQoS =
    metrics.cpuRequests !== null && metrics.cpuLimits !== null &&
    metrics.memoryRequests !== null && metrics.memoryLimits !== null &&
    metrics.cpuRequests === metrics.cpuLimits &&
    metrics.memoryRequests === metrics.memoryLimits;

  const isBestEffortQoS =
    (metrics.cpuRequests === null || metrics.cpuRequests === 0) &&
    (metrics.cpuLimits === null || metrics.cpuLimits === 0) &&
    (metrics.memoryRequests === null || metrics.memoryRequests === 0) &&
    (metrics.memoryLimits === null || metrics.memoryLimits === 0);

  const isBursty =
    (metrics.cpuMedian > 0 && metrics.cpuPeak / metrics.cpuMedian > BURST_THRESHOLD) ||
    (metrics.memoryMedian > 0 && metrics.memoryPeak / metrics.memoryMedian > BURST_THRESHOLD);

  const isMisconfigured = cpuMisconfig !== null || memMisconfig !== null;

  return {
    ...metrics,
    cpuRequestRecommendation: cpuRequestRec,
    cpuLimitRecommendation: cpuLimitRec,
    memoryRequestRecommendation: memRequestRec,
    memoryLimitRecommendation: memLimitRec,
    overallStatus: isMisconfigured ? 'misconfigured' : statusFromSeverity(overall, allRecs),
    overallSeverity: overall,
    isGuaranteedQoS,
    isBestEffortQoS,
    isBursty,
    isMisconfigured,
  };
}

// ============================================================================
// Summary Calculation
// ============================================================================

/**
 * Calculate aggregate summary statistics from analyzed workloads.
 */
export function calculateSummary(workloads: WorkloadCapacityData[]): CapacitySummary {
  let optimalCount = 0;
  let overProvisionedCount = 0;
  let underProvisionedCount = 0;
  let noDataCount = 0;
  let estimatedCpuWasteMilli = 0;
  let estimatedMemoryWasteBytes = 0;

  for (const w of workloads) {
    switch (w.overallStatus) {
      case 'optimal':
        optimalCount++;
        break;
      case 'over-provisioned':
        overProvisionedCount++;
        break;
      case 'under-provisioned':
      case 'misconfigured':
        underProvisionedCount++;
        break;
      case 'no-data':
        noDataCount++;
        break;
    }

    if (
      w.cpuRequestRecommendation.status === 'over-provisioned' &&
      w.cpuRequests !== null &&
      w.cpuRequestRecommendation.suggestedValue !== null
    ) {
      estimatedCpuWasteMilli += w.cpuRequests - w.cpuRequestRecommendation.suggestedValue;
    }

    if (
      w.memoryRequestRecommendation.status === 'over-provisioned' &&
      w.memoryRequests !== null &&
      w.memoryRequestRecommendation.suggestedValue !== null
    ) {
      estimatedMemoryWasteBytes += w.memoryRequests - w.memoryRequestRecommendation.suggestedValue;
    }
  }

  return {
    totalWorkloads: workloads.length,
    optimalCount,
    overProvisionedCount,
    underProvisionedCount,
    noDataCount,
    estimatedCpuWasteMilli: Math.max(0, estimatedCpuWasteMilli),
    estimatedMemoryWasteBytes: Math.max(0, estimatedMemoryWasteBytes),
  };
}
