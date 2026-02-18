import React from 'react';
import { Flex, Text } from '@dynatrace/strato-components';

interface ClusterSelectorProps {
  clusters: string[];
  selected: string;
  onChange: (cluster: string) => void;
  loading: boolean;
}

export const ClusterSelector: React.FC<ClusterSelectorProps> = ({
  clusters,
  selected,
  onChange,
  loading,
}) => {
  return (
    <Flex alignItems="center" gap={8}>
      <Text style={{ fontSize: '13px', color: '#b4b4be', whiteSpace: 'nowrap' }}>Cluster:</Text>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        style={{
          backgroundColor: '#25273d',
          color: '#f0f0f5',
          border: '1px solid #3d3f5c',
          borderRadius: '4px',
          padding: '6px 12px',
          fontSize: '13px',
          cursor: loading ? 'wait' : 'pointer',
          minWidth: '200px',
          outline: 'none',
        }}
      >
        <option value="all">All clusters</option>
        {clusters.map((cluster) => (
          <option key={cluster} value={cluster}>
            {cluster}
          </option>
        ))}
      </select>
    </Flex>
  );
};

export default ClusterSelector;
