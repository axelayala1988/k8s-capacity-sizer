import React from 'react';
import { Container, Flex, Heading, Text } from '@dynatrace/strato-components';
import type { WorkloadCapacityData, Recommendation } from '../../../src/types/k8s';
import { formatCpu, formatMemory } from '../utils/formatters';
import { MetricBar } from './MetricBar';
import { RecommendationBadge } from './RecommendationBadge';

interface WorkloadDetailPanelProps {
  workload: WorkloadCapacityData;
  onClose: () => void;
}

const SEVERITY_COLORS = {
  green: '#4caf50',
  yellow: '#ff9800',
  red: '#ee3d48',
  gray: '#b4b4be',
};

const RecMessage: React.FC<{ rec: Recommendation }> = ({ rec }) => {
  const color = SEVERITY_COLORS[rec.severity];
  const dot = rec.severity === 'green' ? '+' : rec.severity === 'yellow' ? '!' : rec.severity === 'red' ? 'x' : '?';
  return (
    <Flex gap={8} alignItems="flex-start" style={{ marginBottom: '6px' }}>
      <span style={{ color, fontWeight: 'bold', fontSize: '14px', minWidth: '16px' }}>{dot}</span>
      <Text style={{ fontSize: '13px', color: '#f0f0f5', lineHeight: '1.5' }}>{rec.message}</Text>
    </Flex>
  );
};

