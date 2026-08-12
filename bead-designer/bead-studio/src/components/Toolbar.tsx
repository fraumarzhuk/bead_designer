import React, { useState } from 'react';

interface Props {
  selectedCount: number;
  onAddBead: (color: string, size: number) => void;
  onConnect: () => void;
  onDelete: () => void;
  onResetPhysics: () => void;
}

export const Toolbar: React.FC<Props> = ({ selectedCount, onAddBead, onConnect, onDelete, onResetPhysics }) => {
  const [color, setColor] = useState('#5aa9c7');
  const [size, setSize] = useState(3);

  return (
    <div className="toolbar" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
      <label>New bead <input type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
      <label>Size <input type="range" min="1" max="8" step="0.5" value={size} onChange={e => setSize(parseFloat(e.target.value))} /><span>{size} mm</span></label>
      <button className="primary" onClick={() => onAddBead(color, size)}>+ Add bead</button>
      <div className="divider" style={{ width: '1px', height: '22px', background: '#3a453d', margin: '0 2px' }}></div>
      <button disabled={selectedCount < 2} onClick={onConnect}>Connect selected</button>
      <button className="danger" disabled={selectedCount < 1} onClick={onDelete}>Delete selected</button>
      <div className="divider"></div>
      <button onClick={onResetPhysics}>Reset physics</button>
    </div>
  );
};