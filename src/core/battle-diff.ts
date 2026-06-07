import {
  BattleState,
  Unit,
  BattleLogEntry,
  ReplaySnapshot,
  BattleDiffResult,
  DiffItem,
} from '../types';

import type { BattleRoom } from './battle-room';

export class BattleDiff {
  static compareStates(
    stateA: BattleState,
    unitsA: Unit[],
    logA: BattleLogEntry[],
    stateB: BattleState,
    unitsB: Unit[],
    logB: BattleLogEntry[]
  ): BattleDiffResult {
    const diffs: DiffItem[] = [];

    if (stateA.currentUnitId !== stateB.currentUnitId) {
      diffs.push({ field: 'currentUnitId', valueA: stateA.currentUnitId, valueB: stateB.currentUnitId });
    }
    if (stateA.turn !== stateB.turn) {
      diffs.push({ field: 'turn', valueA: stateA.turn, valueB: stateB.turn });
    }
    if (stateA.subTurn !== stateB.subTurn) {
      diffs.push({ field: 'subTurn', valueA: stateA.subTurn, valueB: stateB.subTurn });
    }
    if (stateA.isOver !== stateB.isOver) {
      diffs.push({ field: 'isOver', valueA: stateA.isOver, valueB: stateB.isOver });
    }
    if (stateA.winner !== stateB.winner) {
      diffs.push({ field: 'winner', valueA: stateA.winner, valueB: stateB.winner });
    }
    if (JSON.stringify(stateA.unitOrder) !== JSON.stringify(stateB.unitOrder)) {
      diffs.push({ field: 'unitOrder', valueA: stateA.unitOrder, valueB: stateB.unitOrder });
    }

    const mapA = new Map(unitsA.map(u => [u.id, u]));
    const mapB = new Map(unitsB.map(u => [u.id, u]));
    const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

    for (const id of allIds) {
      const uA = mapA.get(id);
      const uB = mapB.get(id);
      if (!uA && uB) {
        diffs.push({ field: `unit.${id}.exists`, valueA: false, valueB: true });
        continue;
      }
      if (uA && !uB) {
        diffs.push({ field: `unit.${id}.exists`, valueA: true, valueB: false });
        continue;
      }
      if (!uA || !uB) continue;

      if (uA.stats.hp !== uB.stats.hp) {
        diffs.push({ field: `unit.${id}.hp`, valueA: uA.stats.hp, valueB: uB.stats.hp });
      }
      if (uA.status !== uB.status) {
        diffs.push({ field: `unit.${id}.status`, valueA: uA.status, valueB: uB.status });
      }
      if (JSON.stringify(uA.pos) !== JSON.stringify(uB.pos)) {
        diffs.push({ field: `unit.${id}.pos`, valueA: uA.pos, valueB: uB.pos });
      }
      if (JSON.stringify(uA.cooldowns) !== JSON.stringify(uB.cooldowns)) {
        diffs.push({ field: `unit.${id}.cooldowns`, valueA: uA.cooldowns, valueB: uB.cooldowns });
      }
      if (uA.shield !== uB.shield) {
        diffs.push({ field: `unit.${id}.shield`, valueA: uA.shield, valueB: uB.shield });
      }
    }

    if (logA.length !== logB.length) {
      diffs.push({ field: 'log.length', valueA: logA.length, valueB: logB.length });
    } else {
      for (let i = 0; i < logA.length; i++) {
        if (JSON.stringify(logA[i]) !== JSON.stringify(logB[i])) {
          diffs.push({ field: `log[${i}]`, valueA: logA[i], valueB: logB[i] });
        }
      }
    }

    return { identical: diffs.length === 0, differences: diffs };
  }

