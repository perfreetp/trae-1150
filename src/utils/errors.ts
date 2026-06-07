export { ErrorCode } from '../types';

import { ErrorCode } from '../types';

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.BattleAlreadyStarted]: '战斗已开始，无法执行此操作',
  [ErrorCode.BattleNotStarted]: '战斗尚未开始',
  [ErrorCode.UnitNotFound]: '未找到指定单位',
  [ErrorCode.SkillNotFound]: '未找到指定技能',
  [ErrorCode.SkillOnCooldown]: '技能冷却中',
  [ErrorCode.InvalidTarget]: '无效的目标',
  [ErrorCode.OutOfRange]: '超出技能范围',
  [ErrorCode.CellOccupied]: '格子已被占据',
  [ErrorCode.CellImpassable]: '地形不可通行',
  [ErrorCode.UnitDead]: '单位已阵亡',
  [ErrorCode.UnitStunned]: '单位被眩晕',
  [ErrorCode.NotUnitTurn]: '不是该单位的回合',
  [ErrorCode.InvalidPosition]: '无效的坐标',
  [ErrorCode.BattleOver]: '战斗已结束',
  [ErrorCode.NoWinCondition]: '未设置胜利条件',
  [ErrorCode.ReplayCorrupted]: '回放数据已损坏',
};

export class SDKError extends Error {
  code: ErrorCode;
  detail?: string;

  constructor(code: ErrorCode, detail?: string) {
    const base = ERROR_MESSAGES[code] || code;
    super(detail ? `${base}：${detail}` : base);
    this.name = 'SDKError';
    this.code = code;
    this.detail = detail;
  }
}
