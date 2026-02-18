import type { WorkloadCapacityData } from '../../../src/types/k8s';

/**
 * Export workload capacity data to CSV format that Excel can open natively.
 * Includes all current values, actual usage, recommendations, and status.
 */
export function exportWorkloadsToCSV(workloads: WorkloadCapacityData[], filename?: string): void {
  const headers = [
    'Workload',
    'Namespace',
    'Status',
    'Overall Severity',
    // Current CPU
    'CPU Request (m)',
    'CPU Limit (m)',
    'CPU Median Usage (m)',
    'CPU Peak Usage (m)',
    // Recommended CPU
    'Rec. CPU Request (m)',
    'Rec. CPU Limit (m)',
    'CPU Request Status',
    'CPU Limit Status',
    // Current Memory
    'Memory Request (Mi)',
    'Memory Limit (Mi)',
    'Memory Median Usage (Mi)',
    'Memory Peak Usage (Mi)',
    // Recommended Memory
    'Rec. Memory Request (Mi)',
    'Rec. Memory Limit (Mi)',
    'Memory Request Status',
    'Memory Limit Status',
    // Flags
    'QoS Class',
    'Bursty',
  ];

  const toMi = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '';
    return (bytes / 1048576).toFixed(1);
  };

  const toMillicores = (m: number | null): string => {
    if (m === null || m === undefined) return '';
    return Math.round(m).toString();
  };

  const rows = workloads.map((w) => {
    const qos = w.isGuaranteedQoS ? 'Guaranteed' : w.isBestEffortQoS ? 'BestEffort' : 'Burstable';

    return [
      w.workloadName,
      w.namespace,
      w.overallStatus,
      w.overallSeverity,
      // Current CPU
      toMillicores(w.cpuRequests),
      toMillicores(w.cpuLimits),
      toMillicores(w.cpuMedian),
      toMillicores(w.cpuPeak),
      // Rec CPU
      toMillicores(w.cpuRequestRecommendation.suggestedValue),
      toMillicores(w.cpuLimitRecommendation.suggestedValue),
      w.cpuRequestRecommendation.status,
      w.cpuLimitRecommendation.status,
      // Current Memory
      toMi(w.memoryRequests),
      toMi(w.memoryLimits),
      toMi(w.memoryMedian),
      toMi(w.memoryPeak),
      // Rec Memory
      toMi(w.memoryRequestRecommendation.suggestedValue),
      toMi(w.memoryLimitRecommendation.suggestedValue),
      w.memoryRequestRecommendation.status,
      w.memoryLimitRecommendation.status,
      // Flags
      qos,
      w.isBursty ? 'Yes' : 'No',
    ];
  });

  // Escape CSV values (handle commas, quotes, newlines)
  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows.map((row) => row.map(escapeCSV).join(',')),
  ].join('\r\n');

  // Add BOM for proper UTF-8 handling in Excel
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

  const defaultName = `k8s-capacity-report-${new Date().toISOString().slice(0, 10)}.csv`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename || defaultName;
  link.click();
  URL.revokeObjectURL(link.href);
}
