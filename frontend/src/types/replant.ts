/**
 * 补植计划（Replant）
 * 验收成活率偏低时生成的补植任务，完成后回写地块缺株数。
 */
import type { SeedlingSpecies } from './seedling';

/** 补植状态：待补植 / 已补植 / 已复核 */
export type ReplantState = '待补植' | '已补植' | '已复核';

export const REPLANT_STATE_OPTIONS: ReplantState[] = ['待补植', '已补植', '已复核'];

/** 补植状态流转顺序，用于「推进状态」动作 */
export const REPLANT_STATE_FLOW: ReplantState[] = ['待补植', '已补植', '已复核'];

export interface Replant {
  id: string;
  /** 所属地块 */
  plotId: string;
  /** 缺株数（株） */
  missingCount: number;
  /** 计划补植日期 YYYY-MM-DD */
  planDate: string;
  /** 补植树种 */
  species: SeedlingSpecies;
  /** 补植状态 */
  state: ReplantState;
  /** 实际补植株数（株）——推进到「已补植」时由现场班组填写，验收组确认前不改写验收成活率 */
  actualCount: number;
  /** 实际补植日期 YYYY-MM-DD——推进到「已补植」时填写 */
  actualDate: string;
  /** 是否挂起——验收组确认时若数据对不上则挂起，待现场核对后再确认 */
  suspended: boolean;
  /** 挂起原因 */
  suspendReason: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

/** 新建 / 编辑补植计划的表单草稿 */
export interface ReplantDraft {
  plotId: string;
  missingCount: number;
  planDate: string;
  species: SeedlingSpecies;
  state: ReplantState;
  actualCount?: number;
  actualDate?: string;
  suspended?: boolean;
  suspendReason?: string;
}
