/**
 * Bounding-volume hierarchy over KCL collision triangles.
 *
 * Mario Kart Wii collision meshes run to well over 100k triangles, so the brute-force scan
 * hlorenzi's editor uses (and that this project used before) costs tens of milliseconds per
 * ray — far too slow for hover highlighting or drag-to-place. A binary BVH built once per
 * track brings a ray query down to a few microseconds.
 *
 * The structure is stored in flat typed arrays: no per-node objects, no allocation during a
 * query, and the triangle data itself is copied into a `Float32Array` so the hot loop never
 * touches the JS object graph.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface BvhTriangleSource {
  a: Vec3Like;
  b: Vec3Like;
  c: Vec3Like;
}

export interface RayHit {
  /** Index into the triangle array the BVH was built from. */
  triangleIndex: number;
  /** Distance along `direction` (in units of |direction|). */
  distance: number;
  position: Vec3Like;
  /** Barycentric coordinates of the hit inside the triangle. */
  u: number;
  v: number;
}

const LEAF_SIZE = 8;

export class TriangleBvh {
  /** 9 floats per triangle: ax ay az bx by bz cx cy cz. */
  private readonly verts: Float32Array;
  /** Triangle indices, reordered so each leaf owns a contiguous run. */
  private readonly order: Int32Array;
  private readonly boundsMin: Float32Array;
  private readonly boundsMax: Float32Array;
  /** Index of the left child, or -1 for a leaf. The right child is always left + 1. */
  private readonly childLeft: Int32Array;
  private readonly leafStart: Int32Array;
  private readonly leafCount: Int32Array;
  readonly nodeCount: number;
  readonly triangleCount: number;

  constructor(triangles: readonly BvhTriangleSource[]) {
    const count = triangles.length;
    this.triangleCount = count;
    this.verts = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      const { a, b, c } = triangles[i];
      const base = i * 9;
      this.verts[base] = a.x;
      this.verts[base + 1] = a.y;
      this.verts[base + 2] = a.z;
      this.verts[base + 3] = b.x;
      this.verts[base + 4] = b.y;
      this.verts[base + 5] = b.z;
      this.verts[base + 6] = c.x;
      this.verts[base + 7] = c.y;
      this.verts[base + 8] = c.z;
    }

    this.order = new Int32Array(count);
    for (let i = 0; i < count; i++) this.order[i] = i;

