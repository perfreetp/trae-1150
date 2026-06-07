import {
  BattleConfig,
  BattleState,
  Unit,
  UnitBaseStats,
  UnitStatus,
  SkillDefinition,
  Position,
  ActionResult,
  TargetResult,
  EventListener,
  WinCondition,
  LoseCondition,
  Buff,
  Debuff,
  DoTEffect,
  ReplayData,
  SkillTargetType,
  DebuffType,
} from '../types';
import { SeededRNG } from '../utils/rng';
import { SDKError, ErrorCode } from '../utils/errors';
import { GridMap } from './grid-map';
import { UnitManager } from './unit';
import { TurnQueue } from './turn-queue';
import { SkillManager } from './skill';
import { EffectResolver } from './effect';
import { ReplayManager } from './replay';

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

  constructor(config: BattleConfig) {
    this.config = { ...config };
    this.rng = new SeededRNG(config.seed);
    this.grid = new GridMap(config.width, config.height, config.terrainMap, config.customTerrainConfig);
    this.unitManager = new UnitManager();
    this.turnQueue = new TurnQueue();
    this.skillManager = new SkillManager();
    this.effectResolver = new EffectResolver(this.rng, this.unitManager, this.grid, (unit) => {
      this.onUnitSummoned(unit);
    });
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
    this.replayManager.takeSnapshot(this.unitManager.getAllUnits(), this.grid.serialize());
    const entry = this.turnQueue.next();
    if (entry) {
      this.currentUnitId = entry.unitId;
      this.processStartOfTurn(entry.unitId);
    }
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

    const allTargets: string[] = [];
    for (const tid of targetIds) {
      const target = this.unitManager.getUnit(tid);
      if (target.status === UnitStatus.Dead && !skill.effects.some(e => e.type === 'revive')) {
        throw new SDKError(ErrorCode.UnitDead, tid);
      }
      if (target.pos && !this.skillManager.isInRange(actor.pos, target.pos, skill, this.grid)) {
        throw new SDKError(ErrorCode.OutOfRange, `${actorId} -> ${tid}`);
      }
      allTargets.push(tid);
    }

    if (skill.aoeRadius && skill.aoeRadius > 0 && allTargets.length > 0) {
      const primaryTarget = this.unitManager.getUnit(allTargets[0]);
      if (primaryTarget.pos) {
        const aoeIds = this.skillManager.resolveAoETargets(primaryTarget.pos, skill, this.grid, this.unitManager.getAliveUnits());
        for (const aid of aoeIds) {
          if (!allTargets.includes(aid)) {
            allTargets.push(aid);
          }
        }
      }
    }

    const results: TargetResult[] = [];
    for (const tid of allTargets) {
      const target = this.unitManager.getUnitSafe(tid);
      if (!target) continue;
      for (const effect of skill.effects) {
        const result = this.effectResolver.resolveEffect(actor, target, effect);
        results.push(result);
      }
    }

    this.skillManager.setCooldown(actor, skillId);

    const action: ActionResult = {
      skillId,
      actorId,
      targetIds: allTargets,
      results,
      timestamp: Date.now(),
    };

    this.replayManager.addAction(action);
    this.logAction('skill', actorId, allTargets, { skillId, results });
    this.emit('skill_used', action);

    this.turnQueue.markActed(actorId);
    this.processEndOfTurn(actorId);
    this.checkBattleEnd();
    if (!this.isOver) {
      this.advanceTurn();
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
    this.checkBattleEnd();
    if (!this.isOver) {
      this.advanceTurn();
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
    return this.skillManager.getValidTargets(unit, skill, this.grid, this.unitManager.getAliveUnits());
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
      this.replayManager.takeSnapshot(this.unitManager.getAllUnits(), this.grid.serialize());
      return true;
    }

    if (this.winCondition && this.winCondition(this)) {
      this.isOver = true;
      this.winner = this.findWinnerTeam();
      this.emit('battle_end', { winner: this.winner });
      this.replayManager.takeSnapshot(this.unitManager.getAllUnits(), this.grid.serialize());
      return true;
    }

    if (this.loseCondition && this.loseCondition(this)) {
      this.isOver = true;
      this.winner = null;
      this.emit('battle_end', { winner: null });
      this.replayManager.takeSnapshot(this.unitManager.getAllUnits(), this.grid.serialize());
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
              grid.placeUnit({ x, y }, lastSnapshot.grid[y][x].unitId!);
            }
          }
        }
      }
      (room as any).grid = grid;
      (room as any).started = true;
      (room as any).turnNumber = lastSnapshot.turn;
      (room as any).subTurnNumber = lastSnapshot.subTurn;
    }
    return room;
  }

  registerCustomEffectHandler(
    name: string,
    handler: (effect: import('../types').SkillEffect, actor: Unit, target: Unit) => TargetResult | null
  ): void {
    this.effectResolver.registerCustomHandler(name, handler);
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
    const unit = this.unitManager.getUnitSafe(unitId);
    if (unit && unit.pos) {
      const terrainCfg = this.grid.getTerrainEffects(unit.pos);
      if (terrainCfg.damagePerTurn && terrainCfg.damagePerTurn > 0) {
        this.unitManager.takeDamage(unitId, terrainCfg.damagePerTurn);
        this.logAction('terrain_damage', unitId, [], { damage: terrainCfg.damagePerTurn, terrain: this.grid.getCell(unit.pos).terrain });
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

  private advanceTurn(): void {
    if (this.isOver) return;
    if (this.turnQueue.isRoundOver()) {
      this.turnQueue.processWaiting();
      this.replayManager.takeSnapshot(this.unitManager.getAllUnits(), this.grid.serialize());
      this.emit('round_end', { turn: this.turnQueue.getTurnNumber() });
    }
    const deadIds = this.unitManager.getAllUnits()
      .filter(u => u.status === UnitStatus.Dead)
      .map(u => u.id);
    for (const did of deadIds) {
      const unit = this.unitManager.getUnitSafe(did);
      if (unit?.pos) {
        this.grid.removeUnit(unit.pos);
        this.unitManager.setUnitPosition(did, null);
      }
      this.turnQueue.removeUnit(did);
    }
    this.turnQueue.rebuildWithSpeeds((uid) => this.unitManager.getEffectiveStat(uid, 'spd'));
    const entry = this.turnQueue.next();
    if (entry) {
      this.currentUnitId = entry.unitId;
      this.processStartOfTurn(entry.unitId);
    } else {
      this.checkBattleEnd();
    }
  }

  private onUnitSummoned(unit: Unit): void {
    if (!unit.pos) return;
    this.turnQueue.addUnit(unit.id, unit.stats.spd, 'speed');
    this.emit('unit_summoned', { unitId: unit.id, team: unit.team, pos: unit.pos, summonerId: unit.summonerId });
    this.logAction('summon', unit.summonerId ?? '', [unit.id], { summonId: unit.id });
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
}
