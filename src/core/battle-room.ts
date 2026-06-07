import {
  BattleConfig,
  BattleState,
  Unit,
  UnitBaseStats,
  UnitStatus,
  SkillDefinition,
  SkillEffectType,
  SkillTargetInfo,
  Position,
  ActionResult,
  TargetResult,
  EventListener,
  WinCondition,
  LoseCondition,
  ReplayData,
  SkillTargetType,
} from '../types';
import { SeededRNG } from '../utils/rng';
import { SDKError, ErrorCode } from '../utils/errors';
import { GridMap } from './grid-map';
import { UnitManager } from './unit';
import { TurnQueue } from './turn-queue';
import { SkillManager } from './skill';
import { EffectResolver } from './effect';
import { ReplayManager } from './replay';

interface PreSkillSnapshot {
  units: Unit[];
  grid: import('../types').GridCell[][];
  cooldowns: Record<string, number>;
  rngState: number;
  queueData: { entries: { unitId: string; speed: number; hasActed: boolean; isWaiting: boolean }[]; currentIndex: number; turnNumber: number; subTurnNumber: number };
  logLength: number;
  actionsLength: number;
}

interface PendingEvent {
  event: string;
  data: unknown;
}

export class BattleRoom {
  private config: BattleConfig;
  private grid: GridMap;
  private unitManager: UnitManager;
  private turnQueue: TurnQueue;
  private skillManager: SkillManager;
  private effectResolver: EffectResolver;
  private replayManager: ReplayManager;
  private rng: SeededRNG;

  private started: boolean = false;
  private isOver: boolean = false;
  private winner: string | null = null;
  private currentUnitId: string | null = null;

  private winCondition: WinCondition | null;
  private loseCondition: LoseCondition | null;
  private eventListeners: Map<string, EventListener[]> = new Map();
  private pendingEvents: PendingEvent[] = [];

  constructor(config: BattleConfig) {
    this.config = { ...config };
    this.rng = new SeededRNG(config.seed);
    this.grid = new GridMap(config.width, config.height, config.terrainMap, config.customTerrainConfig);
    this.unitManager = new UnitManager();
    this.turnQueue = new TurnQueue();
    this.skillManager = new SkillManager();
    this.effectResolver = new EffectResolver(
      this.rng,
      this.unitManager,
      this.grid,
      (unit) => { this.onUnitSummoned(unit); },
      (unit) => { this.onUnitRevived(unit); }
    );
    this.replayManager = new ReplayManager();
    this.replayManager.setConfig(config);
    this.winCondition = config.winCondition ?? null;
    this.loseCondition = config.loseCondition ?? null;
  }

  addUnit(
    id: string,
    name: string,
    team: string,
    stats: UnitBaseStats,
    pos: Position,
    skills: SkillDefinition[] = [],
    options?: { isSummon?: boolean; summonerId?: string; tags?: string[] }
  ): Unit {
    if (this.started) {
      throw new SDKError(ErrorCode.BattleAlreadyStarted);
    }
    const unit = this.unitManager.createUnit(id, name, team, stats, skills, options);
    this.unitManager.setUnitPosition(id, pos);
    this.grid.placeUnit(pos, id);
    this.emit('unit_added', { unitId: id, team, pos });
    return unit;
  }

  removeUnit(unitId: string): void {
    if (this.started) {
      throw new SDKError(ErrorCode.BattleAlreadyStarted);
    }
    const unit = this.unitManager.getUnit(unitId);
    if (unit.pos) {
      this.grid.removeUnit(unit.pos);
    }
    this.unitManager.removeUnit(unitId);
    this.emit('unit_removed', { unitId });
  }

  start(): void {
    if (this.started) {
      throw new SDKError(ErrorCode.BattleAlreadyStarted);
    }
    this.started = true;
    const aliveUnits = this.unitManager.getAliveUnits();
    this.turnQueue.buildQueue(aliveUnits);
    this.turnQueue.rebuildWithSpeeds((uid) => this.unitManager.getEffectiveStat(uid, 'spd'));
    this.takeSnapshot();
    const entry = this.turnQueue.next();
    if (entry) {
      this.currentUnitId = entry.unitId;
      this.processStartOfTurn(entry.unitId);
    }
    this.takeSnapshot();
    this.emit('battle_start', {});
  }

