import React, { useState } from 'react';
import { Flex, Text } from '@dynatrace/strato-components';
import type { WorkloadCapacityData } from '../../../src/types/k8s';
import { formatCpu, formatMemory } from '../utils/formatters';
import { RecommendationBadge } from './RecommendationBadge';

interface WorkloadTableProps {
  workloads: WorkloadCapacityData[];
  selectedWorkload: string | null;
  onSelectWorkload: (name: string | null) => void;
  loading: boolean;
}

type SortField = 'name' | 'namespace' | 'cpuSeverity' | 'memSeverity' | 'overallSeverity';
type SortDirection = 'asc' | 'desc';

const SEVERITY_ORDER = { red: 0, yellow: 1, green: 2, gray: 3 };

const GRID_COLUMNS = '2fr 0.8fr 1fr 1fr 1fr 1fr 1fr 1fr 100px';

export const WorkloadTable: React.FC<WorkloadTableProps> = ({
  workloads,
  selectedWorkload,
  onSelectWorkload,
  loading,
}) => {
  const [sortField, setSortField] = useState<SortField>('overallSeverity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sorted = [...workloads].sort((a, b) => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    switch (sortField) {
      case 'name':
        return a.workloadName.localeCompare(b.workloadName) * dir;
      case 'namespace':
        return a.namespace.localeCompare(b.namespace) * dir;
      case 'cpuSeverity': {
        const sA = SEVERITY_ORDER[a.cpuRequestRecommendation.severity];
        const sB = SEVERITY_ORDER[b.cpuRequestRecommendation.severity];
        return (sA - sB) * dir;
      }
      case 'memSeverity': {
        const sA = SEVERITY_ORDER[a.memoryRequestRecommendation.severity];
        const sB = SEVERITY_ORDER[b.memoryRequestRecommendation.severity];
        return (sA - sB) * dir;
      }
      case 'overallSeverity': {
        const sA = SEVERITY_ORDER[a.overallSeverity];
        const sB = SEVERITY_ORDER[b.overallSeverity];
        return (sA - sB) * dir;
      }
      default:
        return 0;
    }
  });

  const headerStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#b4b4be',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    padding: '10px 12px',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  const cellStyle: React.CSSProperties = {
    fontSize: '13px',
    padding: '10px 12px',
    color: '#f0f0f5',
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? ' ^' : ' v';
  };

  if (loading) {
    return (
      <Flex justifyContent="center" style={{ padding: '40px' }}>
        <Text style={{ color: '#b4b4be' }}>Loading workload data...</Text>
      </Flex>
    );
  }

  if (workloads.length === 0) {
    return (
      <Flex justifyContent="center" style={{ padding: '40px' }}>
        <Text style={{ color: '#b4b4be' }}>No workloads found. Check namespace filter or Dynatrace K8s monitoring.</Text>
      </Flex>
    );
  }

  return (
    <div
      style={{
        backgroundColor: '#25273d',
        border: '1px solid #3d3f5c',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <div style={{ overflowX: 'auto' }}>
        {/* Header row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: GRID_COLUMNS,
            borderBottom: '1px solid #3d3f5c',
            backgroundColor: '#1b1c2e',
            minWidth: '1000px',
          }}
        >
          <div style={headerStyle} onClick={() => handleSort('name')}>
            Workload{sortIndicator('name')}
          </div>
          <div style={headerStyle} onClick={() => handleSort('namespace')}>
            Namespace{sortIndicator('namespace')}
          </div>
          <div style={headerStyle}>CPU Req / Lim</div>
          <div style={headerStyle}>CPU Usage (Med / Peak)</div>
          <div style={headerStyle}>Mem Req / Lim</div>
          <div style={headerStyle}>Mem Usage (Med / Peak)</div>
          <div style={{ ...headerStyle, color: '#3d8bfd' }}>Rec. CPU (Req / Lim)</div>
          <div style={{ ...headerStyle, color: '#3d8bfd' }}>Rec. Mem (Req / Lim)</div>
          <div style={headerStyle} onClick={() => handleSort('overallSeverity')}>
            Status{sortIndicator('overallSeverity')}
          </div>
        </div>

        {/* Data rows */}
        {sorted.map((w) => {
          const isSelected = selectedWorkload === w.workloadName;
          const rowKey = `${w.namespace}/${w.workloadName}`;
          return (
            <div
              key={rowKey}
              onClick={() => onSelectWorkload(isSelected ? null : w.workloadName)}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLUMNS,
                borderBottom: '1px solid #3d3f5c20',
                cursor: 'pointer',
                backgroundColor: isSelected ? '#3d3f5c30' : 'transparent',
                transition: 'background-color 0.15s ease',
                minWidth: '1000px',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#3d3f5c15';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
              }}
            >
              <div style={{ ...cellStyle, fontWeight: 500 }}>
                {w.workloadName}
                {w.isBursty && (
                  <span style={{ fontSize: '10px', color: '#ff9800', marginLeft: '6px' }} title="Bursty workload">
                    BURST
                  </span>
                )}
                {w.isGuaranteedQoS && (
                  <span style={{ fontSize: '10px', color: '#4caf50', marginLeft: '6px' }} title="Guaranteed QoS">
                    QoS:G
                  </span>
                )}
                {w.isBestEffortQoS && (
                  <span style={{ fontSize: '10px', color: '#ee3d48', marginLeft: '6px' }} title="BestEffort QoS">
                    QoS:BE
                  </span>
                )}
              </div>
              <div style={cellStyle}>{w.namespace}</div>
              <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                {formatCpu(w.cpuRequests)} / {formatCpu(w.cpuLimits)}
              </div>
              <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                {formatCpu(w.cpuMedian)} / {formatCpu(w.cpuPeak)}
              </div>
              <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                {formatMemory(w.memoryRequests)} / {formatMemory(w.memoryLimits)}
              </div>
              <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                {formatMemory(w.memoryMedian)} / {formatMemory(w.memoryPeak)}
              </div>
              <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px', color: '#3d8bfd' }}>
                {formatCpu(w.cpuRequestRecommendation.suggestedValue)} / {formatCpu(w.cpuLimitRecommendation.suggestedValue)}
              </div>
              <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px', color: '#3d8bfd' }}>
                {formatMemory(w.memoryRequestRecommendation.suggestedValue)} / {formatMemory(w.memoryLimitRecommendation.suggestedValue)}
              </div>
              <div style={{ ...cellStyle, display: 'flex', alignItems: 'center' }}>
                <RecommendationBadge severity={w.overallSeverity} status={w.overallStatus} compact />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #3d3f5c',
          backgroundColor: '#1b1c2e',
        }}
      >
        <Text style={{ fontSize: '11px', color: '#b4b4be' }}>
          {workloads.length} workload{workloads.length !== 1 ? 's' : ''} | Click a row for detailed analysis
        </Text>
      </div>
    </div>
  );
};

export default WorkloadTable;
