import React, { useState, useMemo } from 'react';
import { Flex, Text } from '@dynatrace/strato-components';
import type { WorkloadCapacityData, SeverityLevel } from '../../../src/types/k8s';
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
type SeverityFilter = 'all' | SeverityLevel;
type StatusFilter = 'all' | 'no-config' | 'over-provisioned' | 'under-provisioned' | 'optimal';

const SEVERITY_ORDER = { red: 0, yellow: 1, green: 2, gray: 3 };
const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
const GRID_COLUMNS = '2fr 0.8fr 1fr 1fr 1fr 1fr 1fr 1fr 100px';

const filterButtonStyle = (active: boolean, color: string): React.CSSProperties => ({
  backgroundColor: active ? `${color}20` : 'transparent',
  color: active ? color : '#b4b4be',
  border: `1px solid ${active ? `${color}40` : '#3d3f5c'}`,
  borderRadius: '4px',
  padding: '3px 10px',
  fontSize: '11px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
});

// Helper to format recommendation value - show ✓ for optimal, N/A for no data
const formatRecommendationValue = (
  suggestedValue: number | null,
  status: string,
  formatter: (val: number | null) => string
): string => {
  if (suggestedValue === null && status === 'optimal') {
    return '✓';
  }
  return formatter(suggestedValue);
};

