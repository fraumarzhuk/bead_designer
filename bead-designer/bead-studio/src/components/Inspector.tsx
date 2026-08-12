import React from 'react';
import { Bead } from '../types';

interface Props {
  selected: Set<number>;
  beads: Bead[];
  onUpdateBead: (id: number, color: string, size: number) => void;
}

export const Inspector: React.FC<Props> = ({ selected, beads, onUpdateBead }) => {
  const ids = Array.from(selected);
  if (ids.length === 0) {
    return (
      <div id="inspector" style={{ padding: '12px 16px', fontSize: '12.5px', color: '#1c2321', background: '#d3e4da' }}>
        <span className="empty" style={{ color: '#5d6a61', fontStyle: 'italic' }}>
          {beads.length ? 'Click beads to select them, then Add / Connect / Delete.' : 'Click "+ Add bead" to place your first bead.'}
        </span>
      </div>
    );
  }

  const first = beads.find(b => b.id === ids[0])!;
  const label = ids.length === 1 ? `bead #${beads.indexOf(first) + 1}` : `${ids.length} beads selected`;

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    for (const id of ids) onUpdateBead(id, color, first.size);
  };

  const handleSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const size = parseFloat(e.target.value);
    for (const id of ids) onUpdateBead(id, first.color, size);
  };

  return (
    <div id="inspector" style={{ padding: '12px 16px', fontSize: '12.5px', color: '#1c2321', background: '#d3e4da', display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
      <span className="badge" style={{ fontFamily: 'monospace', background: '#1c2321', color: '#e4efe8', padding: '3px 8px', borderRadius: '10px', fontSize: '11.5px' }}>
        {label}
      </span>
      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <label>Color</label>
        <input type="color" value={first.color} onChange={handleColorChange} style={{ width: '34px', height: '28px', border: '1px solid #8fa298' }} />
      </div>
      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <label>Size</label>
        <input type="range" min="1" max="8" step="0.5" value={first.size} onChange={handleSizeChange} />
        <span>{first.size} mm</span>
      </div>
    </div>
  );
};