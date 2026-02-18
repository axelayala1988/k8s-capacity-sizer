import React from 'react';
import { Flex, Text } from '@dynatrace/strato-components';

interface MetricBarProps {
  label: string;
  value: number;
  maxValue: number;
  formattedValue: string;
  color: string;
  referenceValue?: number;
  referenceLabel?: string;
}

/**
 * Visual horizontal bar for comparing configured vs actual usage.
 * The bar fills proportionally to maxValue.
 */
export const MetricBar: React.FC<MetricBarProps> = ({
  label,
  value,
  maxValue,
  formattedValue,
  color,
  referenceValue,
  referenceLabel,
}) => {
  const percentage = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;
  const refPercentage = referenceValue && maxValue > 0
    ? Math.min((referenceValue / maxValue) * 100, 100)
    : null;

  return (
    <Flex flexDirection="column" gap={4} style={{ marginBottom: '8px' }}>
      <Flex justifyContent="space-between" alignItems="center">
        <Text style={{ fontSize: '12px', color: '#b4b4be', minWidth: '80px' }}>{label}</Text>
        <Text style={{ fontSize: '12px', color: '#f0f0f5', fontFamily: 'monospace' }}>
          {formattedValue}
        </Text>
      </Flex>
      <div
        style={{
          position: 'relative',
          height: '20px',
          backgroundColor: '#1b1c2e',
          borderRadius: '4px',
          border: '1px solid #3d3f5c',
          overflow: 'hidden',
        }}
      >
        {/* Filled bar */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: `${percentage}%`,
            backgroundColor: `${color}40`,
            borderRight: `2px solid ${color}`,
            transition: 'width 0.3s ease',
          }}
        />
        {/* Reference line (e.g., request or limit position) */}
        {refPercentage !== null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${refPercentage}%`,
              height: '100%',
              width: '2px',
              backgroundColor: '#f0f0f580',
              zIndex: 1,
            }}
            title={referenceLabel}
          />
        )}
        {/* Percentage label inside bar */}
        <span
          style={{
            position: 'absolute',
            right: '6px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '11px',
            color: '#f0f0f5',
            fontFamily: 'monospace',
          }}
        >
          {percentage > 0 ? `${Math.round(percentage)}%` : ''}
        </span>
      </div>
    </Flex>
  );
};

export default MetricBar;
