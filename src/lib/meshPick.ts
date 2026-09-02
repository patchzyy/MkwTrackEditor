// Pure geometry helpers for picking and splitting MDL0 shape geometry.
//
// These are deliberately free of any renderer dependency so they can be unit tested
// and reused both by the noclip scene (CPU picker) and by the app.

export interface MeshPickVec3 {
  x: number;
  y: number;
  z: number;
}

export interface MeshBounds {
  min: MeshPickVec3;
  max: MeshPickVec3;
}

/**
 * Moller-Trumbore ray/triangle intersection, two sided.
 * Returns the ray parameter `t` (distance along a normalized direction) or null.
 */
export function rayTriangleIntersection(
  originX: number, originY: number, originZ: number,
  dirX: number, dirY: number, dirZ: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  epsilon = 1e-7,
): number | null {
  const e1x = bx - ax;
  const e1y = by - ay;
  const e1z = bz - az;
  const e2x = cx - ax;
  const e2y = cy - ay;
  const e2z = cz - az;

  const px = dirY * e2z - dirZ * e2y;
  const py = dirZ * e2x - dirX * e2z;
  const pz = dirX * e2y - dirY * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -epsilon && det < epsilon) return null;
  const invDet = 1 / det;

  const tx = originX - ax;
  const ty = originY - ay;
  const tz = originZ - az;

  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < -epsilon || u > 1 + epsilon) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;

  const v = (dirX * qx + dirY * qy + dirZ * qz) * invDet;
  if (v < -epsilon || u + v > 1 + epsilon) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  if (t <= epsilon) return null;
  return t;
}

/** Slab test. Returns the near hit distance (0 when the origin is inside) or null. */
export function rayAabbIntersection(
  originX: number, originY: number, originZ: number,
  dirX: number, dirY: number, dirZ: number,
  bounds: MeshBounds,
): number | null {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;

  const axis = (origin: number, dir: number, min: number, max: number): boolean => {
    if (Math.abs(dir) < 1e-12) return origin >= min && origin <= max;
    const inv = 1 / dir;
    let t0 = (min - origin) * inv;
    let t1 = (max - origin) * inv;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    if (t0 > tMin) tMin = t0;
    if (t1 < tMax) tMax = t1;
    return tMax >= tMin;
  };

  if (!axis(originX, dirX, bounds.min.x, bounds.max.x)) return null;
  if (!axis(originY, dirY, bounds.min.y, bounds.max.y)) return null;
  if (!axis(originZ, dirZ, bounds.min.z, bounds.max.z)) return null;
  if (tMax < 0) return null;
  return tMin;
}

export function createEmptyBounds(): MeshBounds {
  return {
    min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
    max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
  };
}

export function expandBounds(bounds: MeshBounds, x: number, y: number, z: number): void {
  if (x < bounds.min.x) bounds.min.x = x;
  if (y < bounds.min.y) bounds.min.y = y;
  if (z < bounds.min.z) bounds.min.z = z;
  if (x > bounds.max.x) bounds.max.x = x;
  if (y > bounds.max.y) bounds.max.y = y;
  if (z > bounds.max.z) bounds.max.z = z;
}

export function unionBounds(target: MeshBounds, source: MeshBounds): void {
  if (isBoundsEmpty(source)) return;
  expandBounds(target, source.min.x, source.min.y, source.min.z);
  expandBounds(target, source.max.x, source.max.y, source.max.z);
}

export function isBoundsEmpty(bounds: MeshBounds): boolean {
  return !(bounds.min.x <= bounds.max.x && bounds.min.y <= bounds.max.y && bounds.min.z <= bounds.max.z);
}

export function boundsCenter(bounds: MeshBounds): MeshPickVec3 {
  return {
    x: (bounds.min.x + bounds.max.x) * 0.5,
    y: (bounds.min.y + bounds.max.y) * 0.5,
    z: (bounds.min.z + bounds.max.z) * 0.5,
  };
}

export function boundsRadius(bounds: MeshBounds): number {
  if (isBoundsEmpty(bounds)) return 0;
  return 0.5 * Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
}

/** Axis-aligned bounds of a whole triangle soup given as a flat position array + index list. */
export function computeTriangleSoupBounds(positions: ArrayLike<number>, indices: ArrayLike<number>): MeshBounds {
  const bounds = createEmptyBounds();
  for (let i = 0; i < indices.length; i++) {
    const base = indices[i] * 3;
    expandBounds(bounds, positions[base], positions[base + 1], positions[base + 2]);
  }
  return bounds;
}

export interface TriangleComponentSplit {
  /** Component id for each triangle (`indices.length / 3` entries). */
  triangleComponent: Int32Array;
  componentCount: number;
  /** Bounds per component, in the same space as `positions`. */
  bounds: MeshBounds[];
  /** Triangle count per component. */
  triangleCounts: Int32Array;
}

/**
 * Split a triangle soup into connected components. Triangles are considered connected
 * when they share a vertex position within `epsilon`. This is what makes "click a single
 * tree out of a 30-tree shape" work.
 */
