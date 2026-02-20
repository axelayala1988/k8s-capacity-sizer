import { functions } from '@dynatrace-sdk/app-utils';
import type { GrailQueryResult } from '../../../src/types/k8s';

/**
 * Execute a DQL query against Grail via the backend serverless function.
 */
export async function queryGrail(query: string): Promise<GrailQueryResult> {
  try {
    const response = await functions.call('query-grail', {
      data: { query },
    });
    const result = await response.json();
    return result as GrailQueryResult;
  } catch (error) {
    console.error('Failed to call query-grail function:', error);
    return {
      success: false,
      data: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface MetricInfo {
  key: string;
  name: string;
  unit: string;
}

export interface DiscoverMetricsResult {
  success: boolean;
  data: MetricInfo[];
  errors: string[];
  totalFound: number;
}

/**
 * Discover available metric keys using the classic Metrics API v2.
 */
export async function discoverMetrics(searchTerms?: string[]): Promise<DiscoverMetricsResult> {
  try {
    const response = await functions.call('discover-metrics', {
      data: { searchTerms },
    });
    return await response.json() as DiscoverMetricsResult;
  } catch (error) {
    console.error('Failed to call discover-metrics function:', error);
    return {
      success: false,
      data: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      totalFound: 0,
    };
  }
}

export interface WorkloadMetricsResult {
  success: boolean;
  data: Array<{
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
  }>;
  discoveredKeys?: Record<string, string | null>;
  allMetricKeys?: string[];
  diagnostics?: string[];
  errors?: string[];
}

/**
 * Query workload-level capacity data via the classic Metrics API v2.
 * Handles metric discovery, dimension detection, and data retrieval.
 */
export async function queryWorkloadMetrics(params: {
  from?: string;
  namespace?: string;
  namespaces?: string[];
}): Promise<WorkloadMetricsResult> {
  try {
    const response = await functions.call('query-workload-metrics', {
      data: params,
    });
    return await response.json() as WorkloadMetricsResult;
  } catch (error) {
    console.error('Failed to call query-workload-metrics function:', error);
    return {
      success: false,
      data: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}

/**
 * Query workload-level capacity data using new Grail metrics (dt.kubernetes.*).
 * Uses DQL timeseries queries for direct workload-level aggregation.
 */
export async function queryWorkloadMetricsGrail(params: {
  from?: string;
  cluster?: string;
  namespace?: string;
  limit?: number;
}): Promise<WorkloadMetricsResult> {
  try {
    const response = await functions.call('query-workload-metrics-grail', {
      data: params,
    });
    return await response.json() as WorkloadMetricsResult;
  } catch (error) {
    console.error('Failed to call query-workload-metrics-grail function:', error);
    return {
      success: false,
      data: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}
