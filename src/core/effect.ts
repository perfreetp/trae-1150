import {
  SkillEffect,
  SkillEffectType,
  TargetResult,
  Unit,
  UnitStatus,
  Position,
  DebuffType,
} from '../types';
import { SeededRNG } from '../utils/rng';
import { UnitManager } from './unit';
import { GridMap } from './grid-map';

export class EffectResolver {
  private rng: SeededRNG;
  private unitManager: UnitManager;
  private grid: GridMap;
  private onSummon?: (unit: Unit) => void;
  private onRevive?: (unit: Unit) => void;
  private customHandlers: Map<string, (effect: SkillEffect, actor: Unit, target: Unit) => TargetResult | null>;

  constructor(
    rng: SeededRNG,
    unitManager: UnitManager,
    grid: GridMap,
    onSummon?: (unit: Unit) => void,
    onRevive?: (unit: Unit) => void
  ) {
    this.rng = rng;
    this.unitManager = unitManager;
    this.grid = grid;
    this.onSummon = onSummon;
    this.onRevive = onRevive;
    this.customHandlers = new Map();
  }

  registerCustomHandler(name: string, handler: (effect: SkillEffect, actor: Unit, target: Unit) => TargetResult | null): void {
    this.customHandlers.set(name, handler);
  }

  resolveHitAndCrit(actor: Unit, target: Unit): { hit: boolean; critical: boolean } {
    const attackerHit = this.unitManager.getEffectiveStat(actor.id, 'hit');
    const defenderAvoid = this.unitManager.getEffectiveStat(target.id, 'avoid');
    const targetPos = target.pos;
    let terrainAvoidBonus = 0;
    if (targetPos) {
      const terrainCfg = this.grid.getTerrainEffects(targetPos);
      terrainAvoidBonus = terrainCfg.avoidBonus;
    }
    const hitChance = (attackerHit - defenderAvoid - terrainAvoidBonus) / 100;
    const hit = this.rng.nextBool(Math.max(0.05, Math.min(0.95, hitChance)));

    let critical = false;
    if (hit) {
      const critRate = this.unitManager.getEffectiveStat(actor.id, 'critRate') / 100;
      critical = this.rng.nextBool(Math.max(0, Math.min(1, critRate)));
    }

    return { hit, critical };
  }

  resolveDamage(actor: Unit, target: Unit, baseDamage: number, isCrit: boolean): number {
    const atk = this.unitManager.getEffectiveStat(actor.id, 'atk');
    const def = this.unitManager.getEffectiveStat(target.id, 'def');
    let targetPos = target.pos;
    let terrainDefBonus = 0;
    if (targetPos) {
      const terrainCfg = this.grid.getTerrainEffects(targetPos);
      terrainDefBonus = terrainCfg.defenseBonus;
    }
    let damage = Math.max(1, baseDamage + atk - def - terrainDefBonus);
    if (isCrit) {
      const critMult = this.unitManager.getEffectiveStat(actor.id, 'critMultiplier') / 100;
      damage = Math.floor(damage * critMult);
    }
    return damage;
  }