export function splitTrianglesIntoComponents(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  epsilon = 1.0,
): TriangleComponentSplit {
  const triangleCount = Math.floor(indices.length / 3);
  const vertexCount = Math.floor(positions.length / 3);
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;

  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    let node = a;
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Weld vertices that sit within `epsilon` of each other using a uniform grid.
  const cell = Math.max(epsilon, 1e-6);
  const buckets = new Map<string, number[]>();
  const usedVertex = new Uint8Array(vertexCount);
  for (let i = 0; i < indices.length; i++) usedVertex[indices[i]] = 1;

  const cellKey = (cx: number, cy: number, cz: number) => `${cx},${cy},${cz}`;
  const cellOf = (value: number) => Math.floor(value / cell);

  for (let v = 0; v < vertexCount; v++) {
    if (!usedVertex[v]) continue;
    const base = v * 3;
    const key = cellKey(cellOf(positions[base]), cellOf(positions[base + 1]), cellOf(positions[base + 2]));
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [v]);
    else bucket.push(v);
  }

  const epsilonSq = epsilon * epsilon;
  // Only walk "forward" neighbours; every cell pair is still visited exactly once.
  const neighbourOffsets: Array<[number, number, number]> = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        if (dx * 9 + dy * 3 + dz >= 0) neighbourOffsets.push([dx, dy, dz]);

  for (const [key, bucket] of buckets) {
    const parts = key.split(',');
    const cx = Number(parts[0]);
    const cy = Number(parts[1]);
    const cz = Number(parts[2]);
    for (const [dx, dy, dz] of neighbourOffsets) {
      const other = dx === 0 && dy === 0 && dz === 0 ? bucket : buckets.get(cellKey(cx + dx, cy + dy, cz + dz));
      if (other === undefined) continue;
      const sameBucket = other === bucket;
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i];
        const ab = a * 3;
        for (let j = sameBucket ? i + 1 : 0; j < other.length; j++) {
          const b = other[j];
          if (a === b) continue;
          const bb = b * 3;
          const ddx = positions[ab] - positions[bb];
          const ddy = positions[ab + 1] - positions[bb + 1];
          const ddz = positions[ab + 2] - positions[bb + 2];
          if (ddx * ddx + ddy * ddy + ddz * ddz <= epsilonSq) union(a, b);
        }
      }
    }
  }

  for (let t = 0; t < triangleCount; t++) {
    union(indices[t * 3], indices[t * 3 + 1]);
    union(indices[t * 3 + 1], indices[t * 3 + 2]);
  }

  const rootToComponent = new Map<number, number>();
  const triangleComponent = new Int32Array(triangleCount);
  const bounds: MeshBounds[] = [];
  const triangleCounts: number[] = [];

  for (let t = 0; t < triangleCount; t++) {
    const root = find(indices[t * 3]);
    let component = rootToComponent.get(root);
    if (component === undefined) {
      component = bounds.length;
      rootToComponent.set(root, component);
      bounds.push(createEmptyBounds());
      triangleCounts.push(0);
    }
    triangleComponent[t] = component;
    triangleCounts[component]++;
    for (let k = 0; k < 3; k++) {
      const base = indices[t * 3 + k] * 3;
      expandBounds(bounds[component], positions[base], positions[base + 1], positions[base + 2]);
    }
  }

  return {
    triangleComponent,
    componentCount: bounds.length,
    bounds,
    triangleCounts: Int32Array.from(triangleCounts),
  };
}

/**
 * Builds one index list per connected component so the renderer can issue a separate
 * draw call (and therefore a separate transform) per component.
 */
export function buildComponentIndexLists(indices: ArrayLike<number>, split: TriangleComponentSplit): Uint32Array[] {
  const lists: Uint32Array[] = [];
  const cursors = new Int32Array(split.componentCount);
  for (let c = 0; c < split.componentCount; c++) lists.push(new Uint32Array(split.triangleCounts[c] * 3));
  for (let t = 0; t < split.triangleComponent.length; t++) {
    const component = split.triangleComponent[t];
    const list = lists[component];
    let cursor = cursors[component];
    list[cursor++] = indices[t * 3];
    list[cursor++] = indices[t * 3 + 1];
    list[cursor++] = indices[t * 3 + 2];
    cursors[component] = cursor;
  }
  return lists;
}

/** Collects the unique undirected edges of a triangle soup, capped at `maxEdges`. */
export function collectTriangleEdges(indices: ArrayLike<number>, maxEdges = 20000): Array<[number, number]> {
  const seen = new Set<number>();
  const edges: Array<[number, number]> = [];
  const push = (a: number, b: number) => {
    if (edges.length >= maxEdges) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * 0x100000 + hi;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([lo, hi]);
  };
  for (let t = 0; t + 2 < indices.length; t += 3) {
    push(indices[t], indices[t + 1]);
    push(indices[t + 1], indices[t + 2]);
    push(indices[t + 2], indices[t]);
    if (edges.length >= maxEdges) break;
  }
  return edges;
}
