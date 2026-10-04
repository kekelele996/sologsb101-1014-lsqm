/**
 * 补植计划（Replant）
 * 验收成活率偏低时生成的补植任务，完成后回写地块缺株数。
 */
import type { SeedlingSpecies } from './seedling';

/** 补植状态：待补植 / 已补植 / 已复核 */
export type ReplantState = '待补植' | '已补植' | '已复核';

/** 验收组对现场补植记录的核对状态 */
export type ReconciliationStatus = 'pending' | 'confirmed' | 'hold';

export const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = {
  pending: '待验收确认',
  confirmed: '已确认',
  hold: '已挂起',
};

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
  /** 补植状态（验收组维护） */
  state: ReplantState;
  /** 生成计划时验收组认定的栽植总株数，用于确认时核对现场新增量 */
  baselinePlantCount: number;
  /** 现场补植核对状态 */
  reconciliationStatus: ReconciliationStatus;
  /** 挂起原因：现场实际记录与计划/栽植数对不上时填写 */
  holdReason: string;
  /** 验收组确认日期 */
  confirmedAt: string;
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
}
