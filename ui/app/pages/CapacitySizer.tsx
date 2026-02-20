import React, { useState } from 'react';
import { Container, Flex, Heading, Text } from '@dynatrace/strato-components';
import { useK8sCapacityData } from '../hooks/useK8sCapacityData';
import { ClusterSelector } from '../components/ClusterSelector';
import { NamespaceSelector } from '../components/NamespaceSelector';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { SummaryCards } from '../components/SummaryCards';
import { WorkloadTable } from '../components/WorkloadTable';
import { WorkloadDetailPanel } from '../components/WorkloadDetailPanel';
import { exportWorkloadsToCSV } from '../utils/exportWorkloads';

const CapacitySizer: React.FC = () => {
  const {
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
  } = useK8sCapacityData();

  const [showReference, setShowReference] = useState(false);

  const selectedWorkloadData = selectedWorkload
    ? workloads.find((w) => w.workloadName === selectedWorkload)
    : null;

  return (
    <Flex flexDirection="column" gap={24} style={{ padding: '24px', maxWidth: '1800px', margin: '0 auto' }}>
      {/* Header */}
      <Flex flexDirection="column" gap={4}>
        <Heading level={1} style={{ color: '#f0f0f5', margin: 0 }}>
          K8s Capacity Sizer
        </Heading>
        <Text style={{ fontSize: '14px', color: '#b4b4be' }}>
          Right-size your Kubernetes workloads by comparing configured requests/limits against actual CPU and memory usage.
        </Text>
      </Flex>

      {/* Filter Bar */}
      <Container
        style={{
          backgroundColor: '#25273d',
          border: '1px solid #3d3f5c',
          borderRadius: '8px',
          padding: '16px',
        }}
      >
        <Flex justifyContent="space-between" alignItems="center" gap={16} style={{ flexWrap: 'wrap' }}>
          <Flex alignItems="center" gap={16} style={{ flexWrap: 'wrap' }}>
            <ClusterSelector
              clusters={clusters}
              selected={selectedCluster}
              onChange={setSelectedCluster}
              loading={loadingFilters}
            />
            <NamespaceSelector
              namespaces={namespaces}
              selected={selectedNamespace}
              onChange={setSelectedNamespace}
              loading={loadingFilters}
              clusterSelected={!!selectedCluster && selectedCluster !== 'all'}
            />
            <TimeRangeSelector selected={timeRange} onChange={setTimeRange} />
          </Flex>
          <Flex alignItems="center" gap={8}>
            <button
              onClick={() => exportWorkloadsToCSV(workloads)}
              disabled={loading || workloads.length === 0}
              style={{
                backgroundColor: '#4caf5020',
                color: '#4caf50',
                border: '1px solid #4caf5040',
                borderRadius: '4px',
                padding: '6px 16px',
                fontSize: '13px',
                cursor: loading || workloads.length === 0 ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                opacity: workloads.length === 0 ? 0.5 : 1,
              }}
            >
              Export CSV
            </button>
            <button
              onClick={refetch}
              disabled={loading}
              style={{
                backgroundColor: '#3d8bfd20',
                color: '#3d8bfd',
                border: '1px solid #3d8bfd40',
                borderRadius: '4px',
                padding: '6px 16px',
                fontSize: '13px',
                cursor: loading ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </Flex>
        </Flex>
      </Container>

      {/* Error / Diagnostics */}
      {error && (
        <Container
          style={{
            backgroundColor: error.includes('DIAGNOSTIC') ? '#1a1a3e' : '#ee3d4810',
            border: '1px solid ' + (error.includes('DIAGNOSTIC') ? '#3d3f5c' : '#ee3d4830'),
            borderRadius: '8px',
            padding: '12px 16px',
            maxHeight: '400px',
            overflow: 'auto',
          }}
        >
          <pre style={{
            color: error.includes('DIAGNOSTIC') ? '#b4b4be' : '#ee3d48',
            fontSize: '12px',
            fontFamily: 'monospace',
            margin: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {error}
          </pre>
        </Container>
      )}

      {/* Summary Cards */}
      <SummaryCards summary={summary} loading={loading} />

      {/* Workload Table + Detail Panel (side-by-side) */}
      <Flex gap={16} alignItems="flex-start">
        <div style={{ flex: selectedWorkloadData ? '1 1 0' : '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
          <WorkloadTable
            workloads={workloads}
            selectedWorkload={selectedWorkload}
            onSelectWorkload={setSelectedWorkload}
            loading={loading}
          />
        </div>

        {selectedWorkloadData && (
          <div style={{ flex: '0 0 480px', position: 'sticky', top: '24px', maxHeight: 'calc(100vh - 48px)', overflowY: 'auto' }}>
            <WorkloadDetailPanel
              workload={selectedWorkloadData}
              onClose={() => setSelectedWorkload(null)}
            />
          </div>
        )}
      </Flex>

      {/* How It Works Reference Section */}
      <Container
        style={{
          backgroundColor: '#25273d',
          border: '1px solid #3d3f5c',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <button
          onClick={() => setShowReference(!showReference)}
          style={{
            width: '100%',
            backgroundColor: 'transparent',
            border: 'none',
            padding: '14px 20px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: '14px', color: '#f0f0f5', fontWeight: 600 }}>
            How Recommendations Work
          </Text>
          <span style={{ color: '#b4b4be', fontSize: '12px' }}>
            {showReference ? 'Hide' : 'Show'} reference guide
          </span>
        </button>

        {showReference && (
          <Flex flexDirection="column" gap={20} style={{ padding: '0 20px 20px', borderTop: '1px solid #3d3f5c40' }}>

            {/* What are Requests and Limits? */}
            <Flex flexDirection="column" gap={8} style={{ paddingTop: '16px' }}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                What are Requests and Limits?
              </Text>
              <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                <strong style={{ color: '#f0f0f5' }}>Requests</strong> = the guaranteed minimum resources your container gets. Think of it as a reserved seat — Kubernetes won't schedule your pod on a node unless there's enough room to honor this reservation.
              </Text>
              <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                <strong style={{ color: '#f0f0f5' }}>Limits</strong> = the hard ceiling your container cannot exceed. Think of it as a speed limiter — if your container tries to use more CPU than the limit, it gets slowed down (throttled). If it tries to use more memory than the limit, it gets killed and restarted (OOMKill).
              </Text>
            </Flex>

            {/* How We Measure */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                How We Measure
              </Text>
              <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                We compare your <strong style={{ color: '#f0f0f5' }}>peak (maximum) actual usage</strong> over the selected time window against what you've configured. We use peak because both requests and limits need to cover your worst-case scenario — not just your average day.
              </Text>
              <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                The <strong style={{ color: '#f0f0f5' }}>median (average) usage</strong> is shown for reference, so you can see how "normal" compares to "worst case." A large gap between the two means your workload is bursty.
              </Text>
            </Flex>

            {/* The Color Codes */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                What the Colors Mean
              </Text>
              <Flex flexDirection="column" gap={6}>
                <Flex alignItems="center" gap={8}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#4caf50', flexShrink: 0 }} />
                  <Text style={{ fontSize: '13px', color: '#d0d0d8' }}>
                    <strong style={{ color: '#4caf50' }}>Green</strong> — Well-sized. Your actual usage is in a healthy range relative to what's configured. No action needed.
                  </Text>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ff9800', flexShrink: 0 }} />
                  <Text style={{ fontSize: '13px', color: '#d0d0d8' }}>
                    <strong style={{ color: '#ff9800' }}>Yellow</strong> — Could be improved. You're wasting some resources (over-provisioned) or getting close to the limit (tight). Worth reviewing.
                  </Text>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#ee3d48', flexShrink: 0 }} />
                  <Text style={{ fontSize: '13px', color: '#d0d0d8' }}>
                    <strong style={{ color: '#ee3d48' }}>Red</strong> — Action needed. Either you're wasting significant resources, or your workload is at risk of being throttled, killed, or evicted.
                  </Text>
                </Flex>
                <Flex alignItems="center" gap={8}>
                  <span style={{ display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#b4b4be', flexShrink: 0 }} />
                  <Text style={{ fontSize: '13px', color: '#d0d0d8' }}>
                    <strong style={{ color: '#b4b4be' }}>Gray</strong> — No data available. The workload may be newly deployed, scaled to zero, or not emitting metrics.
                  </Text>
                </Flex>
              </Flex>
            </Flex>

            {/* Request Thresholds */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Request Sizing Thresholds
              </Text>
              <Text style={{ fontSize: '12px', color: '#b4b4be', lineHeight: '1.5' }}>
                We look at: what percentage of your request is your peak usage actually using?
              </Text>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', padding: '10px 14px', backgroundColor: '#1b1c2e', borderRadius: '6px', border: '1px solid #3d3f5c40' }}>
                <Flex flexDirection="column" gap={4}>
                  <Text style={{ color: '#ee3d48', fontSize: '12px', fontFamily: 'monospace' }}>{'< 30%  RED    — Over-provisioned. You\'re reserving far more than needed (wasting resources).'}</Text>
                  <Text style={{ color: '#ff9800', fontSize: '12px', fontFamily: 'monospace' }}>{'30-50% YELLOW — Slightly over-provisioned. Could reclaim some capacity.'}</Text>
                  <Text style={{ color: '#4caf50', fontSize: '12px', fontFamily: 'monospace' }}>{'50-100% GREEN — Well-sized. Good balance between headroom and efficiency.'}</Text>
                  <Text style={{ color: '#ee3d48', fontSize: '12px', fontFamily: 'monospace' }}>{'>100%  RED    — Under-provisioned! Usage exceeds the reservation. Risk of throttling/eviction.'}</Text>
                </Flex>
              </div>
            </Flex>

            {/* Limit Thresholds */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Limit Sizing Thresholds
              </Text>
              <Text style={{ fontSize: '12px', color: '#b4b4be', lineHeight: '1.5' }}>
                We look at: how close is your peak usage to hitting the hard ceiling?
              </Text>
              <div style={{ fontFamily: 'monospace', fontSize: '12px', padding: '10px 14px', backgroundColor: '#1b1c2e', borderRadius: '6px', border: '1px solid #3d3f5c40' }}>
                <Flex flexDirection="column" gap={4}>
                  <Text style={{ color: '#ee3d48', fontSize: '12px', fontFamily: 'monospace' }}>{'< 15%  RED    — Limit is way too high. Provides no meaningful protection.'}</Text>
                  <Text style={{ color: '#ff9800', fontSize: '12px', fontFamily: 'monospace' }}>{'15-40% YELLOW — Limit is generous. Consider tightening.'}</Text>
                  <Text style={{ color: '#4caf50', fontSize: '12px', fontFamily: 'monospace' }}>{'40-80% GREEN  — Well-sized. Good headroom for unexpected spikes.'}</Text>
                  <Text style={{ color: '#ff9800', fontSize: '12px', fontFamily: 'monospace' }}>{'80-95% YELLOW — Getting tight. Risk of CPU throttling or approaching OOMKill.'}</Text>
                  <Text style={{ color: '#ee3d48', fontSize: '12px', fontFamily: 'monospace' }}>{'>= 95% RED    — Critical! CPU: active throttling. Memory: OOMKill imminent.'}</Text>
                </Flex>
              </div>
            </Flex>

            {/* Suggested Values */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                How Suggested Values Are Calculated
              </Text>
              <Flex flexDirection="column" gap={6}>
                <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                  <strong style={{ color: '#f0f0f5' }}>Suggested Request</strong> = your peak usage + 20% headroom. This gives enough buffer for measurement variance and minor traffic growth while not over-reserving.
                </Text>
                <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                  <strong style={{ color: '#f0f0f5' }}>Suggested Limit</strong> = your peak usage + 50% headroom. Limits need a bigger buffer because hitting them has severe consequences — CPU gets throttled (latency spikes) and memory gets killed (restarts).
                </Text>
                <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                  <strong style={{ color: '#f0f0f5' }}>Minimum floors</strong>: CPU suggestions never go below 10m (millicores), and memory suggestions never go below 32 Mi. This prevents over-aggressive downsizing of very low-usage workloads.
                </Text>
              </Flex>
            </Flex>

            {/* QoS Classes */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Quality of Service (QoS) Classes
              </Text>
              <Flex flexDirection="column" gap={6}>
                <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                  <strong style={{ color: '#4caf50' }}>Guaranteed</strong> (request = limit) — Highest priority. Last to be evicted. Best for critical workloads. Changing request or limit independently will downgrade QoS.
                </Text>
                <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                  <strong style={{ color: '#ff9800' }}>Burstable</strong> (request {'<'} limit) — Middle priority. Can burst above request up to limit. Most common configuration.
                </Text>
                <Text style={{ fontSize: '13px', color: '#d0d0d8', lineHeight: '1.6' }}>
                  <strong style={{ color: '#ee3d48' }}>BestEffort</strong> (no request, no limit) — Lowest priority. First to be evicted under pressure. Avoid in production.
                </Text>
              </Flex>
            </Flex>

            {/* Tags Legend */}
            <Flex flexDirection="column" gap={8}>
              <Text style={{ fontSize: '13px', color: '#3d8bfd', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Table Tags
              </Text>
              <Flex gap={12} style={{ flexWrap: 'wrap' }}>
                <Flex alignItems="center" gap={6}>
                  <span style={{ fontSize: '10px', color: '#ff9800', border: '1px solid #ff980040', borderRadius: '4px', padding: '1px 5px' }}>BURST</span>
                  <Text style={{ fontSize: '12px', color: '#b4b4be' }}>Peak is 5x+ median — highly variable usage pattern</Text>
                </Flex>
                <Flex alignItems="center" gap={6}>
                  <span style={{ fontSize: '10px', color: '#4caf50', border: '1px solid #4caf5040', borderRadius: '4px', padding: '1px 5px' }}>QoS:G</span>
                  <Text style={{ fontSize: '12px', color: '#b4b4be' }}>Guaranteed QoS class (request = limit)</Text>
                </Flex>
                <Flex alignItems="center" gap={6}>
                  <span style={{ fontSize: '10px', color: '#ee3d48', border: '1px solid #ee3d4840', borderRadius: '4px', padding: '1px 5px' }}>QoS:BE</span>
                  <Text style={{ fontSize: '12px', color: '#b4b4be' }}>BestEffort QoS class (no request or limit)</Text>
                </Flex>
              </Flex>
            </Flex>
          </Flex>
        )}
      </Container>

      {/* Footer */}
      <Flex justifyContent="space-between" alignItems="center" style={{ paddingTop: '8px', borderTop: '1px solid #3d3f5c20' }}>
        <Text style={{ fontSize: '11px', color: '#b4b4be60' }}>
          K8s Capacity Sizer v1.10.0
        </Text>
        <Text style={{ fontSize: '11px', color: '#b4b4be60' }}>
          Powered by Dynatrace Metrics API v2 | Recommendations use peak usage + headroom
        </Text>
      </Flex>
    </Flex>
  );
};

export default CapacitySizer;