  resolveEffect(actor: Unit, target: Unit, effect: SkillEffect, options?: { skillRange?: number }): TargetResult {
    const result: TargetResult = {
      targetId: target.id,
      hit: true,
      critical: false,
      damage: 0,
      shieldAbsorbed: 0,
      healed: 0,
      buffsApplied: [],
      debuffsApplied: [],
      dotsApplied: [],
      revived: false,
      dispelled: false,
      summoned: false,
    };

    switch (effect.type) {
      case SkillEffectType.Damage: {
        const { hit, critical } = this.resolveHitAndCrit(actor, target);
        result.hit = hit;
        result.critical = critical;
        if (hit) {
          const baseDmg = effect.value ?? 0;
          const dmg = this.resolveDamage(actor, target, baseDmg, critical);
          const { hpLost, shieldAbsorbed } = this.unitManager.takeDamage(target.id, dmg);
          result.damage = hpLost;
          result.shieldAbsorbed = shieldAbsorbed;
        }
        break;
      }

      case SkillEffectType.Heal: {
        if (target.status !== UnitStatus.Dead) {
          const amount = effect.value ?? 0;
          const healed = this.unitManager.heal(target.id, amount);
          result.healed = healed;
        }
        break;
      }

      case SkillEffectType.Buff: {
        if (effect.buff && target.status !== UnitStatus.Dead) {
          this.unitManager.addBuff(target.id, { ...effect.buff, sourceUnitId: actor.id });
          result.buffsApplied.push({ ...effect.buff, sourceUnitId: actor.id });
        }
        break;
      }

      case SkillEffectType.Debuff: {
        if (effect.debuff && target.status !== UnitStatus.Dead) {
          this.unitManager.addDebuff(target.id, { ...effect.debuff, sourceUnitId: actor.id });
          result.debuffsApplied.push({ ...effect.debuff, sourceUnitId: actor.id });
          if (effect.debuff.type === DebuffType.Stun) {
            const t = this.unitManager.getUnit(target.id);
            t.status = UnitStatus.Stunned;
          }
          if (effect.debuff.type === DebuffType.Freeze) {
            const t = this.unitManager.getUnit(target.id);
            t.status = UnitStatus.Frozen;
          }
        }
        break;
      }

      case SkillEffectType.DoT: {
        if (effect.dot && target.status !== UnitStatus.Dead) {
          this.unitManager.addDoT(target.id, { ...effect.dot, sourceUnitId: actor.id });
          result.dotsApplied.push({ ...effect.dot, sourceUnitId: actor.id });
        }
        break;
      }

      case SkillEffectType.Shield: {
        if (target.status !== UnitStatus.Dead) {
          this.unitManager.addShield(target.id, effect.value ?? 0);
        }
        break;
      }

      case SkillEffectType.Summon: {
        if (effect.summonTemplate) {
          const spawnPos = actor.pos ? this.findNearestEmptyCell(actor.pos, options?.skillRange) : null;
          if (!spawnPos) {
            result.summoned = false;
            result.failureReason = '附近无可用格子，无法召唤';
            break;
          }
          const summonId = `summon_${actor.id}_${this.rng.nextInt(0, 99999)}`;
          const template = effect.summonTemplate;
          const summon = this.unitManager.createUnit(
            summonId,
            template.name ?? '召唤物',
            actor.team,
            template.stats ?? {
              maxHp: 50, hp: 50, atk: 10, def: 5, spd: 5,
              hit: 80, avoid: 10, critRate: 5, critMultiplier: 150, moveRange: 3,
            },
            template.skills ?? [],
            { isSummon: true, summonerId: actor.id, tags: template.tags ?? [] }
          );
          summon.pos = spawnPos;
          this.grid.placeUnit(spawnPos, summonId);
          if (this.onSummon) this.onSummon(summon);
          result.summoned = true;
          result.summonId = summonId;
        }
        break;
      }

      case SkillEffectType.Revive: {
        if (target.status === UnitStatus.Dead) {
          const spawnPos = actor.pos ? this.findNearestEmptyCell(actor.pos, options?.skillRange) : null;
          if (!spawnPos) {
            result.revived = false;
            result.failureReason = '附近无可用格子，无法复活';
            break;
          }
          this.unitManager.revive(target.id, (effect.reviveHpPercent ?? 50) / 100);
          this.unitManager.setUnitPosition(target.id, spawnPos);
          this.grid.placeUnit(spawnPos, target.id);
          if (this.onRevive) this.onRevive(this.unitManager.getUnit(target.id));
          result.revived = true;
        }
        break;
      }

      case SkillEffectType.Dispel: {
        if (target.status !== UnitStatus.Dead) {
          const t = this.unitManager.getUnit(target.id);
          if (effect.dispelBuffs) {
            t.buffs = [];
          }
          if (effect.dispelDebuffs) {
            t.debuffs = [];
          }
          result.dispelled = true;
        }
        break;
      }

      case SkillEffectType.Custom: {
        if (effect.customHandler) {
          const handler = this.customHandlers.get(effect.customHandler);
          if (handler) {
            const customResult = handler(effect, actor, target);
            if (customResult) {
              Object.assign(result, customResult);
            }
          }
        }
        break;
      }
    }

    return result;
  }

  resolveTerrainDamage(units: Unit[]): Array<{ unitId: string; damage: number }> {
    const results: Array<{ unitId: string; damage: number }> = [];
    for (const unit of units) {
      if (unit.status === UnitStatus.Dead || !unit.pos) continue;
      const cfg = this.grid.getTerrainEffects(unit.pos);
      if (cfg.damagePerTurn && cfg.damagePerTurn > 0) {
        const { hpLost } = this.unitManager.takeDamage(unit.id, cfg.damagePerTurn);
        if (hpLost > 0) {
          results.push({ unitId: unit.id, damage: hpLost });
        }
      }
    }
    return results;
  }

  resolveTerrainHeal(units: Unit[]): Array<{ unitId: string; healed: number }> {
    const results: Array<{ unitId: string; healed: number }> = [];
    for (const unit of units) {
      if (unit.status === UnitStatus.Dead || !unit.pos) continue;
      const cfg = this.grid.getTerrainEffects(unit.pos);
      if (cfg.healPerTurn && cfg.healPerTurn > 0) {
        const healed = this.unitManager.heal(unit.id, cfg.healPerTurn);
        if (healed > 0) {
          results.push({ unitId: unit.id, healed });
        }
      }
    }
    return results;
  }

  processStartOfTurn(unitId: string): Array<{ dotDamage: number }> {
    const results: Array<{ dotDamage: number }> = [];
    const unit = this.unitManager.getUnitSafe(unitId);
    if (!unit || unit.status === UnitStatus.Dead) return results;
    const dotDmg = this.unitManager.tickDoTs(unitId);
    results.push({ dotDamage: dotDmg });
    return results;
  }

  processEndOfTurn(unitId: string): void {
    const unit = this.unitManager.getUnitSafe(unitId);
    if (!unit) return;
    this.unitManager.tickBuffsAndDebuffs(unitId);
    this.unitManager.tickCooldowns(unitId);
  }

  findNearestEmptyCell(center: Position, maxRange?: number): Position | null {
    const visited = new Set<string>();
    const key = (p: Position) => `${p.x},${p.y}`;
    visited.add(key(center));
    const queue: Array<{ pos: Position; dist: number }> = [{ pos: center, dist: 0 }];
    const dirs = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const d of dirs) {
        const nx = current.pos.x + d.x;
        const ny = current.pos.y + d.y;
        const nextDist = current.dist + 1;
        if (nx < 0 || nx >= this.grid.getWidth() || ny < 0 || ny >= this.grid.getHeight()) continue;
        if (maxRange !== undefined && nextDist > maxRange) continue;
        const np: Position = { x: nx, y: ny };
        const k = key(np);
        if (visited.has(k)) continue;
        visited.add(k);
        const cell = this.grid.getCell(np);
        if (cell.unitId === null) {
          const cfg = this.grid.getTerrainEffects(np);
          if (cfg.passable) {
            return np;
          }
        }
        queue.push({ pos: np, dist: nextDist });
      }
    }
    return null;
  }
}
