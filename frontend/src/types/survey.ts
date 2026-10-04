/**
 * 成活率验收（Survey）
 * 按测次登记成活株数与平均株高，成活率由成活株数 / 栽植总株数派生。
 */

/** 成活率等级：优 / 良 / 一般 / 差 */
export type RateLevel = 'excellent' | 'good' | 'fair' | 'poor';

/** 等级来源：验收组自动测算 / 人工定级 */
export type GradeSource = 'auto' | 'manual';

export const RATE_LEVEL_LABEL: Record<RateLevel, string> = {
  excellent: '优',
  good: '良',
  fair: '一般',
  poor: '差',
};

export const RATE_LEVEL_OPTIONS: RateLevel[] = ['excellent', 'good', 'fair', 'poor'];

export interface Survey {
  id: string;
  /** 所属地块 */
  plotId: string;
  /** 测次（1、2、3……） */
  round: number;
  /** 验收日期 YYYY-MM-DD */
  date: string;
  /** 成活株数 */
  aliveCount: number;
  /** 平均株高（厘米） */
  avgHeightCm: number;
  /** 验收组保存该测次时认定的栽植株数（独立于现场后续补录） */
  acceptedPlantCount: number;
  /** 成活率（百分比，保留 1 位小数）——验收组保存时按当时株数测算 */
  survivalRate: number;
  /** 成活率等级——默认按区间自动判定，可人工调整 */
  grade: RateLevel;
  /** 等级来源：自动测算或人工定级；人工定级不随现场株数变化 */
  gradeSource: GradeSource;
  /** 该等级是否被人工调整过 */
  gradeManual: boolean;
  /** 是否由验收组确认补植计划后回写 */
  rateWriteback: boolean;
  /** 回写所依据的补植计划 id */
  rateWritebackReplantId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** 新建 / 编辑验收记录的表单草稿 */
export interface SurveyDraft {
  plotId: string;
  round: number;
  date: string;
  aliveCount: number;
  avgHeightCm: number;
}
