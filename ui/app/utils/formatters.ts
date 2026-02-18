/**
 * Formatting utilities for CPU (millicores), Memory (bytes), and percentages.
 */

/** Format millicores to human-readable string */
export function formatCpu(millicores: number | null): string {
  if (millicores === null || millicores === undefined) return 'N/A';
  if (millicores >= 1000) return `${(millicores / 1000).toFixed(1)} cores`;
  return `${Math.round(millicores)}m`;
}

/** Format bytes to human-readable string (Mi, Gi) */
export function formatMemory(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return 'N/A';
  const gi = 1073741824; // 1024^3
  const mi = 1048576;    // 1024^2
  if (bytes >= gi) return `${(bytes / gi).toFixed(1)} Gi`;
  if (bytes >= mi) return `${(bytes / mi).toFixed(0)} Mi`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} Ki`;
  return `${bytes} B`;
}

/** Format ratio as percentage string */
export function formatPercent(ratio: number | null): string {
  if (ratio === null || ratio === undefined) return 'N/A';
  return `${Math.round(ratio * 100)}%`;
}

/** Format ratio as multiplier string (e.g., "3.5x") */
export function formatMultiplier(ratio: number): string {
  if (ratio === 0) return '0x';
  const inverse = 1 / ratio;
  return `${inverse.toFixed(1)}x`;
}

/** Round CPU up to nearest 10 millicores (min 10m) */
export function roundCpu(millicores: number): number {
  return Math.max(10, Math.ceil(millicores / 10) * 10);
}

/** Round memory up to nearest 16 MiB (min 32Mi = 33554432 bytes) */
export function roundMemory(bytes: number): number {
  const mi16 = 16 * 1048576; // 16 MiB
  const minBytes = 32 * 1048576; // 32 MiB
  return Math.max(minBytes, Math.ceil(bytes / mi16) * mi16);
}
