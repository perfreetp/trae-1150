export enum TerrainType {
  Plain = 'plain',
  Forest = 'forest',
  Mountain = 'mountain',
  Water = 'water',
  Wall = 'wall',
  Lava = 'lava',
  Swamp = 'swamp',
  Ice = 'ice',
}

export interface TerrainConfig {
  moveCost: number;
  defenseBonus: number;
  avoidBonus: number;
  damagePerTurn?: number;
  healPerTurn?: number;
  passable: boolean;
}

export interface Position {
  x: number;
  y: number;
}

export interface GridCell {
  pos: Position;
  terrain: TerrainType;
  unitId: string | null;
}

export interface UnitBaseStats {
  maxHp: number;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  hit: number;
  avoid: number;
  critRate: number;
  critMultiplier: number;
  moveRange: number;
}

export enum UnitStatus {
  Alive = 'alive',
  Dead = 'dead',
  Stunned = 'stunned',
  Frozen = 'frozen',
}

export enum BuffType {
  AttackUp = 'attack_up',
  DefenseUp = 'defense_up',
  SpeedUp = 'speed_up',
  CritUp = 'crit_up',
  HitUp = 'hit_up',
  AvoidUp = 'avoid_up',
  Shield = 'shield',
  Regen = 'regen',
}

export enum DebuffType {
  AttackDown = 'attack_down',
  DefenseDown = 'defense_down',
  SpeedDown = 'speed_down',
  CritDown = 'crit_down',
  HitDown = 'hit_down',
  AvoidDown = 'avoid_down',
  Poison = 'poison',
  Burn = 'burn',
  Bleed = 'bleed',
  Stun = 'stun',
  Freeze = 'freeze',
}

export interface Buff {
  type: BuffType;
  value: number;
  duration: number;
  sourceUnitId?: string;
}

export interface Debuff {
  type: DebuffType;
  value: number;
  duration: number;
  sourceUnitId?: string;
}

export interface DoTEffect {
  type: 'poison' | 'burn' | 'bleed';
  damagePerTick: number;
  ticksRemaining: number;
  sourceUnitId?: string;
}

export interface Unit {
  id: string;
  name: string;
  team: string;
  stats: UnitBaseStats;
  status: UnitStatus;
  pos: Position | null;
  buffs: Buff[];
  debuffs: Debuff[];
  dots: DoTEffect[];
  shield: number;
  skills: SkillDefinition[];
  cooldowns: Record<string, number>;
  isSummon: boolean;
  summonerId: string | null;
  tags: string[];
}

export enum SkillTargetType {
  Enemy = 'enemy',
  Ally = 'ally',
  Self = 'self',
  AllEnemy = 'all_enemy',
  AllAlly = 'all_ally',
  All = 'all',
  Cell = 'cell',
}

export enum SkillEffectType {
  Damage = 'damage',
  Heal = 'heal',
  Buff = 'buff',
  Debuff = 'debuff',
  DoT = 'dot',
  Shield = 'shield',
  Summon = 'summon',
  Revive = 'revive',
  Dispel = 'dispel',
  Custom = 'custom',
}

export interface SkillEffect {
  type: SkillEffectType;
  value?: number;
  buff?: Buff;
  debuff?: Debuff;
  dot?: DoTEffect;
  summonTemplate?: Partial<Unit>;
  reviveHpPercent?: number;
  dispelBuffs?: boolean;
  dispelDebuffs?: boolean;
  customHandler?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  range: number;
  targetPattern: SkillTargetType;
  effects: SkillEffect[];
  cooldown: number;
  currentCooldown: number;
  aoeRadius?: number;
  tags: string[];
}

export interface ActionResult {
  skillId: string;
  actorId: string;
  targetIds: string[];
  results: TargetResult[];
  timestamp: number;
}

export interface TargetResult {
  targetId: string;
  hit: boolean;
  critical: boolean;
  damage: number;
  shieldAbsorbed: number;
  healed: number;
  buffsApplied: Buff[];
  debuffsApplied: Debuff[];
  dotsApplied: DoTEffect[];
  revived: boolean;
  dispelled: boolean;
  summoned: boolean;
  summonId?: string;
  failureReason?: string;
}

export interface BattleLogEntry {
  turn: number;
  subTurn: number;
  action: string;
  actorId: string;
  targetIds: string[];
  data: Record<string, unknown>;
  timestamp: number;
}

export interface BattleConfig {
  width: number;
  height: number;
  terrainMap?: TerrainType[][];
  seed: number;
  winCondition?: WinCondition;
  loseCondition?: LoseCondition;
  customTerrainConfig?: Partial<Record<TerrainType, Partial<TerrainConfig>>>;
}

export type WinCondition = (room: unknown) => boolean;
export type LoseCondition = (room: unknown) => boolean;

export type EventListener = (event: string, data: unknown) => void;

export interface BattleState {
  turn: number;
  subTurn: number;
  isOver: boolean;
  winner: string | null;
  currentUnitId: string | null;
  unitOrder: string[];
}

export interface ReplaySnapshot {
  turn: number;
  subTurn: number;
  currentUnitId: string | null;
  isOver: boolean;
  winner: string | null;
  units: Unit[];
  grid: GridCell[][];
  log: BattleLogEntry[];
  queueEntries: { unitId: string; speed: number; hasActed: boolean; isWaiting: boolean }[];
}

export interface ReplayData {
  config: BattleConfig;
  snapshots: ReplaySnapshot[];
  actions: ActionResult[];
}

export enum ErrorCode {
  BattleAlreadyStarted = 'E_BATTLE_STARTED',
  BattleNotStarted = 'E_BATTLE_NOT_STARTED',
  UnitNotFound = 'E_UNIT_NOT_FOUND',
  SkillNotFound = 'E_SKILL_NOT_FOUND',
  SkillOnCooldown = 'E_SKILL_COOLDOWN',
  InvalidTarget = 'E_INVALID_TARGET',
  TargetTeamMismatch = 'E_TARGET_TEAM_MISMATCH',
  OutOfRange = 'E_OUT_OF_RANGE',
  CellOccupied = 'E_CELL_OCCUPIED',
  CellImpassable = 'E_CELL_IMPASSABLE',
  UnitDead = 'E_UNIT_DEAD',
  UnitStunned = 'E_UNIT_STUNNED',
  NotUnitTurn = 'E_NOT_UNIT_TURN',
  InvalidPosition = 'E_INVALID_POSITION',
  BattleOver = 'E_BATTLE_OVER',
  NoWinCondition = 'E_NO_WIN_CONDITION',
  ReplayCorrupted = 'E_REPLAY_CORRUPTED',
  NoCellForRevive = 'E_NO_CELL_REVIVE',
  NoCellForSummon = 'E_NO_CELL_SUMMON',
}