export const WorkloadDetailPanel: React.FC<WorkloadDetailPanelProps> = ({ workload, onClose }) => {
  const w = workload;

  // Determine the max scale for CPU bars (max of all CPU values)
  const cpuValues = [w.cpuRequests, w.cpuLimits, w.cpuMedian, w.cpuPeak].filter(
    (v): v is number => v !== null && v > 0
  );
  const cpuMax = cpuValues.length > 0 ? Math.max(...cpuValues) * 1.1 : 100;

  // Determine the max scale for Memory bars
  const memValues = [w.memoryRequests, w.memoryLimits, w.memoryMedian, w.memoryPeak].filter(
    (v): v is number => v !== null && v > 0
  );
  const memMax = memValues.length > 0 ? Math.max(...memValues) * 1.1 : 100;

  return (
    <Container
      style={{
        backgroundColor: '#25273d',
        border: '1px solid #3d3f5c',
        borderRadius: '8px',
        padding: '20px',
      }}
    >
      {/* Header */}
      <Flex justifyContent="space-between" alignItems="flex-start" style={{ marginBottom: '16px' }}>
        <Flex flexDirection="column" gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Heading level={4} style={{ color: '#f0f0f5', margin: 0, wordBreak: 'break-word' }}>
            {w.workloadName}
          </Heading>
          <Flex alignItems="center" gap={8} style={{ flexWrap: 'wrap' }}>
            <Text style={{ fontSize: '12px', color: '#b4b4be' }}>{w.namespace}</Text>
            <RecommendationBadge severity={w.overallSeverity} status={w.overallStatus} />
            {w.isGuaranteedQoS && (
              <span style={{ fontSize: '10px', color: '#4caf50', border: '1px solid #4caf5040', borderRadius: '4px', padding: '1px 5px' }}>
                Guaranteed QoS
              </span>
            )}
            {w.isBestEffortQoS && (
              <span style={{ fontSize: '10px', color: '#ee3d48', border: '1px solid #ee3d4840', borderRadius: '4px', padding: '1px 5px' }}>
                BestEffort QoS
              </span>
            )}
            {w.isBursty && (
              <span style={{ fontSize: '10px', color: '#ff9800', border: '1px solid #ff980040', borderRadius: '4px', padding: '1px 5px' }}>
                Bursty
              </span>
            )}
          </Flex>
        </Flex>
        <button
          onClick={onClose}
          style={{
            backgroundColor: 'transparent',
            border: '1px solid #3d3f5c',
            borderRadius: '4px',
            color: '#b4b4be',
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: '12px',
            flexShrink: 0,
          }}
        >
          Close
        </button>
      </Flex>

      <Flex flexDirection="column" gap={16}>
        {/* CPU Section */}
        <Flex flexDirection="column" gap={8}>
          <Text style={{ fontSize: '14px', color: '#f0f0f5', fontWeight: 600, marginBottom: '4px' }}>
            CPU (millicores)
          </Text>

          {w.cpuRequests !== null && (
            <MetricBar
              label="Request"
              value={w.cpuRequests}
              maxValue={cpuMax}
              formattedValue={formatCpu(w.cpuRequests)}
              color="#3d8bfd"
            />
          )}
          <MetricBar
            label="Median"
            value={w.cpuMedian}
            maxValue={cpuMax}
            formattedValue={formatCpu(w.cpuMedian)}
            color="#4caf50"
            referenceValue={w.cpuRequests ?? undefined}
            referenceLabel="Request"
          />
          <MetricBar
            label="Peak"
            value={w.cpuPeak}
            maxValue={cpuMax}
            formattedValue={formatCpu(w.cpuPeak)}
            color="#ff9800"
            referenceValue={w.cpuRequests ?? undefined}
            referenceLabel="Request"
          />
          {w.cpuLimits !== null && (
            <MetricBar
              label="Limit"
              value={w.cpuLimits}
              maxValue={cpuMax}
              formattedValue={formatCpu(w.cpuLimits)}
              color="#ee3d48"
            />
          )}

          {w.cpuRequests === null && (
            <Text style={{ fontSize: '12px', color: '#ee3d48', fontStyle: 'italic' }}>No CPU request configured</Text>
          )}
          {w.cpuLimits === null && (
            <Text style={{ fontSize: '12px', color: '#ff9800', fontStyle: 'italic' }}>No CPU limit configured</Text>
          )}
        </Flex>

        {/* Memory Section */}
        <Flex flexDirection="column" gap={8} style={{ paddingTop: '12px', borderTop: '1px solid #3d3f5c40' }}>
          <Text style={{ fontSize: '14px', color: '#f0f0f5', fontWeight: 600, marginBottom: '4px' }}>
            Memory
          </Text>

          {w.memoryRequests !== null && (
            <MetricBar
              label="Request"
              value={w.memoryRequests}
              maxValue={memMax}
              formattedValue={formatMemory(w.memoryRequests)}
              color="#3d8bfd"
            />
          )}
          <MetricBar
            label="Median"
            value={w.memoryMedian}
            maxValue={memMax}
            formattedValue={formatMemory(w.memoryMedian)}
            color="#4caf50"
            referenceValue={w.memoryRequests ?? undefined}
            referenceLabel="Request"
          />
          <MetricBar
            label="Peak"
            value={w.memoryPeak}
            maxValue={memMax}
            formattedValue={formatMemory(w.memoryPeak)}
            color="#ff9800"
            referenceValue={w.memoryRequests ?? undefined}
            referenceLabel="Request"
          />
          {w.memoryLimits !== null && (
            <MetricBar
              label="Limit"
              value={w.memoryLimits}
              maxValue={memMax}
              formattedValue={formatMemory(w.memoryLimits)}
              color="#ee3d48"
            />
          )}

          {w.memoryRequests === null && (
            <Text style={{ fontSize: '12px', color: '#ee3d48', fontStyle: 'italic' }}>No memory request configured</Text>
          )}
          {w.memoryLimits === null && (
            <Text style={{ fontSize: '12px', color: '#ff9800', fontStyle: 'italic' }}>No memory limit configured</Text>
          )}
        </Flex>
      </Flex>

      {/* Recommendations */}
      <Flex flexDirection="column" gap={4} style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #3d3f5c' }}>
        <Text style={{ fontSize: '14px', color: '#f0f0f5', fontWeight: 600, marginBottom: '8px' }}>
          Recommendations
        </Text>
        <RecMessage rec={w.cpuRequestRecommendation} />
        <RecMessage rec={w.cpuLimitRecommendation} />
        <RecMessage rec={w.memoryRequestRecommendation} />
        <RecMessage rec={w.memoryLimitRecommendation} />

        {w.isBursty && (
          <Flex gap={8} alignItems="flex-start" style={{ marginTop: '8px', padding: '8px 12px', backgroundColor: '#ff980010', borderRadius: '4px', border: '1px solid #ff980030' }}>
            <span style={{ color: '#ff9800', fontWeight: 'bold', fontSize: '14px' }}>!</span>
            <Text style={{ fontSize: '13px', color: '#ff9800', lineHeight: '1.5' }}>
              Highly bursty workload detected (large gap between median and peak usage). Consider: (1) HPA to autoscale replicas during bursts, (2) Setting request based on median and limit based on peak, (3) Investigating if bursts are legitimate traffic or pathological behavior.
            </Text>
          </Flex>
        )}

        {w.isGuaranteedQoS && (
          <Flex gap={8} alignItems="flex-start" style={{ marginTop: '8px', padding: '8px 12px', backgroundColor: '#4caf5010', borderRadius: '4px', border: '1px solid #4caf5030' }}>
            <span style={{ color: '#4caf50', fontWeight: 'bold', fontSize: '14px' }}>i</span>
            <Text style={{ fontSize: '13px', color: '#4caf50', lineHeight: '1.5' }}>
              This workload is Guaranteed QoS (request == limit). If you change request or limit independently, the QoS class will change to Burstable. To maintain Guaranteed QoS, change both values together.
            </Text>
          </Flex>
        )}
      </Flex>
    </Container>
  );
};

export default WorkloadDetailPanel;