  getCurrentUnitId(): string | null {
    return this.currentUnitId;
  }

  getState(): BattleState {
    return {
      turn: this.turnQueue.getTurnNumber(),
      subTurn: this.turnQueue.getSubTurnNumber(),
      isOver: this.isOver,
      winner: this.winner,
      currentUnitId: this.currentUnitId,
      unitOrder: this.turnQueue.getQueue().map(e => e.unitId),
    };
  }

  getGrid(): GridMap {
    return this.grid;
  }

  getUnitManager(): UnitManager {
    return this.unitManager;
  }

  getTurnQueue(): TurnQueue {
    return this.turnQueue;
  }

  getReplayManager(): ReplayManager {
    return this.replayManager;
  }

  getEffectResolver(): EffectResolver {
    return this.effectResolver;
  }

  getRng(): SeededRNG {
    return this.rng;
  }

  moveUnit(unitId: string, targetPos: Position): void {
    this.assertBattleActive();
    this.assertCurrentUnit(unitId);
    if (!this.unitManager.canAct(unitId)) {
      throw new SDKError(ErrorCode.UnitStunned, unitId);
    }
    const unit = this.unitManager.getUnit(unitId);
    if (!unit.pos) {
      throw new SDKError(ErrorCode.InvalidPosition, `单位 ${unitId} 无位置`);
    }
    const reachable = this.grid.getReachableCells(unit.pos, this.unitManager.getEffectiveStat(unitId, 'moveRange'));
    const canReach = reachable.some(c => c.pos.x === targetPos.x && c.pos.y === targetPos.y);
    if (!canReach) {
      throw new SDKError(ErrorCode.OutOfRange, `(${targetPos.x},${targetPos.y})`);
    }
    const oldPos = { ...unit.pos };
    this.grid.moveUnit(oldPos, targetPos, unitId);
    this.unitManager.setUnitPosition(unitId, targetPos);
    this.logAction('move', unitId, [], { from: oldPos, to: targetPos });
    this.emit('unit_moved', { unitId, from: oldPos, to: targetPos });
    this.takeSnapshot();
  }

  useSkill(actorId: string, skillId: string, targetIds: string[]): ActionResult {
    this.assertBattleActive();
    this.assertCurrentUnit(actorId);
    if (!this.unitManager.canAct(actorId)) {
      throw new SDKError(ErrorCode.UnitStunned, actorId);
    }
    const actor = this.unitManager.getUnit(actorId);
    const skill = this.skillManager.validateSkill(actor, skillId);
    if (!actor.pos) {
      throw new SDKError(ErrorCode.InvalidPosition, `单位 ${actorId} 无位置`);
    }

    const validatedTargets = this.resolveAndValidateTargets(actor, skill, targetIds);

    this.pendingEvents = [];
    const pre = this.capturePreSkillSnapshot(actor);

    const results: TargetResult[] = [];
    for (const tid of validatedTargets) {
      const target = this.unitManager.getUnitSafe(tid);
      if (!target) continue;
      for (const effect of skill.effects) {
        const result = this.effectResolver.resolveEffect(actor, target, effect, { skillRange: skill.range });
        results.push(result);
      }
    }

    const hasFailure = results.some(r => r.failureReason);
    if (hasFailure) {
      this.rollbackToPreSkillSnapshot(pre);
      this.pendingEvents = [];
      const failure = results.find(r => r.failureReason)!;
      if (failure.failureReason!.includes('召唤')) {
        throw new SDKError(ErrorCode.NoCellForSummon, failure.failureReason!);
      } else {
        throw new SDKError(ErrorCode.NoCellForRevive, failure.failureReason!);
      }
    }

    this.skillManager.setCooldown(actor, skillId);

    const action: ActionResult = {
      skillId,
      actorId,
      targetIds: validatedTargets,
      results,
      timestamp: Date.now(),
    };

    this.replayManager.addAction(action);
    this.logAction('skill', actorId, validatedTargets, { skillId, results });

    this.flushPendingEvents();

    this.emit('skill_used', action);

    this.turnQueue.markActed(actorId);
    this.processEndOfTurn(actorId);
    this.cleanupDeadAndCheckEnd();
    if (!this.isOver) {
      this.advanceTurn();
    } else {
      this.takeSnapshot();
    }
    return action;
  }

