import {
  BattleLogEntry,
  ActionResult,
  ReplayData,
  ReplaySnapshot,
  BattleConfig,
  Unit,
  GridCell,
} from '../types';
import { SDKError, ErrorCode } from '../utils/errors';

export class ReplayManager {
  private log: BattleLogEntry[] = [];
  private actions: ActionResult[] = [];
  private snapshots: ReplaySnapshot[] = [];
  private config: BattleConfig | null = null;

  setConfig(config: BattleConfig): void {
    this.config = { ...config };
  }

  addLogEntry(entry: BattleLogEntry): void {
    this.log.push({ ...entry });
  }

  addAction(action: ActionResult): void {
    this.actions.push({ ...action, results: action.results.map(r => ({ ...r })) });
  }

  takeSnapshot(units: Unit[], grid: GridCell[][]): void {
    this.snapshots.push({
      turn: this.log.length > 0 ? this.log[this.log.length - 1].turn : 0,
      subTurn: this.log.length > 0 ? this.log[this.log.length - 1].subTurn : 0,
      units: units.map(u => ({
        ...u,
        pos: u.pos ? { ...u.pos } : null,
        stats: { ...u.stats },
        buffs: u.buffs.map(b => ({ ...b })),
        debuffs: u.debuffs.map(d => ({ ...d })),
        dots: u.dots.map(d => ({ ...d })),
        skills: u.skills.map(s => ({ ...s })),
        cooldowns: { ...u.cooldowns },
        tags: [...u.tags],
      })),
      grid: grid.map(row => row.map(cell => ({ ...cell, pos: { ...cell.pos } }))),
      log: this.log.map(l => ({ ...l })),
    });
  }

  getLog(): BattleLogEntry[] {
    return [...this.log];
  }

  getActions(): ActionResult[] {
    return [...this.actions];
  }

  getSnapshots(): ReplaySnapshot[] {
    return [...this.snapshots];
  }

  serialize(): ReplayData {
    if (!this.config) {
      throw new SDKError(ErrorCode.ReplayCorrupted, '未设置战斗配置');
    }
    return {
      config: { ...this.config },
      snapshots: this.snapshots.map(s => ({
        ...s,
        units: s.units.map(u => ({
          ...u,
          pos: u.pos ? { ...u.pos } : null,
          stats: { ...u.stats },
          buffs: u.buffs.map(b => ({ ...b })),
          debuffs: u.debuffs.map(d => ({ ...d })),
          dots: u.dots.map(d => ({ ...d })),
          skills: u.skills.map(s => ({ ...s })),
          cooldowns: { ...u.cooldowns },
          tags: [...u.tags],
        })),
        grid: s.grid.map(row => row.map(cell => ({ ...cell, pos: { ...cell.pos } }))),
        log: s.log.map(l => ({ ...l })),
      })),
      actions: this.actions.map(a => ({ ...a, results: a.results.map(r => ({ ...r })) })),
    };
  }

  static validate(data: ReplayData): boolean {
    if (!data.config || typeof data.config.width !== 'number' || typeof data.config.height !== 'number') {
      return false;
    }
    if (!Array.isArray(data.snapshots)) return false;
    if (!Array.isArray(data.actions)) return false;
    return true;
  }

  clear(): void {
    this.log = [];
    this.actions = [];
    this.snapshots = [];
  }
}
