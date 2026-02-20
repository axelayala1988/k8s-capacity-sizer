import React from 'react';
import { Container, Flex, Heading, Text } from '@dynatrace/strato-components';
import type { CapacitySummary } from '../../../src/types/k8s';
import { formatCpu } from '../utils/formatters';

interface SummaryCardsProps {
  summary: CapacitySummary;
  loading: boolean;
}

interface CardConfig {
  title: string;
  value: string | number;
  subtitle: string;
  color: string;
}

export const SummaryCards: React.FC<SummaryCardsProps> = ({ summary, loading }) => {
  const cards: CardConfig[] = [
    {
      title: 'Total Workloads',
      value: loading ? '...' : summary.totalWorkloads,
      subtitle: `${summary.optimalCount} optimal`,
      color: '#f0f0f5',
    },
    {
      title: 'No Limits Set',
      value: loading ? '...' : summary.noConfigCount,
      subtitle: summary.noConfigCount > 0
        ? 'Running without safety nets!'
        : 'All workloads have limits',
      color: summary.noConfigCount > 0 ? '#ee3d48' : '#4caf50',
    },
    {
      title: 'Over-Provisioned',
      value: loading ? '...' : summary.overProvisionedCount,
      subtitle: 'Wasting resources',
      color: summary.overProvisionedCount > 0 ? '#ff9800' : '#4caf50',
    },
    {
      title: 'Under-Provisioned',
      value: loading ? '...' : summary.underProvisionedCount,
      subtitle: 'Risk of issues',
      color: summary.underProvisionedCount > 0 ? '#ee3d48' : '#4caf50',
    },
    {
      title: 'Est. CPU Waste',
      value: loading ? '...' : formatCpu(summary.estimatedCpuWasteMilli),
      subtitle: summary.estimatedCpuWasteMilli >= 1000
        ? `~${(summary.estimatedCpuWasteMilli / 1000).toFixed(1)} cores reclaimable`
        : summary.estimatedCpuWasteMilli > 0
        ? 'Reclaimable capacity'
        : 'No waste detected',
      color: summary.estimatedCpuWasteMilli > 0 ? '#ff9800' : '#4caf50',
    },
  ];

  return (
    <Flex gap={16} style={{ flexWrap: 'wrap' }}>
      {cards.map((card) => (
        <Container
          key={card.title}
          style={{
            flex: '1 1 200px',
            minWidth: '200px',
            backgroundColor: '#25273d',
            border: '1px solid #3d3f5c',
            borderRadius: '8px',
            padding: '16px',
          }}
        >
          <Flex flexDirection="column" gap={8}>
            <Text style={{ fontSize: '12px', color: '#b4b4be', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {card.title}
            </Text>
            <Heading level={2} style={{ color: card.color, margin: 0 }}>
              {card.value}
            </Heading>
            <Text style={{ fontSize: '12px', color: '#b4b4be' }}>{card.subtitle}</Text>
          </Flex>
        </Container>
      ))}
    </Flex>
  );
};

export default SummaryCards;