  wait(unitId: string): void {
    this.assertBattleActive();
    this.assertCurrentUnit(unitId);
    this.turnQueue.wait(unitId);
    this.logAction('wait', unitId, [], {});
    this.emit('unit_wait', { unitId });
    this.processEndOfTurn(unitId);
    this.advanceTurn();
  }

  skip(unitId: string): void {
    this.assertBattleActive();
    this.assertCurrentUnit(unitId);
    this.turnQueue.skip(unitId);
    this.logAction('skip', unitId, [], {});
    this.emit('unit_skip', { unitId });
    this.processEndOfTurn(unitId);
    this.advanceTurn();
  }

  endTurn(): void {
    if (!this.currentUnitId) return;
    const uid = this.currentUnitId;
    this.turnQueue.markActed(uid);
    this.processEndOfTurn(uid);
    this.logAction('end_turn', uid, [], {});
    this.cleanupDeadAndCheckEnd();
    if (!this.isOver) {
      this.advanceTurn();
    } else {
      this.takeSnapshot();
    }
  }

  getMovementRange(unitId: string): Position[] {
    const unit = this.unitManager.getUnit(unitId);
    if (!unit.pos) return [];
    const moveRange = this.unitManager.getEffectiveStat(unitId, 'moveRange');
    return this.grid.getReachableCells(unit.pos, moveRange).map(c => c.pos);
  }

  getSkillTargets(unitId: string, skillId: string): string[] {
    const unit = this.unitManager.getUnit(unitId);
    const skill = this.skillManager.validateSkill(unit, skillId);
    const allUnits = this.unitManager.getAllUnits();
    return this.skillManager.getValidTargets(unit, skill, this.grid, allUnits);
  }

  getSkillTargetInfos(unitId: string, skillId: string): SkillTargetInfo[] {
    const unit = this.unitManager.getUnit(unitId);
    const skill = this.skillManager.validateSkill(unit, skillId);
    const allUnits = this.unitManager.getAllUnits();
    return this.skillManager.getSkillTargetInfos(unit, skill, this.grid, allUnits);
  }

  setWinCondition(condition: WinCondition): void {
    this.winCondition = condition;
  }

  setLoseCondition(condition: LoseCondition): void {
    this.loseCondition = condition;
  }

  checkWin(): boolean {
    if (this.winCondition) {
      return this.winCondition(this);
    }
    const teams = this.unitManager.getTeams();
    const aliveTeams = teams.filter(team => this.unitManager.getAliveByTeam(team).length > 0);
    return aliveTeams.length === 1;
  }

  checkLose(): boolean {
    if (this.loseCondition) {
      return this.loseCondition(this);
    }
    return false;
  }

  checkBattleEnd(): boolean {
    if (this.isOver) return true;
    const teams = this.unitManager.getTeams();
    const aliveTeams = teams.filter(team => this.unitManager.getAliveByTeam(team).length > 0);

    if (aliveTeams.length <= 1) {
      this.isOver = true;
      this.winner = aliveTeams.length === 1 ? aliveTeams[0] : null;
      this.emit('battle_end', { winner: this.winner });
      return true;
    }

    if (this.winCondition && this.winCondition(this)) {
      this.isOver = true;
      this.winner = this.findWinnerTeam();
      this.emit('battle_end', { winner: this.winner });
      return true;
    }

    if (this.loseCondition && this.loseCondition(this)) {
      this.isOver = true;
      this.winner = null;
      this.emit('battle_end', { winner: null });
      return true;
    }

    return false;
  }

