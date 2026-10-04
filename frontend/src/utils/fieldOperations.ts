/**
 * 现场班组侧保存编排
 * 苗木批次、栽植记录、实际补植完成情况只写现场侧；
 * 触发验收侧重算时单独执行和重试，失败不回滚现场数据。
 */
import {
  putPlanting,
  putReplantCompletion,
  putSeedling,
  recalcAutoSurveysForPlot,
  removePlanting,
  removeReplantCompletion,
  removeSeedling,
} from './db';
import type { Seedling } from '../types/seedling';
import type { ReplantCompletion } from '../types/replantCompletion';
import type { Planting } from '../types/planting';
import { runOnSide } from './sideRetry';

export interface FieldChangeResult {
  fieldMessage: string;
  acceptanceMessage: string | null;
}

export async function saveSeedlingOnFieldSide(row: Seedling): Promise<string> {
  await runOnSide('现场班组', () => putSeedling(row));
  return '现场苗木批次已保存';
}

/** 保存栽植记录，然后仅让验收侧重算该地块未人工定级的测次。 */
export async function savePlantingOnFieldSide(row: Planting): Promise<FieldChangeResult> {
  await runOnSide('现场班组', () => putPlanting(row));
  let acceptanceMessage: string | null = null;
  try {
    const count = await runOnSide('验收组', () => recalcAutoSurveysForPlot(row.plotId));
    acceptanceMessage = `验收组已重算 ${count} 个未人工定级测次，人工定级保持不变`;
  } catch (error) {
    acceptanceMessage = error instanceof Error ? error.message : '验收组侧重算失败，现场记录已保存';
  }
  return { fieldMessage: '现场栽植记录已保存', acceptanceMessage };
}

/** 删除栽植记录后，验收侧同样只重算自动测次。 */
export async function deletePlantingOnFieldSide(plotId: string, plantingId: string): Promise<FieldChangeResult> {
  await runOnSide('现场班组', () => removePlanting(plantingId));
  let acceptanceMessage: string | null = null;
  try {
    const count = await runOnSide('验收组', () => recalcAutoSurveysForPlot(plotId));
    acceptanceMessage = `验收组已重算 ${count} 个未人工定级测次，人工定级保持不变`;
  } catch (error) {
    acceptanceMessage = error instanceof Error ? error.message : '验收组侧重算失败，现场记录已删除';
  }
  return { fieldMessage: '现场栽植记录已删除', acceptanceMessage };
}

/** 删除苗木批次及引用栽植记录；随后验收侧独立重算。 */
export async function deleteSeedlingOnFieldSide(plotId: string, seedlingId: string): Promise<FieldChangeResult> {
  await runOnSide('现场班组', () => removeSeedling(seedlingId));
  let acceptanceMessage: string | null = null;
  try {
    const count = await runOnSide('验收组', () => recalcAutoSurveysForPlot(plotId));
    acceptanceMessage = `验收组已重算 ${count} 个未人工定级测次，人工定级保持不变`;
  } catch (error) {
    acceptanceMessage = error instanceof Error ? error.message : '验收组侧重算失败，现场批次已删除';
  }
  return { fieldMessage: '现场苗木批次已删除', acceptanceMessage };
}

/** 现场班组保存实际补植株数和日期，只写现场侧完成记录。 */
export async function saveReplantCompletionOnFieldSide(row: ReplantCompletion): Promise<string> {
  await runOnSide('现场班组', () => putReplantCompletion(row));
  return `现场补植已记录：实际补植 ${row.actualCount} 株，完成日期 ${row.completedDate}；待验收组确认`;
}

export async function deleteReplantCompletionOnFieldSide(replantId: string): Promise<string> {
  await runOnSide('现场班组', () => removeReplantCompletion(replantId));
  return '现场补植完成记录已撤回';
}
