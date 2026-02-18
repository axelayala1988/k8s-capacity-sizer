import React from 'react';
import { Flex } from '@dynatrace/strato-components';
import { TIME_RANGE_OPTIONS } from '../../../src/types/k8s';

interface TimeRangeSelectorProps {
  selected: string;
  onChange: (range: string) => void;
}

export const TimeRangeSelector: React.FC<TimeRangeSelectorProps> = ({ selected, onChange }) => {
  return (
    <Flex alignItems="center" gap={4} style={{ flexWrap: 'wrap' }}>
      {TIME_RANGE_OPTIONS.map((opt) => {
        const isActive = selected === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              backgroundColor: isActive ? '#4caf5030' : '#25273d',
              color: isActive ? '#4caf50' : '#b4b4be',
              border: `1px solid ${isActive ? '#4caf5060' : '#3d3f5c'}`,
              borderRadius: '4px',
              padding: '5px 10px',
              fontSize: '12px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </Flex>
  );
};

export default TimeRangeSelector;
