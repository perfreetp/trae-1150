import {
  Unit,
  UnitBaseStats,
  UnitStatus,
  Buff,
  Debuff,
  DoTEffect,
  SkillDefinition,
  BuffType,
  DebuffType,
  Position,
} from '../types';
import { SDKError, ErrorCode } from '../utils/errors';

export class UnitManager {
  private units: Map<string, Unit> = new Map();

  createUnit(
    id: string,
    name: string,
    team: string,
    stats: UnitBaseStats,
    skills: SkillDefinition[] = [],
    options?: { isSummon?: boolean; summonerId?: string; tags?: string[] }
  ): Unit {
    if (this.units.has(id)) {
      throw new SDKError(ErrorCode.UnitNotFound, `单位 ${id} 已存在`);
    }
    const unit: Unit = {
      id,
      name,
      team,
      stats: { ...stats },
      status: UnitStatus.Alive,
      pos: null,
      buffs: [],
      debuffs: [],
      dots: [],
      shield: 0,
      skills: skills.map(s => ({ ...s, currentCooldown: 0 })),
      cooldowns: {},
      isSummon: options?.isSummon ?? false,
      summonerId: options?.summonerId ?? null,
      tags: options?.tags ?? [],
    };
    this.units.set(id, unit);
    return unit;
  }

  getUnit(id: string): Unit {
    const unit = this.units.get(id);
    if (!unit) throw new SDKError(ErrorCode.UnitNotFound, id);
    return unit;
  }

  getUnitSafe(id: string): Unit | undefined {
    return this.units.get(id);
  }

  getAllUnits(): Unit[] {
    return Array.from(this.units.values());
  }

  getAliveUnits(): Unit[] {
    return this.getAllUnits().filter(u => u.status !== UnitStatus.Dead);
  }

  getUnitsByTeam(team: string): Unit[] {
    return this.getAllUnits().filter(u => u.team === team);
  }

  getAliveByTeam(team: string): Unit[] {
    return this.getAliveUnits().filter(u => u.team === team);
  }

  getTeams(): string[] {
    const teams = new Set<string>();
    for (const u of this.units.values()) {
      teams.add(u.team);
    }
    return Array.from(teams);
  }

  removeUnit(id: string): void {
    this.units.delete(id);
  }

  setUnitPosition(id: string, pos: Position | null): void {
    const unit = this.getUnit(id);
    unit.pos = pos ? { ...pos } : null;
  }

