export interface NoclipBrresSummary {
  models: Array<{ name: string; nodes: number; materials: number; shapes: number }>;
  textures: Array<{ name: string; width: number; height: number; format: string }>;
  previewDataUrl?: string;
  animations: {
    srt0: string[];
    pat0: string[];
    clr0: string[];
    chr0: string[];
    vis0: string[];
    scn0: string[];
  };
}

export async function parseNoclipBrresSummary(data: Uint8Array): Promise<NoclipBrresSummary> {
  const [{ default: ArrayBufferSlice }, BRRES, GXTexture] = await Promise.all([
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/ArrayBufferSlice.js'),
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/rres/brres.js'),
    // @ts-ignore noclip source is vendored outside this app's tsconfig surface.
    import('../../vendor/noclip.website/src/gx/gx_texture.js'),
  ]);
  let rres: any;
  try {
    rres = BRRES.parse(new ArrayBufferSlice(data.slice().buffer));
  } catch {
    return {
      models: [],
      textures: [],
      animations: { srt0: [], pat0: [], clr0: [], chr0: [], vis0: [], scn0: [] },
    };
  }
  const modelPreviewDataUrl = createModelPreviewDataUrl(rres.mdl0);
  const texturePreviewDataUrl = await createTexturePreviewDataUrl(rres.tex0, GXTexture);
  return {
    models: rres.mdl0.map((model: any) => ({
      name: model.name,
      nodes: model.nodes?.length ?? 0,
      materials: model.materials?.length ?? 0,
      shapes: model.shapes?.length ?? 0,
    })),
    textures: rres.tex0.map((texture: any) => ({
      name: texture.name,
      width: texture.width,
      height: texture.height,
      format: String(texture.format),
    })),
    previewDataUrl: modelPreviewDataUrl ?? texturePreviewDataUrl,
    animations: {
      srt0: rres.srt0.map((animation: any) => animation.name),
      pat0: rres.pat0.map((animation: any) => animation.name),
      clr0: rres.clr0.map((animation: any) => animation.name),
      chr0: rres.chr0.map((animation: any) => animation.name),
      vis0: rres.vis0.map((animation: any) => animation.name),
      scn0: rres.scn0.map((animation: any) => animation.name),
    },
  };
}

interface ProjectedVertex {
  x: number;
  y: number;
  z: number;
}

interface ModelTriangle {
  a: { x: number; y: number; z: number };
  b: { x: number; y: number; z: number };
  c: { x: number; y: number; z: number };
}

