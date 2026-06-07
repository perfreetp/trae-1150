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

  takeSnapshot(
    units: Unit[],
    grid: GridCell[][],
    currentUnitId: string | null,
    isOver: boolean,
    winner: string | null,
    queueData: { entries: { unitId: string; speed: number; hasActed: boolean; isWaiting: boolean }[]; currentIndex: number; turnNumber: number; subTurnNumber: number },
    rngState: number
  ): void {
    this.snapshots.push({
      turn: queueData.turnNumber,
      subTurn: queueData.subTurnNumber,
      currentUnitId,
      currentQueueIndex: queueData.currentIndex,
      rngState,
      isOver,
      winner,
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
      queueData: {
        entries: queueData.entries.map(e => ({ ...e })),
        currentIndex: queueData.currentIndex,
        turnNumber: queueData.turnNumber,
        subTurnNumber: queueData.subTurnNumber,
      },
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
        queueData: {
          entries: s.queueData.entries.map(e => ({ ...e })),
          currentIndex: s.queueData.currentIndex,
          turnNumber: s.queueData.turnNumber,
          subTurnNumber: s.queueData.subTurnNumber,
        },
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