  takeDamage(id: string, rawDamage: number): { hpLost: number; shieldAbsorbed: number } {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) {
      throw new SDKError(ErrorCode.UnitDead, id);
    }
    let remaining = rawDamage;
    let shieldAbsorbed = 0;
    if (unit.shield > 0) {
      shieldAbsorbed = Math.min(unit.shield, remaining);
      unit.shield -= shieldAbsorbed;
      remaining -= shieldAbsorbed;
    }
    const hpLost = Math.min(remaining, unit.stats.hp);
    unit.stats.hp -= hpLost;
    if (unit.stats.hp <= 0) {
      unit.stats.hp = 0;
      unit.status = UnitStatus.Dead;
      unit.buffs = [];
      unit.debuffs = [];
      unit.dots = [];
      unit.shield = 0;
    }
    return { hpLost, shieldAbsorbed };
  }

  heal(id: string, amount: number): number {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) {
      throw new SDKError(ErrorCode.UnitDead, id);
    }
    const before = unit.stats.hp;
    unit.stats.hp = Math.min(unit.stats.hp + amount, unit.stats.maxHp);
    return unit.stats.hp - before;
  }

  revive(id: string, hpPercent: number): void {
    const unit = this.getUnit(id);
    if (unit.status !== UnitStatus.Dead) return;
    unit.stats.hp = Math.floor(unit.stats.maxHp * hpPercent);
    unit.status = UnitStatus.Alive;
    unit.buffs = [];
    unit.debuffs = [];
    unit.dots = [];
  }

  addShield(id: string, amount: number): void {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) return;
    unit.shield += amount;
  }

  addBuff(id: string, buff: Buff): void {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) return;
    const existing = unit.buffs.find(b => b.type === buff.type);
    if (existing) {
      existing.value = buff.value;
      existing.duration = buff.duration;
      existing.sourceUnitId = buff.sourceUnitId;
    } else {
      unit.buffs.push({ ...buff });
    }
  }

  addDebuff(id: string, debuff: Debuff): void {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) return;
    const existing = unit.debuffs.find(d => d.type === debuff.type);
    if (existing) {
      existing.value = debuff.value;
      existing.duration = debuff.duration;
      existing.sourceUnitId = debuff.sourceUnitId;
    } else {
      unit.debuffs.push({ ...debuff });
    }
  }

  addDoT(id: string, dot: DoTEffect): void {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) return;
    unit.dots.push({ ...dot });
  }

  tickBuffsAndDebuffs(id: string): void {
    const unit = this.getUnit(id);
    unit.buffs = unit.buffs.filter(b => {
      b.duration--;
      return b.duration > 0;
    });
    unit.debuffs = unit.debuffs.filter(d => {
      d.duration--;
      if (d.duration <= 0 && (d.type === DebuffType.Stun || d.type === DebuffType.Freeze)) {
        if (unit.status === UnitStatus.Stunned || unit.status === UnitStatus.Frozen) {
          unit.status = UnitStatus.Alive;
        }
      }
      return d.duration > 0;
    });
  }

  tickDoTs(id: string): number {
    const unit = this.getUnit(id);
    if (unit.status === UnitStatus.Dead) return 0;
    let totalDamage = 0;
    const remaining: DoTEffect[] = [];
    for (const dot of unit.dots) {
      const dmg = dot.damagePerTick;
      const result = this.takeDamage(id, dmg);
      totalDamage += result.hpLost;
      dot.ticksRemaining--;
      const currentStatus = this.getUnit(id).status;
      if (dot.ticksRemaining > 0 && currentStatus !== UnitStatus.Dead) {
        remaining.push(dot);
      }
    }
    unit.dots = remaining;
    return totalDamage;
  }

  getEffectiveStat(id: string, stat: keyof UnitBaseStats): number {
    const unit = this.getUnit(id);
    let base = unit.stats[stat];
    const buffMap: Partial<Record<BuffType, keyof UnitBaseStats>> = {
      [BuffType.AttackUp]: 'atk',
      [BuffType.DefenseUp]: 'def',
      [BuffType.SpeedUp]: 'spd',
      [BuffType.CritUp]: 'critRate',
      [BuffType.HitUp]: 'hit',
      [BuffType.AvoidUp]: 'avoid',
    };
    const debuffMap: Partial<Record<DebuffType, keyof UnitBaseStats>> = {
      [DebuffType.AttackDown]: 'atk',
      [DebuffType.DefenseDown]: 'def',
      [DebuffType.SpeedDown]: 'spd',
      [DebuffType.CritDown]: 'critRate',
      [DebuffType.HitDown]: 'hit',
      [DebuffType.AvoidDown]: 'avoid',
    };
    for (const buff of unit.buffs) {
      if (buffMap[buff.type] === stat) base += buff.value;
    }
    for (const debuff of unit.debuffs) {
      if (debuffMap[debuff.type] === stat) base -= debuff.value;
    }
    return Math.max(0, base);
  }

  isAlive(id: string): boolean {
    const unit = this.getUnitSafe(id);
    return unit !== undefined && unit.status !== UnitStatus.Dead;
  }

  canAct(id: string): boolean {
    const unit = this.getUnitSafe(id);
    if (!unit || unit.status === UnitStatus.Dead) return false;
    if (unit.status === UnitStatus.Stunned || unit.status === UnitStatus.Frozen) return false;
    if (unit.debuffs.some(d => d.type === DebuffType.Stun || d.type === DebuffType.Freeze)) return false;
    return true;
  }

  setSkillCooldown(id: string, skillId: string, turns: number): void {
    const unit = this.getUnit(id);
    unit.cooldowns[skillId] = turns;
  }

  tickCooldowns(id: string): void {
    const unit = this.getUnit(id);
    for (const skillId of Object.keys(unit.cooldowns)) {
      unit.cooldowns[skillId]--;
      if (unit.cooldowns[skillId] <= 0) {
        delete unit.cooldowns[skillId];
      }
    }
  }

  isSkillOnCooldown(id: string, skillId: string): boolean {
    const unit = this.getUnit(id);
    return (unit.cooldowns[skillId] ?? 0) > 0;
  }

  serialize(): Unit[] {
    return this.getAllUnits().map(u => ({
      ...u,
      pos: u.pos ? { ...u.pos } : null,
      stats: { ...u.stats },
      buffs: u.buffs.map(b => ({ ...b })),
      debuffs: u.debuffs.map(d => ({ ...d })),
      dots: u.dots.map(d => ({ ...d })),
      skills: u.skills.map(s => ({ ...s })),
      cooldowns: { ...u.cooldowns },
      tags: [...u.tags],
    }));
  }

  restore(units: Unit[]): void {
    this.units.clear();
    for (const u of units) {
      this.units.set(u.id, {
        ...u,
        pos: u.pos ? { ...u.pos } : null,
        stats: { ...u.stats },
        buffs: u.buffs.map(b => ({ ...b })),
        debuffs: u.debuffs.map(d => ({ ...d })),
        dots: u.dots.map(d => ({ ...d })),
        skills: u.skills.map(s => ({ ...s })),
        cooldowns: { ...u.cooldowns },
        tags: [...u.tags],
      });
    }
  }
}
