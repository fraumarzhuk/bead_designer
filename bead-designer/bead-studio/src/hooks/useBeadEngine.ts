import { useState, useCallback, useEffect} from 'react';
import { Bead, Edge, State } from '../types';

let nextId = 1;

// ---- physics helpers ----
type Vec3 = { x: number; y: number; z: number };
let posMap = new Map<number, Vec3>();
let prevPosMap = new Map<number, Vec3>();
let edgeData: { a: number; b: number; rest: number }[] = [];
let edgeKeySet = new Set<string>();

function buildPhysicsAux(state: State) {
  const sizeMap = new Map(state.beads.map(b => [b.id, b.size]));
  edgeData = state.edges.map(e => ({
    a: e.a,
    b: e.b,
    rest: (sizeMap.get(e.a)! + sizeMap.get(e.b)!) / 2 * 0.92,
  }));
  edgeKeySet = new Set(state.edges.map(e => e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`));
}

function physicsStep(ids: number[], iterations: number) {
  const n = ids.length;
  if (n === 0) return;
  const damping = 0.96;

  // velocity Verlet
  for (const id of ids) {
    const p = posMap.get(id)!;
    const pp = prevPosMap.get(id)!;
    const vx = (p.x - pp.x) * damping;
    const vy = (p.y - pp.y) * damping;
    const vz = (p.z - pp.z) * damping;
    prevPosMap.set(id, { x: p.x, y: p.y, z: p.z });
    posMap.set(id, { x: p.x + vx, y: p.y + vy, z: p.z + vz });
  }

  // long‑range repulsion
  let avgSize = 0;
  for (const id of ids) avgSize += (edgeData.find(e => e.a === id || e.b === id)?.rest || 3);
  avgSize = avgSize / n || 3;
  const repelStrength = avgSize * avgSize * 0.9;
  const maxPush = avgSize * 0.06;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const pa = posMap.get(ids[i])!;
      const pb = posMap.get(ids[j])!;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const dist = Math.sqrt(distSq) || 0.0001;
      let push = repelStrength / distSq;
      if (push > maxPush) push = maxPush;
      const ux = dx / dist, uy = dy / dist, uz = dz / dist;
      pa.x -= ux * push * 0.5;
      pa.y -= uy * push * 0.5;
      pa.z -= uz * push * 0.5;
      pb.x += ux * push * 0.5;
      pb.y += uy * push * 0.5;
      pb.z += uz * push * 0.5;
    }
  }

  // edge constraints
  for (let it = 0; it < iterations; it++) {
    for (const { a, b, rest } of edgeData) {
      const pa = posMap.get(a)!;
      const pb = posMap.get(b)!;
      const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const diff = (dist - rest) / dist * 0.5;
      pa.x += dx * diff;
      pa.y += dy * diff;
      pa.z += dz * diff;
      pb.x -= dx * diff;
      pb.y -= dy * diff;
      pb.z -= dz * diff;
    }
    // non‑edge repulsion (exclude actual edges)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const key = ids[i] < ids[j] ? `${ids[i]},${ids[j]}` : `${ids[j]},${ids[i]}`;
        if (edgeKeySet.has(key)) continue;
        const pa = posMap.get(ids[i])!;
        const pb = posMap.get(ids[j])!;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
        const sa = 3, sb = 3; // simplified, use stored sizes
        const minDist = (sa + sb) / 2 * 0.95;
        if (dist < minDist) {
          const diff = (dist - minDist) / dist * 0.5;
          pa.x += dx * diff;
          pa.y += dy * diff;
          pa.z += dz * diff;
          pb.x -= dx * diff;
          pb.y -= dy * diff;
          pb.z -= dz * diff;
        }
      }
    }
  }

  // centre of mass correction
  let cx = 0, cy = 0, cz = 0;
  for (const id of ids) { const p = posMap.get(id)!; cx += p.x; cy += p.y; cz += p.z; }
  cx /= n; cy /= n; cz /= n;
  for (const id of ids) {
    const p = posMap.get(id)!;
    p.x -= cx; p.y -= cy; p.z -= cz;
    const pp = prevPosMap.get(id)!;
    pp.x -= cx; pp.y -= cy; pp.z -= cz;
  }
  // remove angular momentum
  let Lx = 0, Ly = 0, Lz = 0, I = 0;
  for (const id of ids) {
    const p = posMap.get(id)!;
    const pp = prevPosMap.get(id)!;
    const rx = p.x, ry = p.y, rz = p.z;
    const vx = p.x - pp.x, vy = p.y - pp.y, vz = p.z - pp.z;
    Lx += ry * vz - rz * vy;
    Ly += rz * vx - rx * vz;
    Lz += rx * vy - ry * vx;
    I += rx * rx + ry * ry + rz * rz;
  }
  if (I > 1e-6) {
    const wx = Lx / I, wy = Ly / I, wz = Lz / I;
    for (const id of ids) {
      const p = posMap.get(id)!;
      const pp = prevPosMap.get(id)!;
      const rx = p.x, ry = p.y, rz = p.z;
      const cvx = wy * rz - wz * ry;
      const cvy = wz * rx - wx * rz;
      const cvz = wx * ry - wy * rx;
      pp.x += cvx; pp.y += cvy; pp.z += cvz;
    }
  }
}

// ---- main hook ----
export function useBeadEngine() {
  const [state, setState] = useState<State>({
    beads: [],
    edges: [],
    selected: new Set<number>(),
  });
  const [isInitialized, setIsInitialized] = useState(false);

  // 3D positions
  const getPos = useCallback((id: number) => posMap.get(id), []);
  const getPrevPos = useCallback((id: number) => prevPosMap.get(id), []);

  // rebuild physics aux when state changes
  useEffect(() => {
    buildPhysicsAux(state);
  }, [state]);

  // initialize positions for new beads
  const addBead = useCallback((color: string, size: number, connectTo: number[]) => {
    setState(prev => {
      const id = nextId++;
      const w = window.innerWidth * 0.52, h = window.innerHeight * 0.7; // rough
      let x = w / 2, y = h / 2;
      if (connectTo.length > 0) {
        let ax = 0, ay = 0;
        for (const cid of connectTo) {
          const b = prev.beads.find(b => b.id === cid);
          if (b) { ax += b.x; ay += b.y; }
        }
        ax /= connectTo.length; ay /= connectTo.length;
        const dx = ax - w / 2, dy = ay - h / 2;
        const dist = Math.hypot(dx, dy) || 1;
        x = ax + (dx / dist) * 24 + (Math.random() - 0.5) * 6;
        y = ay + (dy / dist) * 24 + (Math.random() - 0.5) * 6;
      } else if (prev.beads.length > 0) {
        const last = prev.beads[prev.beads.length - 1];
        x = last.x + 26;
        y = last.y + (Math.random() - 0.5) * 10;
      }
      const newBead: Bead = { id, color, size, x, y };
      const newEdges: Edge[] = connectTo.map(cid => ({ a: cid, b: id, type: 'chain' }));
      const newSelected = new Set<number>([id]);
      // physics init
      let seed: Vec3;
      if (connectTo.length) {
        let ax = 0, ay = 0, az = 0, c = 0;
        for (const cid of connectTo) {
          const p = posMap.get(cid);
          if (p) { ax += p.x; ay += p.y; az += p.z; c++; }
        }
        if (c > 0) { ax /= c; ay /= c; az /= c; }
        seed = { x: ax + (Math.random() - 0.5) * 1.4, y: ay + (Math.random() - 0.5) * 1.4, z: az + (Math.random() - 0.5) * 1.4 };
      } else if (posMap.size > 0) {
        let ax = 0, ay = 0, az = 0;
        posMap.forEach(p => { ax += p.x; ay += p.y; az += p.z; });
        ax /= posMap.size; ay /= posMap.size; az /= posMap.size;
        seed = { x: ax + 3 + Math.random(), y: ay + Math.random(), z: az + Math.random() };
      } else {
        seed = { x: 0, y: 0, z: 0 };
      }
      posMap.set(id, seed);
      prevPosMap.set(id, { ...seed });

      return {
        beads: [...prev.beads, newBead],
        edges: [...prev.edges, ...newEdges],
        selected: newSelected,
      };
    });
  }, []);

  const deleteSelected = useCallback(() => {
    setState(prev => {
      const toDelete = prev.selected;
      if (toDelete.size === 0) return prev;
      const newBeads = prev.beads.filter(b => !toDelete.has(b.id));
      const newEdges = prev.edges.filter(e => !toDelete.has(e.a) && !toDelete.has(e.b));
      for (const id of toDelete) {
        posMap.delete(id);
        prevPosMap.delete(id);
      }
      return { beads: newBeads, edges: newEdges, selected: new Set() };
    });
  }, []);

  const connectSelected = useCallback(() => {
    setState(prev => {
      const ids = Array.from(prev.selected);
      if (ids.length < 2) return prev;
      let added = false;
      const newEdges = [...prev.edges];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i], b = ids[j];
          if (a === b) continue;
          const exists = prev.edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
          if (!exists) {
            newEdges.push({ a, b, type: 'reuse' });
            added = true;
          }
        }
      }
      if (!added) return prev;
      return { ...prev, edges: newEdges };
    });
  }, []);

  const resetPhysics = useCallback(() => {
    posMap.clear();
    prevPosMap.clear();
    state.beads.forEach((b, i) => {
      const angle = i * 2.399963;
      const r = Math.sqrt(i + 1) * 2.2;
      const seed = { x: r * Math.cos(angle), y: r * Math.sin(angle), z: (Math.random() - 0.5) * 2 };
      posMap.set(b.id, seed);
      prevPosMap.set(b.id, { ...seed });
    });
  }, [state.beads]);

  const selectBead = useCallback((id: number) => {
    setState(prev => {
      const newSel = new Set(prev.selected);
      if (newSel.has(id)) newSel.delete(id);
      else newSel.add(id);
      return { ...prev, selected: newSel };
    });
  }, []);

  const clearSelection = useCallback(() => {
    setState(prev => ({ ...prev, selected: new Set() }));
  }, []);

  // physics tick (called from animation loop)
  const tickPhysics = useCallback(() => {
    if (state.beads.length === 0) return;
    const ids = state.beads.map(b => b.id);
    physicsStep(ids, 3);
  }, [state.beads]);

  // sync 2D positions to 3D? we keep separate, but we can update 3D from 2D drag
  const updateBeadPos2D = useCallback((id: number, x: number, y: number) => {
    setState(prev => {
      const bead = prev.beads.find(b => b.id === id);
      if (!bead) return prev;
      const newBeads = prev.beads.map(b => b.id === id ? { ...b, x, y } : b);
      return { ...prev, beads: newBeads };
    });
  }, []);

  useEffect(() => {
    setIsInitialized(true);
  }, []);

  return {
    state,
    addBead,
    deleteSelected,
    connectSelected,
    resetPhysics,
    selectBead,
    clearSelection,
    updateBeadPos2D,
    getPos,
    tickPhysics,
    isInitialized,
  };
}