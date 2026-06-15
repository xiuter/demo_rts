import { hexDistance, hexKey, hexNeighbors } from "./hex";
import type { HexCoord } from "./types";

function reconstruct(cameFrom: Map<string, string>, currentKey: string): HexCoord[] {
  const path: HexCoord[] = [];
  let cursor: string | undefined = currentKey;
  while (cursor) {
    const [col, row] = cursor.split(",").map(Number);
    path.unshift({ col, row });
    cursor = cameFrom.get(cursor);
  }
  return path;
}

export function findHexPath(
  start: HexCoord,
  goal: HexCoord,
  columns: number,
  rows: number,
  blocked: (coord: HexCoord) => boolean = () => false,
): HexCoord[] {
  const startKey = hexKey(start);
  const goalKey = hexKey(goal);
  const open = new Set<string>([startKey]);
  const coords = new Map<string, HexCoord>([[startKey, start]]);
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const fScore = new Map<string, number>([[startKey, hexDistance(start, goal)]]);

  while (open.size > 0) {
    let currentKey = "";
    let currentScore = Number.POSITIVE_INFINITY;
    for (const candidate of open) {
      const score = fScore.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (score < currentScore) {
        currentKey = candidate;
        currentScore = score;
      }
    }

    if (currentKey === goalKey) {
      return reconstruct(cameFrom, currentKey);
    }

    open.delete(currentKey);
    const current = coords.get(currentKey);
    if (!current) {
      break;
    }

    for (const neighbor of hexNeighbors(current, columns, rows)) {
      const neighborKey = hexKey(neighbor);
      if (blocked(neighbor) && neighborKey !== goalKey) {
        continue;
      }
      const tentative = (gScore.get(currentKey) ?? Number.POSITIVE_INFINITY) + 1;
      if (tentative < (gScore.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        cameFrom.set(neighborKey, currentKey);
        coords.set(neighborKey, neighbor);
        gScore.set(neighborKey, tentative);
        fScore.set(neighborKey, tentative + hexDistance(neighbor, goal));
        open.add(neighborKey);
      }
    }
  }

  return [];
}

