import {
  SkillDefinition,
  SkillTargetType,
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
    const actorPos = actor.pos;
    if (!actorPos) return [];

    const targetIds: string[] = [];

    for (const unit of allUnits) {
      if (unit.status === UnitStatus.Dead) continue;
      if (!unit.pos) continue;
      if (unit.id === actor.id && skill.targetPattern !== SkillTargetType.Self && skill.targetPattern !== SkillTargetType.All && skill.targetPattern !== SkillTargetType.AllAlly) continue;

      const dist = grid.distance(actorPos, unit.pos);
      if (dist > skill.range) continue;

      switch (skill.targetPattern) {
        case SkillTargetType.Enemy:
          if (unit.team !== actor.team) targetIds.push(unit.id);
          break;
        case SkillTargetType.Ally:
          if (unit.team === actor.team && unit.id !== actor.id) targetIds.push(unit.id);
          break;
        case SkillTargetType.Self:
          if (unit.id === actor.id) targetIds.push(unit.id);
          break;
        case SkillTargetType.AllEnemy:
          if (unit.team !== actor.team) targetIds.push(unit.id);
          break;
        case SkillTargetType.AllAlly:
          if (unit.team === actor.team) targetIds.push(unit.id);
          break;
        case SkillTargetType.All:
          targetIds.push(unit.id);
          break;
        case SkillTargetType.Cell:
          targetIds.push(unit.id);
          break;
      }
    }

    return targetIds;
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
}