export const WorkloadTable: React.FC<WorkloadTableProps> = ({
  workloads,
  selectedWorkload,
  onSelectWorkload,
  loading,
}) => {
  const [sortField, setSortField] = useState<SortField>('overallSeverity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState(0);
  const [showDynatraceNamespace, setShowDynatraceNamespace] = useState(false);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter -> Sort -> Paginate pipeline (memoized for performance)
  const filtered = useMemo(() => {
    let result = workloads;

    // Hide dynatrace namespace by default
    if (!showDynatraceNamespace) {
      result = result.filter((w) => w.namespace !== 'dynatrace');
    }

    // Text search (workload name or namespace)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (w) => w.workloadName.toLowerCase().includes(q) || w.namespace.toLowerCase().includes(q)
      );
    }

    // Status filter (No Limits, Over/Under-Provisioned, Optimal)
    if (statusFilter !== 'all') {
      switch (statusFilter) {
        case 'no-config':
          result = result.filter((w) => w.isBestEffortQoS && (w.cpuPeak > 0 || w.memoryPeak > 0));
          break;
        case 'over-provisioned':
          result = result.filter((w) => w.overallStatus === 'over-provisioned');
          break;
        case 'under-provisioned':
          result = result.filter((w) => w.overallStatus === 'under-provisioned' || w.overallStatus === 'misconfigured');
          break;
        case 'optimal':
          result = result.filter((w) => w.overallStatus === 'optimal');
          break;
      }
    }

    // Severity filter
    if (severityFilter !== 'all') {
      result = result.filter((w) => w.overallSeverity === severityFilter);
    }

    return result;
  }, [workloads, searchQuery, statusFilter, severityFilter, showDynatraceNamespace]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
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
  }, [filtered, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sorted.length / pageSize);
  const safeCurrentPage = Math.min(currentPage, Math.max(0, totalPages - 1));
  const paginatedRows = sorted.slice(safeCurrentPage * pageSize, (safeCurrentPage + 1) * pageSize);

  // Reset to page 0 when filters change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(0);
  };
  const handleSeverityChange = (value: SeverityFilter) => {
    setSeverityFilter(value);
    setStatusFilter('all'); // Clear status filter when changing severity
    setCurrentPage(0);
  };
  const handleStatusChange = (value: StatusFilter) => {
    setStatusFilter(value);
    setSeverityFilter('all'); // Clear severity filter when changing status
    setCurrentPage(0);
  };
  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(0);
  };

  // Severity counts for filter badges
  const severityCounts = useMemo(() => {
    const counts = { red: 0, yellow: 0, green: 0, gray: 0 };
    workloads.forEach((w) => { counts[w.overallSeverity]++; });
    return counts;
  }, [workloads]);

  // Status counts for filter badges
  const statusCounts = useMemo(() => {
    const counts = {
      noConfig: 0,
      overProvisioned: 0,
      underProvisioned: 0,
      optimal: 0,
    };
    workloads.forEach((w) => {
      if (w.isBestEffortQoS && (w.cpuPeak > 0 || w.memoryPeak > 0)) {
        counts.noConfig++;
      }
      if (w.overallStatus === 'over-provisioned') counts.overProvisioned++;
      if (w.overallStatus === 'under-provisioned' || w.overallStatus === 'misconfigured') counts.underProvisioned++;
      if (w.overallStatus === 'optimal') counts.optimal++;
    });
    return counts;
  }, [workloads]);

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
      {/* Toolbar: Search + Severity Filter + Dynatrace Namespace Toggle */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #3d3f5c',
          backgroundColor: '#1b1c2e',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {/* Search */}
        <input
          type="text"
          placeholder="Search workload or namespace..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          style={{
            backgroundColor: '#25273d',
            border: '1px solid #3d3f5c',
            borderRadius: '4px',
            padding: '6px 12px',
            fontSize: '12px',
            color: '#f0f0f5',
            outline: 'none',
            minWidth: '200px',
            flex: '0 1 300px',
          }}
        />

        {/* Filter Controls */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Status Filter */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: '11px', color: '#b4b4be', marginRight: '4px' }}>Show:</Text>
            <button
              onClick={() => handleStatusChange('all')}
              style={filterButtonStyle(statusFilter === 'all' && severityFilter === 'all', '#f0f0f5')}
            >
              All ({workloads.length})
            </button>
            <button
              onClick={() => handleStatusChange('no-config')}
              style={filterButtonStyle(statusFilter === 'no-config', '#ee3d48')}
            >
              No Limits ({statusCounts.noConfig})
            </button>
            <button
              onClick={() => handleStatusChange('over-provisioned')}
              style={filterButtonStyle(statusFilter === 'over-provisioned', '#ff9800')}
            >
              Over-Provisioned ({statusCounts.overProvisioned})
            </button>
            <button
              onClick={() => handleStatusChange('under-provisioned')}
              style={filterButtonStyle(statusFilter === 'under-provisioned', '#ee3d48')}
            >
              Under-Provisioned ({statusCounts.underProvisioned})
            </button>
            <button
              onClick={() => handleStatusChange('optimal')}
              style={filterButtonStyle(statusFilter === 'optimal', '#4caf50')}
            >
              Optimal ({statusCounts.optimal})
            </button>
          </div>

          {/* Separator */}
          <span style={{ color: '#3d3f5c', fontSize: '18px' }}>|</span>

          {/* Severity Filter */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: '11px', color: '#b4b4be', marginRight: '4px' }}>Severity:</Text>
            <button
              onClick={() => handleSeverityChange('red')}
              style={filterButtonStyle(severityFilter === 'red', '#ee3d48')}
            >
              Red ({severityCounts.red})
            </button>
            <button
              onClick={() => handleSeverityChange('yellow')}
              style={filterButtonStyle(severityFilter === 'yellow', '#ff9800')}
            >
              Yellow ({severityCounts.yellow})
            </button>
            <button
              onClick={() => handleSeverityChange('green')}
              style={filterButtonStyle(severityFilter === 'green', '#4caf50')}
            >
              Green ({severityCounts.green})
            </button>
            <button
              onClick={() => handleSeverityChange('gray')}
              style={filterButtonStyle(severityFilter === 'gray', '#b4b4be')}
            >
              Gray ({severityCounts.gray})
            </button>
          </div>
        </div>

        {/* Dynatrace Namespace Toggle */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '11px',
            color: '#b4b4be',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={showDynatraceNamespace}
            onChange={(e) => setShowDynatraceNamespace(e.target.checked)}
            style={{
              cursor: 'pointer',
              accentColor: '#3d8bfd',
            }}
          />
          Show Dynatrace workloads
        </label>
      </div>

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

        {/* Data rows (paginated) */}
        {paginatedRows.length === 0 ? (
          <Flex justifyContent="center" style={{ padding: '24px' }}>
            <Text style={{ color: '#b4b4be', fontSize: '13px' }}>
              No workloads match your search{statusFilter !== 'all' || severityFilter !== 'all' ? ` and filters` : ''}.
            </Text>
          </Flex>
        ) : (
          paginatedRows.map((w) => {
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
                  {formatRecommendationValue(w.cpuRequestRecommendation.suggestedValue, w.cpuRequestRecommendation.status, formatCpu)} / {formatRecommendationValue(w.cpuLimitRecommendation.suggestedValue, w.cpuLimitRecommendation.status, formatCpu)}
                </div>
                <div style={{ ...cellStyle, fontFamily: 'monospace', fontSize: '12px', color: '#3d8bfd' }}>
                  {formatRecommendationValue(w.memoryRequestRecommendation.suggestedValue, w.memoryRequestRecommendation.status, formatMemory)} / {formatRecommendationValue(w.memoryLimitRecommendation.suggestedValue, w.memoryLimitRecommendation.status, formatMemory)}
                </div>
                <div style={{ ...cellStyle, display: 'flex', alignItems: 'center' }}>
                  <RecommendationBadge severity={w.overallSeverity} status={w.overallStatus} compact />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer: Pagination Controls */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #3d3f5c',
          backgroundColor: '#1b1c2e',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        {/* Left: count info */}
        <div>
          <Text style={{ fontSize: '11px', color: '#b4b4be' }}>
            {filtered.length === workloads.length
              ? `${workloads.length} workload${workloads.length !== 1 ? 's' : ''}`
              : `${filtered.length} of ${workloads.length} workloads (filtered)`}
            {' | '}
            Showing {paginatedRows.length > 0 ? safeCurrentPage * pageSize + 1 : 0}-{Math.min((safeCurrentPage + 1) * pageSize, filtered.length)}
          </Text>
          {(() => {
            const noConfigCount = filtered.filter(w => w.isBestEffortQoS && (w.cpuPeak > 0 || w.memoryPeak > 0)).length;
            return noConfigCount > 0 ? (
              <Text style={{ fontSize: '10px', color: '#ee3d48', marginTop: '4px' }}>
                ⚠️ {noConfigCount} workload{noConfigCount !== 1 ? 's' : ''} running without resource limits (pods will be evicted first under pressure)
              </Text>
            ) : null;
          })()}
        </div>

        {/* Right: page controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Page size selector */}
          <Text style={{ fontSize: '11px', color: '#b4b4be' }}>Rows:</Text>
          {PAGE_SIZE_OPTIONS.map((size) => (
            <button
              key={size}
              onClick={() => handlePageSizeChange(size)}
              style={{
                backgroundColor: pageSize === size ? '#3d3f5c40' : 'transparent',
                color: pageSize === size ? '#f0f0f5' : '#b4b4be',
                border: '1px solid #3d3f5c',
                borderRadius: '4px',
                padding: '2px 8px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              {size}
            </button>
          ))}

          {/* Page navigation */}
          {totalPages > 1 && (
            <>
              <span style={{ color: '#3d3f5c', margin: '0 4px' }}>|</span>
              <button
                onClick={() => setCurrentPage(0)}
                disabled={safeCurrentPage === 0}
                style={{
                  backgroundColor: 'transparent',
                  color: safeCurrentPage === 0 ? '#3d3f5c' : '#b4b4be',
                  border: '1px solid #3d3f5c',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  cursor: safeCurrentPage === 0 ? 'default' : 'pointer',
                }}
              >
                {'<<'}
              </button>
              <button
                onClick={() => setCurrentPage(Math.max(0, safeCurrentPage - 1))}
                disabled={safeCurrentPage === 0}
                style={{
                  backgroundColor: 'transparent',
                  color: safeCurrentPage === 0 ? '#3d3f5c' : '#b4b4be',
                  border: '1px solid #3d3f5c',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  cursor: safeCurrentPage === 0 ? 'default' : 'pointer',
                }}
              >
                {'<'}
              </button>
              <Text style={{ fontSize: '11px', color: '#f0f0f5' }}>
                {safeCurrentPage + 1} / {totalPages}
              </Text>
              <button
                onClick={() => setCurrentPage(Math.min(totalPages - 1, safeCurrentPage + 1))}
                disabled={safeCurrentPage >= totalPages - 1}
                style={{
                  backgroundColor: 'transparent',
                  color: safeCurrentPage >= totalPages - 1 ? '#3d3f5c' : '#b4b4be',
                  border: '1px solid #3d3f5c',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  cursor: safeCurrentPage >= totalPages - 1 ? 'default' : 'pointer',
                }}
              >
                {'>'}
              </button>
              <button
                onClick={() => setCurrentPage(totalPages - 1)}
                disabled={safeCurrentPage >= totalPages - 1}
                style={{
                  backgroundColor: 'transparent',
                  color: safeCurrentPage >= totalPages - 1 ? '#3d3f5c' : '#b4b4be',
                  border: '1px solid #3d3f5c',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '11px',
                  cursor: safeCurrentPage >= totalPages - 1 ? 'default' : 'pointer',
                }}
              >
                {'>>'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkloadTable;
