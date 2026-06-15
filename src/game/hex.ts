import type { HexCoord } from "./types";

export function hexKey(coord: HexCoord): string {
  return `${coord.col},${coord.row}`;
}

export function isInside(coord: HexCoord, columns: number, rows: number): boolean {
  return coord.col >= 0 && coord.col < columns && coord.row >= 0 && coord.row < rows;
}

export function hexNeighbors(coord: HexCoord, columns: number, rows: number): HexCoord[] {
  const evenRow = coord.row % 2 === 0;
  const offsets = evenRow
    ? [
        [-1, -1],
        [0, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
      ]
    : [
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ];

  return offsets
    .map(([dc, dr]) => ({ col: coord.col + dc, row: coord.row + dr }))
    .filter((candidate) => isInside(candidate, columns, rows));
}

function oddRowToCube(coord: HexCoord): { x: number; y: number; z: number } {
  const x = coord.col - (coord.row - (coord.row & 1)) / 2;
  const z = coord.row;
  const y = -x - z;
  return { x, y, z };
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const ac = oddRowToCube(a);
  const bc = oddRowToCube(b);
  return Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z));
}

