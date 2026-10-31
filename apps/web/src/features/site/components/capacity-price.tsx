import type { CSSProperties } from 'react';
import { digitRoll } from '../lib/capacity-price-motion';

export function CapacityPrice({
  current,
  previous,
  step,
}: {
  current: number;
  previous: number;
  step: number;
}) {
  const value = (current / 100).toFixed(2);
  const before = (previous / 100).toFixed(2);
  const direction = Math.sign(current - previous);

  return (
    <strong className="capacity-price-value" role="img" aria-label={`$${value}`}>
      <span className="capacity-price-digits" aria-hidden="true">
        <span>$</span>
        {[...value].map((character, index) => {
          if (character === '.') return <span key={index}>.</span>;
          const digit = Number(character);
          const oldDigit = Number(before[index] ?? character);
          const { from, to } = digitRoll(oldDigit, digit, direction);
          return (
            <span className="capacity-price-digit" key={index}>
              <span
                className="capacity-price-track"
                key={`${step}-${digit}`}
                data-rolling={from !== to}
                style={
                  {
                    '--price-from': from,
                    '--price-to': to,
                    '--price-delay': `${index * 70}ms`,
                  } as CSSProperties
                }
              >
                {Array.from({ length: 30 }, (_, row) => (
                  <span key={row}>{row % 10}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </strong>
  );
}
