import { SimulationError } from "./math.js";

export const BASE_ALTITUDE = 250;
export const BLOCK_LENGTH = 10000;
export const LOAD_DISTANCE = 1000;
export const KEEP_DISTANCE = 2000;
export const MAX_TRACK_ANGLE = (3.5 * Math.PI) / 180;
const MAX_RISE = Math.sin(MAX_TRACK_ANGLE);
const ROUNDING = 100;
// Knot spacing and share of the maximum derivative. No short road-noise layers.
const LAYERS = [
  [5000, 0.45],
  [2000, 0.35],
  [1000, 0.2],
] as const;

export interface TerrainBlock {
  index: number;
  knots: number[][];
}
export interface TerrainState {
  generated: boolean;
  seed: number;
  blocks: TerrainBlock[];
}

/** Stable indexed random heights; order of generation/travel never affects them. */
function random(seed: number, layer: number, index: number): number {
  let x = (seed ^ Math.imul(index, 0x9e3779b1) ^ Math.imul(layer + 1, 0x85ebca6b)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
function firstKnot(block: number, spacing: number): number {
  return Math.floor((block * BLOCK_LENGTH - ROUNDING / 2) / spacing);
}
export function generateBlock(seed: number, index: number): TerrainBlock {
  return {
    index,
    knots: LAYERS.map(([spacing, share], layer) => {
      const first = firstKnot(index, spacing);
      const last = Math.floor(((index + 1) * BLOCK_LENGTH + ROUNDING / 2) / spacing) + 1;
      return Array.from(
        { length: last - first + 1 },
        (_, i) => (random(seed, layer, first + i) - 0.5) * spacing * MAX_RISE * share,
      );
    }),
  };
}
function blockDistance(index: number, distance: number): number {
  return Math.max(index * BLOCK_LENGTH - distance, distance - (index + 1) * BLOCK_LENGTH, 0);
}

function checkDistance(distance: number): void {
  if (!Number.isFinite(distance) || Math.abs(distance) > 1e12)
    throw new SimulationError("Track position is outside the supported range.");
}

/** Immutable bounded module state: only the current block and nearby neighbors. */
export function terrainWindow(terrain: TerrainState, distance: number): TerrainState {
  checkDistance(distance);
  if (!terrain.generated) return terrain;
  const current = Math.floor(distance / BLOCK_LENGTH);
  const kept = terrain.blocks.filter(
    (block) =>
      Math.abs(block.index - current) <= 1 && blockDistance(block.index, distance) <= KEEP_DISTANCE,
  );
  for (const index of [current - 1, current, current + 1]) {
    if (
      (index === current || blockDistance(index, distance) <= LOAD_DISTANCE) &&
      !kept.some((block) => block.index === index)
    )
      kept.push(generateBlock(terrain.seed, index));
  }
  kept.sort((a, b) => a.index - b.index);
  return kept.length === terrain.blocks.length &&
    kept.every((block, i) => block === terrain.blocks[i])
    ? terrain
    : { ...terrain, blocks: kept };
}
export function createTerrain(generated = false, seed = 0, distance = 0): TerrainState {
  return terrainWindow({ generated, seed: generated ? seed : 0, blocks: [] }, distance);
}

/** Signed distance is along the track, hence dh/ds = sin(angle), not tan(angle). */
export function terrainAt(
  terrain: TerrainState,
  distance: number,
): { altitude: number; rise: number; angle: number } {
  checkDistance(distance);
  if (!terrain.generated) return { altitude: BASE_ALTITUDE, rise: 0, angle: 0 };
  const block = terrain.blocks.find((item) => item.index === Math.floor(distance / BLOCK_LENGTH));
  if (!block) throw new SimulationError("Terrain block is missing at the current position.");
  let altitude = BASE_ALTITUDE,
    rise = 0;
  LAYERS.forEach(([spacing], layer) => {
    const first = firstKnot(block.index, spacing),
      knots = block.knots[layer]!;
    const raw = (s: number): number => {
      const index = Math.floor(s / spacing),
        t = (s - index * spacing) / spacing;
      const a = knots[index - first]!,
        b = knots[index + 1 - first]!;
      return a + (b - a) * t;
    };
    const left = distance - ROUNDING / 2,
      right = distance + ROUNDING / 2;
    // Exact box average of the zig-zag: quadratic rounded corners, continuous
    // gradient, and no increase in its maximum derivative. No numerical solve.
    let start = left,
      integral = 0;
    while (start < right) {
      const end = Math.min(right, (Math.floor(start / spacing) + 1) * spacing);
      integral += ((raw(start) + raw(end)) * (end - start)) / 2;
      start = end;
    }
    altitude += integral / ROUNDING;
    rise += (raw(right) - raw(left)) / ROUNDING;
  });
  return { altitude, rise, angle: Math.asin(rise) };
}

/** Bound malformed snapshot arrays before inspecting their canonical seeded data. */
export function validateTerrain(terrain: TerrainState, distance: number, altitude: number): void {
  const fail = (): never => {
    throw new SimulationError("Terrain state is invalid or inconsistent with its seed/position.");
  };
  if (
    !terrain ||
    typeof terrain.generated !== "boolean" ||
    !Number.isInteger(terrain.seed) ||
    terrain.seed < 0 ||
    terrain.seed > 0xffffffff ||
    !Array.isArray(terrain.blocks) ||
    terrain.blocks.length > 3 ||
    !Number.isFinite(distance) ||
    Math.abs(distance) > 1e12 ||
    !Number.isFinite(altitude)
  )
    fail();
  if (!terrain.generated) {
    if (terrain.seed !== 0 || terrain.blocks.length !== 0 || altitude !== BASE_ALTITUDE) fail();
    return;
  }
  const current = Math.floor(distance / BLOCK_LENGTH),
    seen = new Set<number>();
  for (const block of terrain.blocks) {
    if (
      !block ||
      Object.keys(block).length !== 2 ||
      !Number.isInteger(block.index) ||
      seen.has(block.index) ||
      Math.abs(block.index - current) > 1 ||
      blockDistance(block.index, distance) > KEEP_DISTANCE ||
      !Array.isArray(block.knots) ||
      block.knots.length !== LAYERS.length
    )
      fail();
    const expected = generateBlock(terrain.seed, block.index);
    for (let layer = 0; layer < LAYERS.length; layer++) {
      const actual = block.knots[layer],
        reference = expected.knots[layer]!;
      if (
        !Array.isArray(actual) ||
        actual.length !== reference.length ||
        reference.some((value, i) => actual[i] !== value)
      )
        fail();
    }
    seen.add(block.index);
  }
  for (const index of [current - 1, current, current + 1]) {
    if ((index === current || blockDistance(index, distance) <= LOAD_DISTANCE) && !seen.has(index))
      fail();
  }
  const point = terrainAt(terrain, distance);
  if (
    Math.abs(point.altitude - altitude) > 1e-7 ||
    !Number.isFinite(point.angle) ||
    Math.abs(point.angle) > MAX_TRACK_ANGLE + 1e-10
  )
    fail();
}
