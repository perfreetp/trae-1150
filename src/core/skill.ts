import {
  SkillDefinition,
  SkillTargetType,
  SkillEffectType,
  SkillTargetInfo,
  Unit,
  UnitStatus,
  Position,
} from '../types';
import { SDKError, ErrorCode } from '../utils/errors';
import { GridMap } from './grid-map';

export class SkillManager {
  validateSkill(unit: Unit, skillId: string): SkillDefinition {
    const skill = unit.skills.find(s => s.id === skillId);
    if (!skill) throw new SDKError(ErrorCode.SkillNotFound, `${unit.id} -> ${skillId}`);
    if ((unit.cooldowns[skillId] ?? 0) > 0) {
      throw new SDKError(ErrorCode.SkillOnCooldown, `${skillId} 剩余 ${unit.cooldowns[skillId]} 回合`);
    }
    return skill;
  }

  getValidTargets(
    actor: Unit,
    skill: SkillDefinition,
    grid: GridMap,
    allUnits: Unit[]
  ): string[] {
    return this.getSkillTargetInfos(actor, skill, grid, allUnits)
      .filter(info => info.selectable)
      .map(info => info.unitId);
  }

  getSkillTargetInfos(
    actor: Unit,
    skill: SkillDefinition,
    grid: GridMap,
    allUnits: Unit[]
  ): SkillTargetInfo[] {
    const actorPos = actor.pos;
    if (!actorPos) return [];

    const hasReviveEffect = skill.effects.some(e => e.type === SkillEffectType.Revive);
    const results: SkillTargetInfo[] = [];

    for (const unit of allUnits) {
      if (unit.id === actor.id && skill.targetPattern !== SkillTargetType.Self && skill.targetPattern !== SkillTargetType.All && skill.targetPattern !== SkillTargetType.AllAlly) continue;

      switch (skill.targetPattern) {
        case SkillTargetType.Enemy: {
          if (unit.team === actor.team) continue;
          if (unit.status === UnitStatus.Dead) continue;
          if (!unit.pos) continue;
          const inRange = grid.distance(actorPos, unit.pos) <= skill.range;
          results.push({ unitId: unit.id, selectable: inRange, outOfRange: !inRange });
          break;
        }
        case SkillTargetType.Ally: {
          if (unit.team !== actor.team) continue;
          if (unit.id === actor.id) continue;

          if (hasReviveEffect) {
            if (unit.status !== UnitStatus.Dead) continue;
            const inRange = skill.range >= 0;
            const hasCell = this.hasEmptyCellNearby(actorPos, grid);
            results.push({
              unitId: unit.id,
              selectable: inRange && hasCell,
              outOfRange: !inRange,
              noCellAvailable: !hasCell,
            });
          } else {
            if (unit.status === UnitStatus.Dead) continue;
            if (!unit.pos) continue;
            const inRange = grid.distance(actorPos, unit.pos) <= skill.range;
            results.push({ unitId: unit.id, selectable: inRange, outOfRange: !inRange });
          }
          break;
        }
        case SkillTargetType.Self: {
          if (unit.id === actor.id) {
            results.push({ unitId: unit.id, selectable: true });
          }
          break;
        }
        case SkillTargetType.AllEnemy: {
          if (unit.team === actor.team) continue;
          if (unit.status === UnitStatus.Dead) continue;
          if (!unit.pos) continue;
          if (grid.distance(actorPos, unit.pos) <= skill.range) {
            results.push({ unitId: unit.id, selectable: true });
          }
          break;
        }
        case SkillTargetType.AllAlly: {
          if (unit.team !== actor.team) continue;
          if (unit.status === UnitStatus.Dead) continue;
          if (!unit.pos) continue;
          if (grid.distance(actorPos, unit.pos) <= skill.range) {
            results.push({ unitId: unit.id, selectable: true });
          }
          break;
        }
        case SkillTargetType.All: {
          if (unit.status === UnitStatus.Dead) continue;
          if (!unit.pos) continue;
          if (grid.distance(actorPos, unit.pos) <= skill.range) {
            results.push({ unitId: unit.id, selectable: true });
          }
          break;
        }
        case SkillTargetType.Cell: {
          if (unit.status === UnitStatus.Dead && !hasReviveEffect) continue;
          if (!unit.pos && unit.status !== UnitStatus.Dead) continue;
          const effectivePos = unit.pos ?? actorPos;
          if (grid.distance(actorPos, effectivePos) <= skill.range) {
            results.push({ unitId: unit.id, selectable: true });
          }
          break;
        }
      }
    }

    return results;
  }

  resolveAoETargets(
    center: Position,
    skill: SkillDefinition,
    grid: GridMap,
    allUnits: Unit[]
  ): string[] {
    const radius = skill.aoeRadius ?? 0;
    if (radius === 0) return [];
    const cells = grid.getCellsInRange(center, radius);
    const cellSet = new Set(cells.map(c => `${c.x},${c.y}`));
    return allUnits
      .filter(u => u.pos && u.status !== UnitStatus.Dead && cellSet.has(`${u.pos.x},${u.pos.y}`))
      .map(u => u.id);
  }

  isInRange(actorPos: Position, targetPos: Position, skill: SkillDefinition, grid: GridMap): boolean {
    return grid.distance(actorPos, targetPos) <= skill.range;
  }

  setCooldown(unit: Unit, skillId: string): void {
    const skill = unit.skills.find(s => s.id === skillId);
    if (skill && skill.cooldown > 0) {
      unit.cooldowns[skillId] = skill.cooldown;
    }
  }

  tickCooldowns(unit: Unit): void {
    for (const skillId of Object.keys(unit.cooldowns)) {
      unit.cooldowns[skillId]--;
      if (unit.cooldowns[skillId] <= 0) {
        delete unit.cooldowns[skillId];
      }
    }
  }

  private hasEmptyCellNearby(center: Position, grid: GridMap): boolean {
    const dirs = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    for (const d of dirs) {
      const nx = center.x + d.x;
      const ny = center.y + d.y;
      if (nx < 0 || nx >= grid.getWidth() || ny < 0 || ny >= grid.getHeight()) continue;
      const cell = grid.getCell({ x: nx, y: ny });
      if (cell.unitId === null) {
        const cfg = grid.getTerrainEffects({ x: nx, y: ny });
        if (cfg.passable) return true;
      }
    }
    const width = grid.getWidth();
    const height = grid.getHeight();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid.getCell({ x, y });
        if (cell.unitId === null) {
          const cfg = grid.getTerrainEffects({ x, y });
          if (cfg.passable) return true;
        }
      }
    }
    return false;
  }
}
