import { Unit, UnitStatus, DebuffType } from '../types';
import { SDKError, ErrorCode } from '../utils/errors';

export interface TurnQueueEntry {
  unitId: string;
  speed: number;
  hasActed: boolean;
  isWaiting: boolean;
}

export class TurnQueue {
  private queue: TurnQueueEntry[] = [];
  private currentIndex: number = -1;
  private turnNumber: number = 0;
  private subTurnNumber: number = 0;

  buildQueue(units: Unit[]): void {
    this.queue = units
      .filter(u => u.status !== UnitStatus.Dead)
      .map(u => ({
        unitId: u.id,
        speed: u.stats.spd,
        hasActed: false,
        isWaiting: false,
      }))
      .sort((a, b) => b.speed - a.speed);
    this.currentIndex = this.queue.length > 0 ? 0 : -1;
    this.turnNumber = 1;
    this.subTurnNumber = 0;
  }

  rebuildWithSpeeds(getSpeed: (unitId: string) => number): void {
    for (const entry of this.queue) {
      entry.speed = getSpeed(entry.unitId);
    }
    this.queue.sort((a, b) => b.speed - a.speed);
  }

  next(): TurnQueueEntry | null {
    if (this.queue.length === 0) return null;
    const startIdx = this.currentIndex < 0 ? 0 : this.currentIndex;
    for (let i = 0; i < this.queue.length; i++) {
      const idx = (startIdx + i) % this.queue.length;
      const entry = this.queue[idx];
      if (!entry.hasActed && !entry.isWaiting) {
        this.currentIndex = idx;
        this.subTurnNumber++;
        return entry;
      }
    }
    this.advanceRound();
    return this.next();
  }

  private advanceRound(): void {
    this.turnNumber++;
    this.subTurnNumber = 0;
    for (const entry of this.queue) {
      entry.hasActed = false;
      entry.isWaiting = false;
    }
    this.currentIndex = 0;
  }

  markActed(unitId: string): void {
    const entry = this.queue.find(e => e.unitId === unitId);
    if (entry) entry.hasActed = true;
  }

  wait(unitId: string): void {
    const entry = this.queue.find(e => e.unitId === unitId);
    if (!entry) throw new SDKError(ErrorCode.UnitNotFound, unitId);
    if (entry.hasActed) return;
    entry.isWaiting = true;
  }

  skip(unitId: string): void {
    this.markActed(unitId);
  }

  removeUnit(unitId: string): void {
    const idx = this.queue.findIndex(e => e.unitId === unitId);
    if (idx === -1) return;
    this.queue.splice(idx, 1);
    if (this.currentIndex >= this.queue.length) {
      this.currentIndex = 0;
    } else if (idx < this.currentIndex) {
      this.currentIndex--;
    }
  }

  addUnit(unitId: string, speed: number, insertOrder: 'last' | 'speed' = 'speed'): void {
    const entry: TurnQueueEntry = { unitId, speed, hasActed: true, isWaiting: false };
    if (insertOrder === 'last') {
      this.queue.push(entry);
    } else {
      let insertIdx = this.queue.length;
      for (let i = 0; i < this.queue.length; i++) {
        if (this.queue[i].speed < speed) {
          insertIdx = i;
          break;
        }
      }
      this.queue.splice(insertIdx, 0, entry);
      if (insertIdx <= this.currentIndex) {
        this.currentIndex++;
      }
    }
  }

  getCurrent(): TurnQueueEntry | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.queue.length) return null;
    return this.queue[this.currentIndex];
  }

  getQueue(): TurnQueueEntry[] {
    return [...this.queue];
  }

  getTurnNumber(): number {
    return this.turnNumber;
  }

  getSubTurnNumber(): number {
    return this.subTurnNumber;
  }

  isRoundOver(): boolean {
    return this.queue.every(e => e.hasActed || e.isWaiting);
  }

  getWaitingUnits(): TurnQueueEntry[] {
    return this.queue.filter(e => e.isWaiting && !e.hasActed);
  }

  processWaiting(): void {
    for (const entry of this.queue) {
      if (entry.isWaiting && !entry.hasActed) {
        entry.isWaiting = false;
      }
    }
  }

  serialize(): { unitId: string; speed: number; hasActed: boolean; isWaiting: boolean }[] {
    return this.queue.map(e => ({ unitId: e.unitId, speed: e.speed, hasActed: e.hasActed, isWaiting: e.isWaiting }));
  }

  restore(entries: { unitId: string; speed: number; hasActed: boolean; isWaiting: boolean }[], turnNumber: number, subTurnNumber: number): void {
    this.queue = entries.map(e => ({ unitId: e.unitId, speed: e.speed, hasActed: e.hasActed, isWaiting: e.isWaiting }));
    this.turnNumber = turnNumber;
    this.subTurnNumber = subTurnNumber;
    this.currentIndex = this.queue.length > 0 ? 0 : -1;
  }
}