  static compareSnapshots(snapA: ReplaySnapshot, snapB: ReplaySnapshot): BattleDiffResult {
    const diffs: DiffItem[] = [];

    if (snapA.currentUnitId !== snapB.currentUnitId) {
      diffs.push({ field: 'currentUnitId', valueA: snapA.currentUnitId, valueB: snapB.currentUnitId });
    }
    if (snapA.turn !== snapB.turn) {
      diffs.push({ field: 'turn', valueA: snapA.turn, valueB: snapB.turn });
    }
    if (snapA.subTurn !== snapB.subTurn) {
      diffs.push({ field: 'subTurn', valueA: snapA.subTurn, valueB: snapB.subTurn });
    }
    if (snapA.rngState !== snapB.rngState) {
      diffs.push({ field: 'rngState', valueA: snapA.rngState, valueB: snapB.rngState });
    }
    if (snapA.isOver !== snapB.isOver) {
      diffs.push({ field: 'isOver', valueA: snapA.isOver, valueB: snapB.isOver });
    }
    if (snapA.winner !== snapB.winner) {
      diffs.push({ field: 'winner', valueA: snapA.winner, valueB: snapB.winner });
    }
    if (snapA.currentQueueIndex !== snapB.currentQueueIndex) {
      diffs.push({ field: 'currentQueueIndex', valueA: snapA.currentQueueIndex, valueB: snapB.currentQueueIndex });
    }
    if (JSON.stringify(snapA.queueData) !== JSON.stringify(snapB.queueData)) {
      diffs.push({ field: 'queueData', valueA: snapA.queueData, valueB: snapB.queueData });
    }

    const mapA = new Map(snapA.units.map(u => [u.id, u]));
    const mapB = new Map(snapB.units.map(u => [u.id, u]));
    const allIds = new Set([...mapA.keys(), ...mapB.keys()]);

    for (const id of allIds) {
      const uA = mapA.get(id);
      const uB = mapB.get(id);
      if (!uA && uB) {
        diffs.push({ field: `unit.${id}.exists`, valueA: false, valueB: true });
        continue;
      }
      if (uA && !uB) {
        diffs.push({ field: `unit.${id}.exists`, valueA: true, valueB: false });
        continue;
      }
      if (!uA || !uB) continue;

      if (uA.stats.hp !== uB.stats.hp) {
        diffs.push({ field: `unit.${id}.hp`, valueA: uA.stats.hp, valueB: uB.stats.hp });
      }
      if (uA.status !== uB.status) {
        diffs.push({ field: `unit.${id}.status`, valueA: uA.status, valueB: uB.status });
      }
      if (JSON.stringify(uA.pos) !== JSON.stringify(uB.pos)) {
        diffs.push({ field: `unit.${id}.pos`, valueA: uA.pos, valueB: uB.pos });
      }
      if (JSON.stringify(uA.cooldowns) !== JSON.stringify(uB.cooldowns)) {
        diffs.push({ field: `unit.${id}.cooldowns`, valueA: uA.cooldowns, valueB: uB.cooldowns });
      }
      if (uA.shield !== uB.shield) {
        diffs.push({ field: `unit.${id}.shield`, valueA: uA.shield, valueB: uB.shield });
      }
    }

    if (snapA.log.length !== snapB.log.length) {
      diffs.push({ field: 'log.length', valueA: snapA.log.length, valueB: snapB.log.length });
    } else {
      for (let i = 0; i < snapA.log.length; i++) {
        if (JSON.stringify(snapA.log[i]) !== JSON.stringify(snapB.log[i])) {
          diffs.push({ field: `log[${i}]`, valueA: snapA.log[i], valueB: snapB.log[i] });
        }
      }
    }

    return { identical: diffs.length === 0, differences: diffs };
  }

  static compareReplayData(dataA: import('../types').ReplayData, dataB: import('../types').ReplayData): BattleDiffResult {
    if (dataA.snapshots.length === 0 || dataB.snapshots.length === 0) {
      return { identical: false, differences: [{ field: 'snapshots', valueA: dataA.snapshots.length, valueB: dataB.snapshots.length }] };
    }
    return BattleDiff.compareSnapshots(
      dataA.snapshots[dataA.snapshots.length - 1],
      dataB.snapshots[dataB.snapshots.length - 1]
    );
  }

  static compareRooms(roomA: BattleRoom, roomB: BattleRoom): BattleDiffResult {
    const stateA = roomA.getState();
    const unitsA = roomA.getUnitManager().getAllUnits();
    const logA = roomA.getReplayManager().getLog();
    const stateB = roomB.getState();
    const unitsB = roomB.getUnitManager().getAllUnits();
    const logB = roomB.getReplayManager().getLog();

    const result = BattleDiff.compareStates(stateA, unitsA, logA, stateB, unitsB, logB);

    const rngA = roomA.getRng().getState();
    const rngB = roomB.getRng().getState();
    if (rngA !== rngB) {
      result.identical = false;
      result.differences.push({ field: 'rngState', valueA: rngA, valueB: rngB });
    }

    return result;
  }
}
