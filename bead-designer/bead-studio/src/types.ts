export interface Bead {
  id: number;
  color: string;
  size: number;      // in mm, later add options cause bead sizes are mostly standard
  x: number;         // 2D position
  y: number;
}

export interface Edge {
  a: number;
  b: number;
  type: 'chain' | 'reuse';
}

export interface State {
  beads: Bead[];
  edges: Edge[];
  selected: Set<number>;
}