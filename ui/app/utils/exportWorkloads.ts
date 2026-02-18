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
  const blobUrl = URL.createObjectURL(blob);

  console.log('[CSV Export] Generated CSV with', workloads.length, 'rows,', headers.length, 'columns');

  // Use window.open for CSP-compatible download in Dynatrace AppEngine iframes
  const newWindow = window.open(blobUrl, '_blank');

  if (newWindow) {
    // Clean up blob URL after download starts
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } else {
    // Fallback: if popup blocked, copy CSV to clipboard
    console.log('[CSV Export] Popup blocked, falling back to clipboard');
    URL.revokeObjectURL(blobUrl);
    navigator.clipboard.writeText(csvContent).then(() => {
      alert('CSV copied to clipboard! Paste into a text file and save as .csv to open in Excel.');
    }).catch(() => {
      // Last resort: try anchor download approach
      const link = document.createElement('a');
      const fallbackUrl = URL.createObjectURL(blob);
      link.href = fallbackUrl;
      link.download = filename || `k8s-capacity-report-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(fallbackUrl);
      }, 1000);
    });
  }
}
