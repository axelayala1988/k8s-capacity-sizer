import React from 'react';
import { Flex, Text } from '@dynatrace/strato-components';

interface NamespaceSelectorProps {
  namespaces: string[];
  selected: string;
  onChange: (ns: string) => void;
  loading: boolean;
  clusterSelected: boolean;
}

export const NamespaceSelector: React.FC<NamespaceSelectorProps> = ({
  namespaces,
  selected,
  onChange,
  loading,
  clusterSelected,
}) => {
  return (
    <Flex alignItems="center" gap={8}>
      <Text style={{ fontSize: '13px', color: '#b4b4be', whiteSpace: 'nowrap' }}>Namespace:</Text>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading || !clusterSelected}
        style={{
          backgroundColor: '#25273d',
          color: '#f0f0f5',
          border: '1px solid #3d3f5c',
          borderRadius: '4px',
          padding: '6px 12px',
          fontSize: '13px',
          cursor: loading ? 'wait' : !clusterSelected ? 'not-allowed' : 'pointer',
          minWidth: '200px',
          outline: 'none',
        }}
      >
        {selected === '' && (
          <option value="" disabled>
            {!clusterSelected ? 'Select cluster first' : loading ? 'Loading namespaces...' : 'Select a namespace'}
          </option>
        )}
        <option value="all" disabled={!clusterSelected}>
          {clusterSelected ? 'All namespaces' : 'All namespaces (select cluster first)'}
        </option>
        {namespaces.map((ns) => (
          <option key={ns} value={ns}>
            {ns}
          </option>
        ))}
      </select>
    </Flex>
  );
};

export default NamespaceSelector;
