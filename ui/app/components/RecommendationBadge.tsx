import React from 'react';
import type { SeverityLevel, SizingStatus } from '../../../src/types/k8s';

interface RecommendationBadgeProps {
  severity: SeverityLevel;
  status: SizingStatus;
  compact?: boolean;
}

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  green: '#4caf50',
  yellow: '#ff9800',
  red: '#ee3d48',
  gray: '#b4b4be',
};

const STATUS_LABELS: Record<SizingStatus, string> = {
  'optimal': 'Optimal',
  'over-provisioned': 'Over-provisioned',
  'under-provisioned': 'Under-provisioned',
  'misconfigured': 'Misconfigured',
  'no-data': 'No Data',
};

export const RecommendationBadge: React.FC<RecommendationBadgeProps> = ({
  severity,
  status,
  compact = false,
}) => {
  const color = SEVERITY_COLORS[severity];
  const label = compact ? status.charAt(0).toUpperCase() : STATUS_LABELS[status];

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: compact ? '2px 8px' : '3px 10px',
        borderRadius: '12px',
        backgroundColor: `${color}20`,
        border: `1px solid ${color}40`,
        fontSize: compact ? '11px' : '12px',
        fontWeight: 500,
        color,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
};

export default RecommendationBadge;