    const centroids = new Float32Array(count * 3);
    const triMin = new Float32Array(count * 3);
    const triMax = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const base = i * 9;
      for (let axis = 0; axis < 3; axis++) {
        const p0 = this.verts[base + axis];
        const p1 = this.verts[base + 3 + axis];
        const p2 = this.verts[base + 6 + axis];
        triMin[i * 3 + axis] = Math.min(p0, p1, p2);
        triMax[i * 3 + axis] = Math.max(p0, p1, p2);
        centroids[i * 3 + axis] = (p0 + p1 + p2) / 3;
      }
    }

    // A binary BVH over n primitives with leaves of >= 1 primitive has at most 2n-1 nodes.
    const maxNodes = Math.max(1, count * 2);
    this.boundsMin = new Float32Array(maxNodes * 3);
    this.boundsMax = new Float32Array(maxNodes * 3);
    this.childLeft = new Int32Array(maxNodes).fill(-1);
    this.leafStart = new Int32Array(maxNodes);
    this.leafCount = new Int32Array(maxNodes);

    let nextNode = 1;
    // Explicit stack of (node, start, count) so deep meshes cannot blow the JS stack.
    const stack: number[] = [0, 0, count];
    while (stack.length > 0) {
      const nodeCount = stack.pop()!;
      const nodeStart = stack.pop()!;
      const node = stack.pop()!;

      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let i = nodeStart; i < nodeStart + nodeCount; i++) {
        const t = this.order[i] * 3;
        if (triMin[t] < minX) minX = triMin[t];
        if (triMin[t + 1] < minY) minY = triMin[t + 1];
        if (triMin[t + 2] < minZ) minZ = triMin[t + 2];
        if (triMax[t] > maxX) maxX = triMax[t];
        if (triMax[t + 1] > maxY) maxY = triMax[t + 1];
        if (triMax[t + 2] > maxZ) maxZ = triMax[t + 2];
      }
      this.boundsMin[node * 3] = minX;
      this.boundsMin[node * 3 + 1] = minY;
      this.boundsMin[node * 3 + 2] = minZ;
      this.boundsMax[node * 3] = maxX;
      this.boundsMax[node * 3 + 1] = maxY;
      this.boundsMax[node * 3 + 2] = maxZ;

      if (nodeCount <= LEAF_SIZE) {
        this.childLeft[node] = -1;
        this.leafStart[node] = nodeStart;
        this.leafCount[node] = nodeCount;
        continue;
      }

      // Split along the widest axis at the centroid mean, then fall back to the median
      // count when the mean leaves one side empty (which happens on degenerate fans).
      const extentX = maxX - minX;
      const extentY = maxY - minY;
      const extentZ = maxZ - minZ;
      const axis = extentX >= extentY && extentX >= extentZ ? 0 : extentY >= extentZ ? 1 : 2;
      let sum = 0;
      for (let i = nodeStart; i < nodeStart + nodeCount; i++) sum += centroids[this.order[i] * 3 + axis];
      const pivot = sum / nodeCount;

      let left = nodeStart;
      let right = nodeStart + nodeCount - 1;
      while (left <= right) {
        if (centroids[this.order[left] * 3 + axis] < pivot) {
          left++;
        } else {
          const swap = this.order[left];
          this.order[left] = this.order[right];
          this.order[right] = swap;
          right--;
        }
      }
      let leftCount = left - nodeStart;
      if (leftCount === 0 || leftCount === nodeCount) leftCount = nodeCount >> 1;

      const leftChild = nextNode;
      nextNode += 2;
      this.childLeft[node] = leftChild;
      this.leafCount[node] = 0;
      stack.push(leftChild, nodeStart, leftCount);
      stack.push(leftChild + 1, nodeStart + leftCount, nodeCount - leftCount);
    }
    this.nodeCount = nextNode;
  }

  /**
   * Casts a ray and returns the nearest front- or back-facing hit at a non-negative
   * distance, or `null`. `direction` does not need to be normalised; `distance` is then
   * measured in multiples of its length.
   */
  raycast(origin: Vec3Like, direction: Vec3Like, maxDistance = Infinity): RayHit | null {
    if (this.triangleCount === 0) return null;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;
    // 1/0 is Infinity, which the slab test handles correctly for axis-parallel rays.
    const invX = 1 / dx;
    const invY = 1 / dy;
    const invZ = 1 / dz;

    let bestDistance = maxDistance;
    let bestTriangle = -1;
    let bestU = 0;
    let bestV = 0;

    const stack = new Int32Array(64);
    let stackSize = 0;
    stack[stackSize++] = 0;

    while (stackSize > 0) {
      const node = stack[--stackSize];
      const b = node * 3;
      let tMin = 0;
      let tMax = bestDistance;

      let t1 = (this.boundsMin[b] - ox) * invX;
      let t2 = (this.boundsMax[b] - ox) * invX;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;

      t1 = (this.boundsMin[b + 1] - oy) * invY;
      t2 = (this.boundsMax[b + 1] - oy) * invY;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;

      t1 = (this.boundsMin[b + 2] - oz) * invZ;
      t2 = (this.boundsMax[b + 2] - oz) * invZ;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;

      if (tMax < tMin) continue;

      const left = this.childLeft[node];
      if (left >= 0) {
        if (stackSize + 2 <= stack.length) {
          stack[stackSize++] = left;
          stack[stackSize++] = left + 1;
        }
        continue;
      }

      const start = this.leafStart[node];
      const end = start + this.leafCount[node];
      for (let i = start; i < end; i++) {
        const tri = this.order[i];
        const v = tri * 9;
        const ax = this.verts[v];
        const ay = this.verts[v + 1];
        const az = this.verts[v + 2];
        const e1x = this.verts[v + 3] - ax;
        const e1y = this.verts[v + 4] - ay;
        const e1z = this.verts[v + 5] - az;
        const e2x = this.verts[v + 6] - ax;
        const e2y = this.verts[v + 7] - ay;
        const e2z = this.verts[v + 8] - az;

        const px = dy * e2z - dz * e2y;
        const py = dz * e2x - dx * e2z;
        const pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-9 && det < 1e-9) continue;
        const invDet = 1 / det;

        const tx = ox - ax;
        const ty = oy - ay;
        const tz = oz - az;
        const u = (tx * px + ty * py + tz * pz) * invDet;
        if (u < 0 || u > 1) continue;

        const qx = ty * e1z - tz * e1y;
        const qy = tz * e1x - tx * e1z;
        const qz = tx * e1y - ty * e1x;
        const vv = (dx * qx + dy * qy + dz * qz) * invDet;
        if (vv < 0 || u + vv > 1) continue;

        const distance = (e2x * qx + e2y * qy + e2z * qz) * invDet;
        if (distance < 0 || distance >= bestDistance) continue;
        bestDistance = distance;
        bestTriangle = tri;
        bestU = u;
        bestV = vv;
      }
    }

    if (bestTriangle < 0) return null;
    return {
      triangleIndex: bestTriangle,
      distance: bestDistance,
      position: { x: ox + dx * bestDistance, y: oy + dy * bestDistance, z: oz + dz * bestDistance },
      u: bestU,
      v: bestV,
    };
  }

  /** Collects the indices of every triangle whose bounding box overlaps the given box. */
  queryBox(min: Vec3Like, max: Vec3Like, limit = Infinity): number[] {
    const out: number[] = [];
    if (this.triangleCount === 0) return out;
    const stack: number[] = [0];
    while (stack.length > 0 && out.length < limit) {
      const node = stack.pop()!;
      const b = node * 3;
      if (
        this.boundsMax[b] < min.x ||
        this.boundsMin[b] > max.x ||
        this.boundsMax[b + 1] < min.y ||
        this.boundsMin[b + 1] > max.y ||
        this.boundsMax[b + 2] < min.z ||
        this.boundsMin[b + 2] > max.z
      ) {
        continue;
      }
      const left = this.childLeft[node];
      if (left >= 0) {
        stack.push(left, left + 1);
        continue;
      }
      const start = this.leafStart[node];
      for (let i = start; i < start + this.leafCount[node] && out.length < limit; i++) out.push(this.order[i]);
    }
    return out;
  }

  /** World-space bounds of the whole mesh. */
  bounds(): { min: Vec3Like; max: Vec3Like } | null {
    if (this.triangleCount === 0) return null;
    return {
      min: { x: this.boundsMin[0], y: this.boundsMin[1], z: this.boundsMin[2] },
      max: { x: this.boundsMax[0], y: this.boundsMax[1], z: this.boundsMax[2] },
    };
  }
}

export function buildTriangleBvh(triangles: readonly BvhTriangleSource[]): TriangleBvh {
  return new TriangleBvh(triangles);
}
