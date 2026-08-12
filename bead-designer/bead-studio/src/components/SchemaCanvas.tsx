import React, { useEffect, useRef, useState } from 'react';
import { Bead } from '../types';

interface Props {
  beads: Bead[];
  edges: { a: number; b: number; type: string }[];
  selected: Set<number>;
  onSelectBead: (id: number) => void;
  onUpdateBeadPos: (id: number, x: number, y: number) => void;
  onClearSelection: () => void;
}

export const SchemaCanvas: React.FC<Props> = ({
  beads,
  edges,
  selected,
  onSelectBead,
  onUpdateBeadPos,
  onClearSelection,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ id: number; startX: number; startY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.parentElement!.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    draw(ctx, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
  }, [beads, edges, selected]);

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.clearRect(0, 0, w, h);
    if (beads.length === 0) {
      ctx.fillStyle = '#5d6a61';
      ctx.font = '13px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Click "+ Add bead" to place your first bead', w / 2, h / 2);
      return;
    }

    // edges
    for (const e of edges) {
      const a = beads.find(b => b.id === e.a);
      const b = beads.find(b => b.id === e.b);
      if (!a || !b) continue;
      ctx.strokeStyle = e.type === 'reuse' ? 'rgba(179,70,60,0.65)' : 'rgba(63,107,138,0.55)';
      ctx.lineWidth = e.type === 'reuse' ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // beads
    for (const bead of beads) {
      const r = Math.max(7, Math.min(16, 4 + bead.size * 2));
      const isSel = selected.has(bead.id);
      ctx.beginPath();
      ctx.arc(bead.x, bead.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = bead.color;
      ctx.fill();
      ctx.lineWidth = isSel ? 2.5 : 1;
      ctx.strokeStyle = isSel ? '#b8863c' : 'rgba(28,35,33,0.35)';
      ctx.stroke();
      ctx.fillStyle = isLight(bead.color) ? '#1c2321' : '#f2ede2';
      ctx.font = `${Math.max(8, r * 0.85)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(beads.indexOf(bead) + 1), bead.x, bead.y + 0.5);
    }
  };

  const isLight = (hex: string) => {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16),
      g = parseInt(c.substr(2, 2), 16),
      b = parseInt(c.substr(4, 2), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b > 165;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    // hit test
    for (const bead of beads) {
      const r = Math.max(7, Math.min(16, 4 + bead.size * 2));
      const dx = x - bead.x,
        dy = y - bead.y;
      if (dx * dx + dy * dy <= (r + 2) * (r + 2)) {
        setDrag({ id: bead.id, startX: x, startY: y, moved: false });
        return;
      }
    }
    onClearSelection();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drag) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const dx = x - drag.startX,
      dy = y - drag.startY;
    if (drag.moved || Math.hypot(dx, dy) > 4) {
      setDrag({ ...drag, moved: true });
      onUpdateBeadPos(drag.id, x, y);
    }
  };

  const handleMouseUp = () => {
    if (drag && !drag.moved) {
      onSelectBead(drag.id);
    }
    setDrag(null);
  };

  return (
    <canvas
      ref={canvasRef}
      id="schemaCanvas"
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'default' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  );
};