function createModelPreviewDataUrl(models: any[]): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const triangles = collectModelTriangles(models);
  if (triangles.length === 0) return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;

  const projectedTriangles = triangles
    .map((triangle) => ({
      world: triangle,
      projected: projectVertices([triangle.a, triangle.b, triangle.c]),
    }))
    .filter((triangle) => triangle.projected.length === 3);
  if (projectedTriangles.length === 0) return undefined;

  const projectedVertices = projectedTriangles.flatMap((triangle) => triangle.projected);
  const bounds = projectedVertices.reduce(
    (acc, point) => ({
      minX: Math.min(acc.minX, point.x),
      minY: Math.min(acc.minY, point.y),
      maxX: Math.max(acc.maxX, point.x),
      maxY: Math.max(acc.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
  if (!Number.isFinite(bounds.minX) || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) return undefined;

  const padding = 12;
  const scale = Math.min((canvas.width - padding * 2) / (bounds.maxX - bounds.minX), (canvas.height - padding * 2) / (bounds.maxY - bounds.minY));
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const toCanvas = (point: ProjectedVertex) => ({
    x: canvas.width / 2 + (point.x - centerX) * scale,
    y: canvas.height / 2 - (point.y - centerY) * scale,
  });

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const light = normalize3({ x: -0.45, y: 0.7, z: 0.55 });
  const drawTriangles = projectedTriangles
    .map((triangle) => {
      const [a, b, c] = triangle.projected;
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area) < 0.0001) return null;
      const normal = normalize3(cross3(sub3(triangle.world.b, triangle.world.a), sub3(triangle.world.c, triangle.world.a)));
      const diffuse = Math.max(0.18, dot3(normal, light));
      const depth = (a.z + b.z + c.z) / 3;
      return {
        points: [toCanvas(a), toCanvas(b), toCanvas(c)],
        depth,
        diffuse,
      };
    })
    .filter((triangle): triangle is NonNullable<typeof triangle> => triangle !== null)
    .sort((a, b) => a.depth - b.depth);

  const step = Math.max(1, Math.ceil(drawTriangles.length / 320));
  for (let i = 0; i < drawTriangles.length; i += step) {
    const triangle = drawTriangles[i];
    const fill = 72 + Math.round(triangle.diffuse * 148);
    ctx.fillStyle = `rgb(${fill}, ${Math.min(255, fill + 22)}, ${Math.min(255, fill + 34)})`;
    ctx.beginPath();
    ctx.moveTo(triangle.points[0].x, triangle.points[0].y);
    ctx.lineTo(triangle.points[1].x, triangle.points[1].y);
    ctx.lineTo(triangle.points[2].x, triangle.points[2].y);
    ctx.closePath();
    ctx.fill();
  }

  return canvas.toDataURL('image/png');
}

function collectModelTriangles(models: any[]): ModelTriangle[] {
  const triangles: ModelTriangle[] = [];
  for (const model of models) {
    for (const shape of model.shapes ?? []) {
      const layout = shape.loadedVertexLayout;
      const data = shape.loadedVertexData;
      const buffer = data?.vertexBuffers?.[0];
      const stride = layout?.vertexBufferStrides?.[0];
      const offset = layout?.vertexAttributeOffsets?.[9];
      if (!buffer || !stride || offset === undefined || offset < 0) continue;
      const view = new DataView(buffer);
      const maxVertexCount = Math.min(data.totalVertexCount ?? 0, Math.floor((view.byteLength - offset) / stride));
      for (let i = 0; i < maxVertexCount; i++) {
        const base = i * stride + offset;
        if (base + 12 > view.byteLength) break;
        const x = view.getFloat32(base, true);
        const y = view.getFloat32(base + 4, true);
        const z = view.getFloat32(base + 8, true);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          const vertex = { x, y, z };
          const slot = i % 3;
          if (slot === 0) triangles.push({ a: vertex, b: vertex, c: vertex });
          else if (slot === 1) triangles[triangles.length - 1].b = vertex;
          else triangles[triangles.length - 1].c = vertex;
        }
      }
    }
  }
  return triangles.filter((triangle) => triangle.a !== triangle.b && triangle.b !== triangle.c);
}

function projectVertices(vertices: Array<{ x: number; y: number; z: number }>): ProjectedVertex[] {
  const yaw = -Math.PI / 4;
  const pitch = -Math.PI / 8;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  return vertices.map((vertex) => {
    const x1 = vertex.x * cosY - vertex.z * sinY;
    const z1 = vertex.x * sinY + vertex.z * cosY;
    const y1 = vertex.y * cosP - z1 * sinP;
    const z2 = vertex.y * sinP + z1 * cosP;
    return { x: x1, y: y1, z: z2 };
  });
}

async function createTexturePreviewDataUrl(textures: any[], GXTexture: any): Promise<string | undefined> {
  if (typeof document === 'undefined') return undefined;
  const texture = textures.find((candidate) => candidate.width > 0 && candidate.height > 0 && candidate.data);
  if (!texture) return undefined;
  try {
    const mip = GXTexture.calcMipChain(texture, 1).mipLevels[0];
    const decoded = await GXTexture.decodeTexture(mip);
    const pixels = decoded.pixels instanceof Uint8ClampedArray ? decoded.pixels : new Uint8ClampedArray(decoded.pixels.buffer, decoded.pixels.byteOffset, decoded.pixels.byteLength);
    const source = document.createElement('canvas');
    source.width = mip.width;
    source.height = mip.height;
    const sourceCtx = source.getContext('2d');
    if (!sourceCtx) return undefined;
    sourceCtx.putImageData(new ImageData(pixels, mip.width, mip.height), 0, 0);

    const maxSize = 96;
    const scale = Math.min(1, maxSize / Math.max(mip.width, mip.height));
    const target = document.createElement('canvas');
    target.width = Math.max(1, Math.round(mip.width * scale));
    target.height = Math.max(1, Math.round(mip.height * scale));
    const targetCtx = target.getContext('2d');
    if (!targetCtx) return undefined;
    targetCtx.imageSmoothingEnabled = true;
    targetCtx.drawImage(source, 0, 0, target.width, target.height);
    return target.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

function sub3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize3(v: { x: number; y: number; z: number }) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
