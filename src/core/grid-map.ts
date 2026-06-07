import {
  TerrainType,
  TerrainConfig,
  GridCell,
  Position,
} from '../types';
import { SDKError, ErrorCode } from '../utils/errors';

const DEFAULT_TERRAIN: Record<TerrainType, TerrainConfig> = {
  [TerrainType.Plain]: { moveCost: 1, defenseBonus: 0, avoidBonus: 0, passable: true },
  [TerrainType.Forest]: { moveCost: 2, defenseBonus: 2, avoidBonus: 10, passable: true },
  [TerrainType.Mountain]: { moveCost: 3, defenseBonus: 5, avoidBonus: 20, passable: true },
  [TerrainType.Water]: { moveCost: 99, defenseBonus: 0, avoidBonus: 0, passable: false },
  [TerrainType.Wall]: { moveCost: 99, defenseBonus: 0, avoidBonus: 0, passable: false },
  [TerrainType.Lava]: { moveCost: 2, defenseBonus: 0, avoidBonus: 0, damagePerTurn: 5, passable: true },
  [TerrainType.Swamp]: { moveCost: 2, defenseBonus: -2, avoidBonus: -5, passable: true },
  [TerrainType.Ice]: { moveCost: 1, defenseBonus: -1, avoidBonus: -10, passable: true },
};

interface ReachableCell {
  pos: Position;
  cost: number;
}

export class GridMap {
  private width: number;
  private height: number;
  private cells: GridCell[][];
  private terrainConfig: Record<TerrainType, TerrainConfig>;

  constructor(
    width: number,
    height: number,
    terrainMap?: TerrainType[][],
    customTerrainConfig?: Partial<Record<TerrainType, Partial<TerrainConfig>>>
  ) {
    this.width = width;
    this.height = height;
    this.terrainConfig = { ...DEFAULT_TERRAIN };
    if (customTerrainConfig) {
      for (const [type, override] of Object.entries(customTerrainConfig)) {
        this.terrainConfig[type as TerrainType] = {
          ...DEFAULT_TERRAIN[type as TerrainType],
          ...override,
        };
      }
    }
    this.cells = [];
    for (let y = 0; y < height; y++) {
      const row: GridCell[] = [];
      for (let x = 0; x < width; x++) {
        const terrain = terrainMap?.[y]?.[x] ?? TerrainType.Plain;
        row.push({ pos: { x, y }, terrain, unitId: null });
      }
      this.cells.push(row);
    }
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getCell(pos: Position): GridCell {
    this.validatePos(pos);
    return this.cells[pos.y][pos.x];
  }

  getAllCells(): GridCell[][] {
    return this.cells;
  }

  getTerrainConfig(terrain: TerrainType): TerrainConfig {
    return this.terrainConfig[terrain];
  }

  setTerrain(pos: Position, terrain: TerrainType): void {
    this.validatePos(pos);
    this.cells[pos.y][pos.x].terrain = terrain;
  }

  placeUnit(pos: Position, unitId: string): void {
    this.validatePos(pos);
    const cell = this.cells[pos.y][pos.x];
    if (cell.unitId !== null) {
      throw new SDKError(ErrorCode.CellOccupied, `(${pos.x},${pos.y})`);
    }
    if (!this.terrainConfig[cell.terrain].passable) {
      throw new SDKError(ErrorCode.CellImpassable, `(${pos.x},${pos.y}) ${cell.terrain}`);
    }
    cell.unitId = unitId;
  }

  removeUnit(pos: Position): void {
    this.validatePos(pos);
    this.cells[pos.y][pos.x].unitId = null;
  }

  moveUnit(from: Position, to: Position, unitId: string): void {
    this.validatePos(from);
    this.validatePos(to);
    const fromCell = this.cells[from.y][from.x];
    if (fromCell.unitId !== unitId) {
      throw new SDKError(ErrorCode.UnitNotFound, `${unitId} 不在 (${from.x},${from.y})`);
    }
    const toCell = this.cells[to.y][to.x];
    if (toCell.unitId !== null) {
      throw new SDKError(ErrorCode.CellOccupied, `(${to.x},${to.y})`);
    }
    if (!this.terrainConfig[toCell.terrain].passable) {
      throw new SDKError(ErrorCode.CellImpassable, `(${to.x},${to.y}) ${toCell.terrain}`);
    }
    fromCell.unitId = null;
    toCell.unitId = unitId;
  }

  findUnitPos(unitId: string): Position | null {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y][x].unitId === unitId) {
          return { x, y };
        }
      }
    }
    return null;
  }

  getReachableCells(from: Position, moveRange: number): ReachableCell[] {
    this.validatePos(from);
    const results: ReachableCell[] = [];
    const visited = new Map<string, number>();
    const key = (p: Position) => `${p.x},${p.y}`;
    const queue: Array<{ pos: Position; cost: number }> = [{ pos: from, cost: 0 }];
    visited.set(key(from), 0);

    const dirs = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const cell = this.cells[current.pos.y][current.pos.x];
      const cfg = this.terrainConfig[cell.terrain];

      if (current.cost > 0 && cfg.passable && cell.unitId === null) {
        results.push({ pos: current.pos, cost: current.cost });
      }

      for (const d of dirs) {
        const nx = current.pos.x + d.x;
        const ny = current.pos.y + d.y;
        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
        const nextPos = { x: nx, y: ny };
        const nextCell = this.cells[ny][nx];
        const nextCfg = this.terrainConfig[nextCell.terrain];
        if (!nextCfg.passable) continue;

        const nextCost = current.cost + nextCfg.moveCost;
        if (nextCost > moveRange) continue;

        const k = key(nextPos);
        const existing = visited.get(k);
        if (existing !== undefined && existing <= nextCost) continue;

        visited.set(k, nextCost);
        if (nextCell.unitId === null || nextPos.x === from.x && nextPos.y === from.y) {
          queue.push({ pos: nextPos, cost: nextCost });
        }
      }
    }

    return results;
  }

  getCellsInRange(center: Position, radius: number): Position[] {
    const result: Position[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > radius) continue;
        const nx = center.x + dx;
        const ny = center.y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          result.push({ x: nx, y: ny });
        }
      }
    }
    return result;
  }

  distance(a: Position, b: Position): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  getTerrainEffects(pos: Position): TerrainConfig {
    this.validatePos(pos);
    return this.terrainConfig[this.cells[pos.y][pos.x].terrain];
  }

  clone(): GridMap {
    const map = new GridMap(this.width, this.height, undefined, this.terrainConfig);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        map.cells[y][x] = { ...this.cells[y][x], pos: { ...this.cells[y][x].pos } };
      }
    }
    return map;
  }

  serialize(): GridCell[][] {
    return this.cells.map(row =>
      row.map(cell => ({ ...cell, pos: { ...cell.pos } }))
    );
  }

  private validatePos(pos: Position): void {
    if (pos.x < 0 || pos.x >= this.width || pos.y < 0 || pos.y >= this.height) {
      throw new SDKError(ErrorCode.InvalidPosition, `(${pos.x},${pos.y}) 地图范围 (${this.width}x${this.height})`);
    }
  }
}