  on(event: string, listener: EventListener): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event)!.push(listener);
  }

  off(event: string, listener: EventListener): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const idx = listeners.indexOf(listener);
      if (idx >= 0) listeners.splice(idx, 1);
    }
  }

  emit(event: string, data: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const l of listeners) {
        try { l(event, data); } catch (_) { /* swallow listener errors */ }
      }
    }
  }

  save(): ReplayData {
    this.takeSnapshot();
    return this.replayManager.serialize();
  }

  static restore(data: ReplayData): BattleRoom {
    if (!ReplayManager.validate(data)) {
      throw new SDKError(ErrorCode.ReplayCorrupted);
    }
    const room = new BattleRoom(data.config);
    const lastSnapshot = data.snapshots[data.snapshots.length - 1];
    if (lastSnapshot) {
      room.unitManager.restore(lastSnapshot.units);

      const grid = new GridMap(data.config.width, data.config.height, undefined, data.config.customTerrainConfig);
      for (let y = 0; y < data.config.height; y++) {
        for (let x = 0; x < data.config.width; x++) {
          if (lastSnapshot.grid[y]?.[x]) {
            grid.setTerrain({ x, y }, lastSnapshot.grid[y][x].terrain);
            if (lastSnapshot.grid[y][x].unitId) {
              try {
                grid.placeUnit({ x, y }, lastSnapshot.grid[y][x].unitId!);
              } catch (_) { /* skip occupied during restore */ }
            }
          }
        }
      }
      (room as any).grid = grid;

      if (lastSnapshot.queueData) {
        const qd = lastSnapshot.queueData;
        room.turnQueue.restore(
          qd.entries,
          qd.turnNumber,
          qd.subTurnNumber,
          qd.currentIndex
        );
      } else {
        const aliveUnits = room.unitManager.getAliveUnits();
        room.turnQueue.buildQueue(aliveUnits);
        room.turnQueue.rebuildWithSpeeds((uid) => room.unitManager.getEffectiveStat(uid, 'spd'));
      }

      if (lastSnapshot.rngState !== undefined) {
        room.rng.restoreState(lastSnapshot.rngState);
      }

      (room as any).started = true;
      (room as any).isOver = lastSnapshot.isOver ?? false;
      (room as any).winner = lastSnapshot.winner ?? null;
      (room as any).currentUnitId = lastSnapshot.currentUnitId ?? null;

      if (lastSnapshot.log) {
        for (const entry of lastSnapshot.log) {
          room.replayManager.addLogEntry(entry);
        }
      }
    }

    for (const action of data.actions) {
      room.replayManager.addAction(action);
    }

    return room;
  }

  registerCustomEffectHandler(
    name: string,
    handler: (effect: import('../types').SkillEffect, actor: Unit, target: Unit) => TargetResult | null
  ): void {
    this.effectResolver.registerCustomHandler(name, handler);
  }

  private resolveAndValidateTargets(actor: Unit, skill: SkillDefinition, requestedIds: string[]): string[] {
    const hasReviveEffect = skill.effects.some(e => e.type === SkillEffectType.Revive);
    const hasSummonEffect = skill.effects.some(e => e.type === SkillEffectType.Summon);

    switch (skill.targetPattern) {
      case SkillTargetType.Self: {
        for (const tid of requestedIds) {
          if (tid !== actor.id) {
            throw new SDKError(ErrorCode.TargetTeamMismatch, `自身技能只能以施法者 ${actor.id} 为目标，不能选 ${tid}`);
          }
        }
        return [actor.id];
      }

      case SkillTargetType.Enemy: {
        const valid: string[] = [];
        for (const tid of requestedIds) {
          const target = this.unitManager.getUnitSafe(tid);
          if (!target) {
            throw new SDKError(ErrorCode.UnitNotFound, `目标 ${tid} 不存在`);
          }
          if (target.team === actor.team) {
            throw new SDKError(ErrorCode.TargetTeamMismatch, `敌方技能不能选择友方单位 ${tid}`);
          }
          if (target.status === UnitStatus.Dead) {
            throw new SDKError(ErrorCode.UnitDead, tid);
          }
          if (target.pos && !this.skillManager.isInRange(actor.pos!, target.pos, skill, this.grid)) {
            throw new SDKError(ErrorCode.OutOfRange, `${actor.id} -> ${tid}`);
          }
          valid.push(tid);
        }
        return valid;
      }

      case SkillTargetType.Ally: {
        const valid: string[] = [];
        for (const tid of requestedIds) {
          const target = this.unitManager.getUnitSafe(tid);
          if (!target) {
            throw new SDKError(ErrorCode.UnitNotFound, `目标 ${tid} 不存在`);
          }
          if (target.team !== actor.team) {
            throw new SDKError(ErrorCode.TargetTeamMismatch, `友方技能不能选择敌方单位 ${tid}`);
          }
          if (target.id === actor.id) {
            throw new SDKError(ErrorCode.TargetTeamMismatch, `友方技能不能选择自身，请使用自身技能类型`);
          }
          if (hasReviveEffect) {
            if (target.status === UnitStatus.Alive) {
              throw new SDKError(ErrorCode.TargetTeamMismatch, `复活技能只能选择已阵亡的友方单位，${tid} 还活着`);
            }
            if (target.status === UnitStatus.Stunned || target.status === UnitStatus.Frozen) {
              throw new SDKError(ErrorCode.TargetTeamMismatch, `复活技能只能选择已阵亡的友方单位`);
            }
            if (target.status === UnitStatus.Dead) {
              const cellInfo = this.skillManager.checkCellAvailability(actor.pos!, skill.range, this.grid);
              if (!cellInfo.cellInRange) {
                if (!cellInfo.cellAnywhere) {
                  throw new SDKError(ErrorCode.NoCellForRevive, '地图上没有可用格子，无法复活');
                } else {
                  throw new SDKError(ErrorCode.OutOfRange, `复活范围(${skill.range})内没有可用格子，无法复活 ${tid}`);
                }
              }
            }
          } else {
            if (target.status === UnitStatus.Dead) {
              throw new SDKError(ErrorCode.UnitDead, tid);
            }
            if (target.pos && !this.skillManager.isInRange(actor.pos!, target.pos, skill, this.grid)) {
              throw new SDKError(ErrorCode.OutOfRange, `${actor.id} -> ${tid}`);
            }
          }
          valid.push(tid);
        }
        return valid;
      }

      case SkillTargetType.AllEnemy: {
        if (requestedIds.length === 0) {
          return this.unitManager.getAliveUnits()
            .filter(u => u.team !== actor.team && u.pos && this.skillManager.isInRange(actor.pos!, u.pos, skill, this.grid))
            .map(u => u.id);
        }
        for (const tid of requestedIds) {
          const target = this.unitManager.getUnitSafe(tid);
          if (!target) {
            throw new SDKError(ErrorCode.UnitNotFound, `目标 ${tid} 不存在`);
          }
          if (target.team === actor.team) {
            throw new SDKError(ErrorCode.TargetTeamMismatch, `全体敌方技能不能包含友方单位 ${tid}`);
          }
          if (target.status === UnitStatus.Dead) {
            throw new SDKError(ErrorCode.UnitDead, `全体敌方技能不能包含阵亡单位 ${tid}`);
          }
        }
        return this.unitManager.getAliveUnits()
          .filter(u => u.team !== actor.team && u.pos && this.skillManager.isInRange(actor.pos!, u.pos, skill, this.grid))
          .map(u => u.id);
      }

      case SkillTargetType.AllAlly: {
        if (requestedIds.length === 0) {
          return this.unitManager.getAliveUnits()
            .filter(u => u.team === actor.team && u.pos && this.skillManager.isInRange(actor.pos!, u.pos, skill, this.grid))
            .map(u => u.id);
        }
        for (const tid of requestedIds) {
          const target = this.unitManager.getUnitSafe(tid);
          if (!target) {
            throw new SDKError(ErrorCode.UnitNotFound, `目标 ${tid} 不存在`);
          }
          if (target.team !== actor.team) {
            throw new SDKError(ErrorCode.TargetTeamMismatch, `全体友方技能不能包含敌方单位 ${tid}`);
          }
          if (target.status === UnitStatus.Dead) {
            throw new SDKError(ErrorCode.UnitDead, `全体友方技能不能包含阵亡单位 ${tid}`);
          }
        }
        return this.unitManager.getAliveUnits()
          .filter(u => u.team === actor.team && u.pos && this.skillManager.isInRange(actor.pos!, u.pos, skill, this.grid))
          .map(u => u.id);
      }

      case SkillTargetType.All: {
        if (requestedIds.length === 0) {
          return this.unitManager.getAliveUnits()
            .filter(u => u.pos && this.skillManager.isInRange(actor.pos!, u.pos, skill, this.grid))
            .map(u => u.id);
        }
        for (const tid of requestedIds) {
          const target = this.unitManager.getUnitSafe(tid);
          if (!target) {
            throw new SDKError(ErrorCode.UnitNotFound, `目标 ${tid} 不存在`);
          }
          if (target.status === UnitStatus.Dead) {
            throw new SDKError(ErrorCode.UnitDead, `全体技能不能包含阵亡单位 ${tid}`);
          }
        }
        return this.unitManager.getAliveUnits()
          .filter(u => u.pos && this.skillManager.isInRange(actor.pos!, u.pos, skill, this.grid))
          .map(u => u.id);
      }

      case SkillTargetType.Cell: {
        const valid: string[] = [];
        for (const tid of requestedIds) {
          const target = this.unitManager.getUnitSafe(tid);
          if (!target) {
            throw new SDKError(ErrorCode.UnitNotFound, `目标 ${tid} 不存在`);
          }
          if (target.status === UnitStatus.Dead && !hasReviveEffect) {
            throw new SDKError(ErrorCode.UnitDead, tid);
          }
          if (target.pos && !this.skillManager.isInRange(actor.pos!, target.pos, skill, this.grid)) {
            throw new SDKError(ErrorCode.OutOfRange, `${actor.id} -> ${tid}`);
          }
          valid.push(tid);
        }
        if (skill.aoeRadius && skill.aoeRadius > 0 && valid.length > 0) {
          const primary = this.unitManager.getUnit(valid[0]);
          if (primary.pos) {
            const aoeIds = this.skillManager.resolveAoETargets(primary.pos, skill, this.grid, this.unitManager.getAliveUnits());
            for (const aid of aoeIds) {
              if (!valid.includes(aid)) valid.push(aid);
            }
          }
        }
        return valid;
      }

      default:
        return requestedIds;
    }
  }

  private capturePreSkillSnapshot(actor: Unit): PreSkillSnapshot {
    return {
      units: this.unitManager.serialize(),
      grid: this.grid.serialize(),
      cooldowns: { ...actor.cooldowns },
      rngState: this.rng.getState(),
      queueData: this.turnQueue.serialize(),
      logLength: this.replayManager.getLog().length,
      actionsLength: this.replayManager.getActions().length,
    };
  }

  private rollbackToPreSkillSnapshot(pre: PreSkillSnapshot): void {
    this.unitManager.restore(pre.units);
    for (let y = 0; y < this.grid.getHeight(); y++) {
      for (let x = 0; x < this.grid.getWidth(); x++) {
        const snapCell = pre.grid[y]?.[x];
        if (snapCell) {
          const currentCell = this.grid.getCell({ x, y });
          currentCell.terrain = snapCell.terrain;
          currentCell.unitId = snapCell.unitId;
        }
      }
    }
    const actor = this.unitManager.getUnitSafe(this.currentUnitId!);
    if (actor) {
      actor.cooldowns = { ...pre.cooldowns };
    }
    this.rng.restoreState(pre.rngState);
    this.turnQueue.restore(pre.queueData.entries, pre.queueData.turnNumber, pre.queueData.subTurnNumber, pre.queueData.currentIndex);
    const currentLog = this.replayManager.getLog();
    const excessLog = currentLog.length - pre.logLength;
    if (excessLog > 0) {
      (this.replayManager as any).log = currentLog.slice(0, pre.logLength);
    }
    const currentActions = this.replayManager.getActions();
    const excessActions = currentActions.length - pre.actionsLength;
    if (excessActions > 0) {
      (this.replayManager as any).actions = currentActions.slice(0, pre.actionsLength);
    }
  }

  private flushPendingEvents(): void {
    for (const pe of this.pendingEvents) {
      this.emit(pe.event, pe.data);
    }
    this.pendingEvents = [];
  }

  private assertBattleActive(): void {
    if (!this.started) throw new SDKError(ErrorCode.BattleNotStarted);
    if (this.isOver) throw new SDKError(ErrorCode.BattleOver);
  }

  private assertCurrentUnit(unitId: string): void {
    if (this.currentUnitId !== unitId) {
      throw new SDKError(ErrorCode.NotUnitTurn, `当前回合: ${this.currentUnitId}, 请求: ${unitId}`);
    }
  }

  private processStartOfTurn(unitId: string): void {
    if (!this.unitManager.isAlive(unitId)) return;
    this.effectResolver.processStartOfTurn(unitId);

    if (this.unitManager.getUnitSafe(unitId)?.status === UnitStatus.Dead) {
      this.logAction('dot_death', unitId, [], {});
      this.cleanupDeadAndCheckEnd();
      this.takeSnapshot();
      return;
    }

    const unit = this.unitManager.getUnitSafe(unitId);
    if (unit && unit.pos) {
      const terrainCfg = this.grid.getTerrainEffects(unit.pos);
      if (terrainCfg.damagePerTurn && terrainCfg.damagePerTurn > 0) {
        this.unitManager.takeDamage(unitId, terrainCfg.damagePerTurn);
        this.logAction('terrain_damage', unitId, [], { damage: terrainCfg.damagePerTurn, terrain: this.grid.getCell(unit.pos).terrain });
      }
      if (this.unitManager.getUnitSafe(unitId)?.status === UnitStatus.Dead) {
        this.logAction('terrain_death', unitId, [], {});
        this.cleanupDeadAndCheckEnd();
        this.takeSnapshot();
        return;
      }
      if (terrainCfg.healPerTurn && terrainCfg.healPerTurn > 0) {
        this.unitManager.heal(unitId, terrainCfg.healPerTurn);
        this.logAction('terrain_heal', unitId, [], { healed: terrainCfg.healPerTurn, terrain: this.grid.getCell(unit.pos).terrain });
      }
    }
    this.emit('turn_start', { unitId, turn: this.turnQueue.getTurnNumber() });
  }

  private processEndOfTurn(unitId: string): void {
    this.effectResolver.processEndOfTurn(unitId);
    this.emit('turn_end', { unitId, turn: this.turnQueue.getTurnNumber() });
  }

  private cleanupDeadAndCheckEnd(): void {
    const deadIds = this.unitManager.getAllUnits()
      .filter(u => u.status === UnitStatus.Dead)
      .map(u => u.id);
    for (const did of deadIds) {
      const unit = this.unitManager.getUnitSafe(did);
      if (unit?.pos) {
        this.grid.removeUnit(unit.pos);
        this.unitManager.setUnitPosition(did, null);
        this.logAction('death', did, [], {});
        this.emit('unit_died', { unitId: did });
      }
      this.turnQueue.removeUnit(did);
    }
    this.checkBattleEnd();
  }

  private advanceTurn(): void {
    if (this.isOver) return;
    if (this.turnQueue.isRoundOver()) {
      this.turnQueue.processWaiting();
      this.takeSnapshot();
      this.emit('round_end', { turn: this.turnQueue.getTurnNumber() });
    }
    this.turnQueue.rebuildWithSpeeds((uid) => this.unitManager.getEffectiveStat(uid, 'spd'));
    const entry = this.turnQueue.next();
    if (entry) {
      this.currentUnitId = entry.unitId;
      this.processStartOfTurn(entry.unitId);
    } else {
      this.checkBattleEnd();
    }
    this.takeSnapshot();
  }

  private onUnitSummoned(unit: Unit): void {
    if (!unit.pos) return;
    this.turnQueue.addUnit(unit.id, this.unitManager.getEffectiveStat(unit.id, 'spd'), 'speed');
    this.logAction('summon', unit.summonerId ?? '', [unit.id], { summonId: unit.id });
    this.pendingEvents.push({ event: 'unit_summoned', data: { unitId: unit.id, team: unit.team, pos: unit.pos, summonerId: unit.summonerId } });
  }

  private onUnitRevived(unit: Unit): void {
    if (!unit.pos) return;
    this.turnQueue.addUnit(unit.id, this.unitManager.getEffectiveStat(unit.id, 'spd'), 'speed');
    this.logAction('revive', unit.id, [], { pos: unit.pos });
    this.pendingEvents.push({ event: 'unit_revived', data: { unitId: unit.id, team: unit.team, pos: unit.pos } });
  }

  private findWinnerTeam(): string | null {
    const teams = this.unitManager.getTeams();
    const aliveTeams = teams.filter(team => this.unitManager.getAliveByTeam(team).length > 0);
    return aliveTeams.length === 1 ? aliveTeams[0] : null;
  }

  private logAction(action: string, actorId: string, targetIds: string[], data: Record<string, unknown>): void {
    this.replayManager.addLogEntry({
      turn: this.turnQueue.getTurnNumber(),
      subTurn: this.turnQueue.getSubTurnNumber(),
      action,
      actorId,
      targetIds,
      data,
      timestamp: Date.now(),
    });
  }

  private takeSnapshot(): void {
    this.replayManager.takeSnapshot(
      this.unitManager.getAllUnits(),
      this.grid.serialize(),
      this.currentUnitId,
      this.isOver,
      this.winner,
      this.turnQueue.serialize(),
      this.rng.getState()
    );
  }
}
