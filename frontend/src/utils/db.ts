/**
 * IndexedDB 持久化层（Dexie 封装）
 * - 数据库名：gbmangrove
 * - 含数据结构版本号与 v1 → v2 升级迁移逻辑（升级时按 version().stores() 补齐索引）
 * - 提供各表增删改查、整库快照导入导出与重置
 * 纯前端应用：不依赖任何后端服务或外部接口。
 */
import Dexie, { type Table } from 'dexie';
import type { Plot } from '../types/plot';
import type { Seedling } from '../types/seedling';
import type { Planting } from '../types/planting';
import type { Survey } from '../types/survey';
import type { Replant } from '../types/replant';
import type { ReplantCompletion } from '../types/replantCompletion';
import { calcSurvivalRate, rateLevel } from './rate';
import { nowIso, today } from './id';
import { seedDatabase } from './seed';

/** 数据库名 */
export const DB_NAME = 'gbmangrove';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_SCHEMA_VERSION = 3;

/** 数据行结构修订号 */
export const ROW_REVISION = 3;

class MangroveDatabase extends Dexie {
  plots!: Table<Plot, string>;
  seedlings!: Table<Seedling, string>;
  plantings!: Table<Planting, string>;
  surveys!: Table<Survey, string>;
  replants!: Table<Replant, string>;
  replantCompletions!: Table<ReplantCompletion, string>;

  constructor() {
    super(DB_NAME);

    // ---------- v1：初版结构 ----------
    this.version(1).stores({
      plots: 'id, name, tideZone, substrate, restoreMode, state, createdAt',
      seedlings: 'id, plotId, species, source, arrivalDate',
      plantings: 'id, plotId, seedlingId, plantDate',
      surveys: 'id, plotId, round, date',
      replants: 'id, plotId, planDate, state',
    });

    // ---------- v2：补齐索引与回写字段，并迁移历史数据 ----------
    this.version(DB_SCHEMA_VERSION)
      .stores({
        plots: 'id, name, tideZone, substrate, restoreMode, state, createdAt, updatedAt',
        seedlings: 'id, plotId, species, source, arrivalDate, quantity',
        plantings: 'id, plotId, seedlingId, plantDate, spacingM',
        // 复合索引 [plotId+round]：按地块 + 测次快速取验收记录
        surveys: 'id, plotId, [plotId+round], date, grade',
        replants: 'id, plotId, planDate, state, species',
      })
      .upgrade(async (tx) => {
        // 迁移 1：补齐 revision / createdAt / updatedAt
        const tables = [
          tx.table('plots'),
          tx.table('seedlings'),
          tx.table('plantings'),
          tx.table('surveys'),
          tx.table('replants'),
        ];
        for (const table of tables) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            row.revision = ROW_REVISION;
            if (typeof row.createdAt !== 'string') row.createdAt = nowIso();
            if (typeof row.updatedAt !== 'string') row.updatedAt = row.createdAt;
          });
        }
        // 迁移 2：地块补齐「缺株数 / 最近补植日期」回写字段
        await tx.table('plots').toCollection().modify((row: Record<string, unknown>) => {
          if (typeof row.missingCount !== 'number') row.missingCount = 0;
          if (typeof row.lastReplantDate !== 'string') row.lastReplantDate = '';
        });
        // 迁移 3：验收记录补齐成活率等级字段
        await tx.table('surveys').toCollection().modify((row: Record<string, unknown>) => {
          const rate = typeof row.survivalRate === 'number' ? row.survivalRate : 0;
          if (typeof row.grade !== 'string') row.grade = rateLevel(rate);
          if (typeof row.gradeManual !== 'boolean') row.gradeManual = false;
        });
      });

    // ---------- v3：现场班组 / 验收组分侧留痕 ----------
    this.version(DB_SCHEMA_VERSION)
      .stores({
        plots: 'id, name, tideZone, substrate, restoreMode, state, createdAt, updatedAt',
        seedlings: 'id, plotId, species, source, arrivalDate, quantity',
        plantings: 'id, plotId, seedlingId, plantDate, spacingM',
        surveys: 'id, plotId, [plotId+round], date, grade, gradeSource, rateWriteback',
        replants: 'id, plotId, planDate, state, species, reconciliationStatus',
        replantCompletions: 'id, replantId, plotId, completedDate',
      })
      .upgrade(async (tx) => {
        const stamp = nowIso();
        const allTables = [
          tx.table('plots'),
          tx.table('seedlings'),
          tx.table('plantings'),
          tx.table('surveys'),
          tx.table('replants'),
        ];
        for (const table of allTables) {
          await table.toCollection().modify((row: Record<string, unknown>) => {
            row.revision = ROW_REVISION;
            if (typeof row.createdAt !== 'string') row.createdAt = stamp;
            if (typeof row.updatedAt !== 'string') row.updatedAt = stamp;
          });
        }

        const plantings = await tx.table('plantings').toArray() as Array<{ plotId?: string; count?: number }>;
        const totalsByPlot = new Map<string, number>();
        plantings.forEach((row) => {
          if (typeof row.plotId !== 'string') return;
          totalsByPlot.set(row.plotId, (totalsByPlot.get(row.plotId) ?? 0) + (row.count ?? 0));
        });

        await tx.table('surveys').toCollection().modify((row: Record<string, unknown>) => {
          const rate = typeof row.survivalRate === 'number' ? row.survivalRate : 0;
          const alive = typeof row.aliveCount === 'number' ? row.aliveCount : 0;
          const liveTotal = totalsByPlot.get(String(row.plotId)) ?? 0;
          // 按当时保存的成活率反推验收组株数，避免升级动作改变历史结论。
          row.acceptedPlantCount = rate > 0 ? Math.max(alive, Math.round((alive * 100) / rate)) : liveTotal;
          if (row.gradeSource !== 'auto' && row.gradeSource !== 'manual') {
            row.gradeSource = row.gradeManual === true ? 'manual' : 'auto';
          }
          if (typeof row.rateWriteback !== 'boolean') row.rateWriteback = false;
          if (typeof row.rateWritebackReplantId !== 'string') row.rateWritebackReplantId = '';
          if (typeof row.grade !== 'string') row.grade = rateLevel(rate);
        });

        const replants = (await tx.table('replants').toArray()) as Replant[];
        const completions: ReplantCompletion[] = [];
        for (const replant of replants) {
          const status = replant.state === '已复核' ? 'confirmed' : 'pending';
          await tx.table('replants').update(replant.id, {
            baselinePlantCount: totalsByPlot.get(replant.plotId) ?? 0,
            reconciliationStatus: status,
            holdReason: '',
            confirmedAt: replant.state === '已复核' ? replant.updatedAt : '',
            revision: ROW_REVISION,
          });
          if (replant.state !== '待补植') {
            completions.push({
              id: replant.id,
              replantId: replant.id,
              plotId: replant.plotId,
              actualCount: replant.missingCount,
              completedDate: replant.state === '已复核' ? replant.updatedAt.slice(0, 10) : replant.planDate,
              operator: '历史数据补录',
              createdAt: replant.createdAt ?? stamp,
              updatedAt: replant.updatedAt ?? stamp,
              revision: ROW_REVISION,
            });
            {
              const plotSurveys = ((await tx.table('surveys').where('plotId').equals(replant.plotId).toArray()) as Survey[])
                .sort((a, b) => a.round - b.round);
              const latest = plotSurveys.at(-1);
              if (latest) {
                await tx.table('surveys').update(latest.id, {
                  rateWriteback: true,
                  rateWritebackReplantId: replant.id,
                });
              }
            }
          }
        }
        if (completions.length > 0) await tx.table('replantCompletions').bulkPut(completions);
      });
  }
}

export const db = new MangroveDatabase();

/* ------------------------------ 初始化与播种 ------------------------------ */

let initPromise: Promise<void> | null = null;

/**
 * 打开数据库并在首屏自动播种演示数据（幂等：仅当主表为空时播种）。
 * 多次调用共用同一个 Promise，避免并发重复播种。
 */
export function initDatabase(): Promise<void> {
  if (initPromise === null) {
    initPromise = (async (): Promise<void> => {
      await db.open();
      // 首屏自动播种演示数据：仅当主表为空时执行（幂等）
      if ((await db.plots.count()) === 0) {
        await seedDatabase();
      }
    })();
  }
  return initPromise;
}

/* -------------------------------- 地块 -------------------------------- */

export async function listPlots(): Promise<Plot[]> {
  const rows = await db.plots.toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function getPlot(id: string): Promise<Plot | undefined> {
  return db.plots.get(id);
}

export async function putPlot(row: Plot): Promise<void> {
  await db.plots.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION });
}

export async function patchPlot(id: string, patch: Partial<Plot>): Promise<void> {
  await db.plots.update(id, { ...patch, updatedAt: nowIso() });
}

/** 删除地块并级联清理其下苗木批次、栽植、验收与补植计划 */
export async function removePlot(id: string): Promise<void> {
  await db.transaction('rw', [db.plots, db.seedlings, db.plantings, db.surveys, db.replants, db.replantCompletions], async () => {
    await db.seedlings.where('plotId').equals(id).delete();
    await db.plantings.where('plotId').equals(id).delete();
    await db.surveys.where('plotId').equals(id).delete();
    await db.replants.where('plotId').equals(id).delete();
    await db.replantCompletions.where('plotId').equals(id).delete();
    await db.plots.delete(id);
  });
}

/* ------------------------------ 苗木批次 ------------------------------ */

export async function listSeedlings(): Promise<Seedling[]> {
  const rows = await db.seedlings.toArray();
  return rows.sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate));
}

export async function listSeedlingsByPlot(plotId: string): Promise<Seedling[]> {
  const rows = await db.seedlings.where('plotId').equals(plotId).toArray();
  return rows.sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate));
}

export async function putSeedling(row: Seedling): Promise<void> {
  await db.seedlings.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION });
}

export async function removeSeedling(id: string): Promise<void> {
  await db.transaction('rw', db.seedlings, db.plantings, async () => {
    // 该批次已被栽植记录引用时一并清理，避免出现悬空引用
    await db.plantings.where('seedlingId').equals(id).delete();
    await db.seedlings.delete(id);
  });
}

/* ------------------------------- 栽植 ------------------------------- */

export async function listPlantings(): Promise<Planting[]> {
  const rows = await db.plantings.toArray();
  return rows.sort((a, b) => b.plantDate.localeCompare(a.plantDate));
}

export async function listPlantingsByPlot(plotId: string): Promise<Planting[]> {
  const rows = await db.plantings.where('plotId').equals(plotId).toArray();
  return rows.sort((a, b) => b.plantDate.localeCompare(a.plantDate));
}

export async function putPlanting(row: Planting): Promise<void> {
  await db.plantings.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION });
}

export async function removePlanting(id: string): Promise<void> {
  await db.plantings.delete(id);
}

/* ------------------------------- 验收 ------------------------------- */

export async function listSurveys(): Promise<Survey[]> {
  const rows = await db.surveys.toArray();
  return rows.sort((a, b) => a.plotId.localeCompare(b.plotId) || a.round - b.round);
}

export async function listSurveysByPlot(plotId: string): Promise<Survey[]> {
  const rows = await db.surveys.where('plotId').equals(plotId).toArray();
  return rows.sort((a, b) => a.round - b.round);
}

export async function putSurvey(row: Survey): Promise<void> {
  const gradeSource: Survey['gradeSource'] = row.gradeSource ?? (row.gradeManual ? 'manual' : 'auto');
  const grade = gradeSource === 'manual' ? row.grade : rateLevel(row.survivalRate);
  await db.surveys.put({
    ...row,
    acceptedPlantCount: row.acceptedPlantCount ?? 0,
    grade,
    gradeSource,
    gradeManual: gradeSource === 'manual',
    rateWriteback: row.rateWriteback ?? false,
    rateWritebackReplantId: row.rateWritebackReplantId ?? '',
    updatedAt: nowIso(),
    revision: ROW_REVISION,
  });
}

/** 批量调整成活率等级（人工复核覆盖） */
export async function patchSurveyGrades(ids: string[], grade: Survey['grade']): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.surveys.bulkGet(ids);
  const stamp = nowIso();
  const next = rows
    .filter((row): row is Survey => row !== undefined)
    .map((row) => ({
      ...row,
      grade,
      gradeSource: 'manual' as const,
      gradeManual: true,
      updatedAt: stamp,
      revision: ROW_REVISION,
    }));
  if (next.length > 0) await db.surveys.bulkPut(next);
}

export async function removeSurvey(id: string): Promise<void> {
  await db.surveys.delete(id);
}

/* ------------------------------ 补植计划 ------------------------------ */

export async function listReplants(): Promise<Replant[]> {
  const rows = await db.replants.toArray();
  return rows.sort((a, b) => a.planDate.localeCompare(b.planDate));
}

export async function listReplantsByPlot(plotId: string): Promise<Replant[]> {
  const rows = await db.replants.where('plotId').equals(plotId).toArray();
  return rows.sort((a, b) => a.planDate.localeCompare(b.planDate));
}

export async function putReplant(row: Replant): Promise<void> {
  await db.replants.put({
    ...row,
    baselinePlantCount: row.baselinePlantCount ?? 0,
    reconciliationStatus: row.reconciliationStatus ?? 'pending',
    holdReason: row.holdReason ?? '',
    confirmedAt: row.confirmedAt ?? '',
    updatedAt: nowIso(),
    revision: ROW_REVISION,
  });
}

export async function removeReplant(id: string): Promise<void> {
  const completion = await db.replantCompletions.get(id);
  if (completion) {
    throw new Error('现场班组已提交补植完成记录，验收组不能直接删除该计划');
  }
  await db.replants.delete(id);
}

/**
 * 栽植株数变化后，验收组侧仅重算未人工定级的测次。
 * 人工定过级的测次保留验收组原结论；本函数只写验收表，不回改现场栽植记录。
 */
export async function recalcAutoSurveysForPlot(plotId: string): Promise<number> {
  const plantings = await db.plantings.where('plotId').equals(plotId).toArray();
  const total = plantings.reduce((acc, item) => acc + item.count, 0);
  const surveys = await db.surveys.where('plotId').equals(plotId).toArray();
  const stamp = nowIso();
  const next = surveys
    .filter((row) => row.gradeSource !== 'manual' && !row.gradeManual)
    .map((row) => {
      const survivalRate = calcSurvivalRate(row.aliveCount, total);
      return {
        ...row,
        acceptedPlantCount: total,
        survivalRate,
        grade: rateLevel(survivalRate),
        gradeSource: 'auto' as const,
        updatedAt: stamp,
        revision: ROW_REVISION,
      };
    });
  if (next.length > 0) await db.surveys.bulkPut(next);
  return next.length;
}

/* --------------------------- 现场补植完成记录 --------------------------- */

export async function listReplantCompletions(): Promise<ReplantCompletion[]> {
  return db.replantCompletions.toArray();
}

export async function getReplantCompletion(replantId: string): Promise<ReplantCompletion | undefined> {
  return db.replantCompletions.get(replantId);
}

/** 现场班组只保存自己的实际补植株数与日期，不改验收计划和验收测次。 */
export async function putReplantCompletion(row: ReplantCompletion): Promise<void> {
  await db.replantCompletions.put({ ...row, updatedAt: nowIso(), revision: ROW_REVISION });
}

export async function removeReplantCompletion(replantId: string): Promise<void> {
  await db.replantCompletions.delete(replantId);
}

export interface ConfirmReplantResult {
  status: 'confirmed' | 'hold';
  message: string;
}

/**
 * 验收组确认现场补植：
 * - 核对实际补植株数是否等于计划缺株数；
 * - 对不上只在验收计划侧挂起，不改成活率；
 * - 核对通过才按最新测次成活株数 + 实际补植株数重算并标记回写。
 */
export async function confirmReplantCompletion(replantId: string): Promise<ConfirmReplantResult> {
  return db.transaction('rw', db.replants, db.replantCompletions, db.surveys, async () => {
    const replant = await db.replants.get(replantId);
    const completion = await db.replantCompletions.get(replantId);
    if (!replant) throw new Error('补植计划不存在');
    if (!completion) throw new Error('现场班组尚未提交补植完成记录');

    const stamp = nowIso();

    if (completion.actualCount <= 0 || completion.actualCount !== replant.missingCount) {
      await db.replants.update(replantId, {
        state: '待补植',
        reconciliationStatus: 'hold',
        holdReason: `现场实际补植 ${completion.actualCount} 株，与计划缺株 ${replant.missingCount} 株不一致，已挂起待核对。`,
        updatedAt: stamp,
        revision: ROW_REVISION,
      });
      return {
        status: 'hold',
        message: '现场补植记录对不上，地块已挂起，成活率未重算',
      };
    }

    const surveys = await db.surveys.where('plotId').equals(replant.plotId).toArray();
    const latest = surveys.sort((a, b) => a.round - b.round).at(-1);
    if (!latest) {
      await db.replants.update(replantId, {
        reconciliationStatus: 'hold',
        holdReason: '现场已补植，但验收组尚无验收测次，无法确认成活率。',
        updatedAt: stamp,
        revision: ROW_REVISION,
      });
      return {
        status: 'hold',
        message: '尚无验收测次，计划已挂起，成活率未重算',
      };
    }

    const aliveAfter = latest.aliveCount + completion.actualCount;
    const denominator = Math.max(latest.acceptedPlantCount, replant.baselinePlantCount);
    const survivalRate = calcSurvivalRate(aliveAfter, denominator);
    const manual = latest.gradeSource === 'manual' || latest.gradeManual;
    await db.surveys.put({
      ...latest,
      aliveCount: aliveAfter,
      acceptedPlantCount: denominator,
      survivalRate,
      grade: manual ? latest.grade : rateLevel(survivalRate),
      gradeSource: manual ? 'manual' : 'auto',
      gradeManual: manual,
      rateWriteback: true,
      rateWritebackReplantId: replantId,
      updatedAt: stamp,
      revision: ROW_REVISION,
    });
    await db.replants.update(replantId, {
      state: '已复核',
      reconciliationStatus: 'confirmed',
      holdReason: '',
      confirmedAt: today(),
      updatedAt: stamp,
      revision: ROW_REVISION,
    });
    return {
      status: 'confirmed',
      message: `验收组已确认，最新成活率重算为 ${survivalRate}%`,
    };
  });
}

/* ---------------------------- 整库快照 ---------------------------- */

export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  plots: Plot[];
  seedlings: Seedling[];
  plantings: Planting[];
  surveys: Survey[];
  replants: Replant[];
  replantCompletions: ReplantCompletion[];
}

/** 导出整库快照 */
export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [plots, seedlings, plantings, surveys, replants, replantCompletions] = await Promise.all([
    db.plots.toArray(),
    db.seedlings.toArray(),
    db.plantings.toArray(),
    db.surveys.toArray(),
    db.replants.toArray(),
    db.replantCompletions.toArray(),
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_SCHEMA_VERSION,
    exportedAt: nowIso(),
    plots,
    seedlings,
    plantings,
    surveys,
    replants,
    replantCompletions,
  };
}

/** 用快照覆盖整库（导入存档） */
export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  await db.transaction('rw', [db.plots, db.seedlings, db.plantings, db.surveys, db.replants, db.replantCompletions], async () => {
    await Promise.all([
      db.plots.clear(),
      db.seedlings.clear(),
      db.plantings.clear(),
      db.surveys.clear(),
      db.replants.clear(),
      db.replantCompletions.clear(),
    ]);
    const importedTotals = new Map<string, number>();
    snapshot.plantings.forEach((row) => {
      importedTotals.set(row.plotId, (importedTotals.get(row.plotId) ?? 0) + row.count);
    });
    await db.plots.bulkPut(snapshot.plots.map((row) => ({ ...row, revision: ROW_REVISION })));
    await db.seedlings.bulkPut(snapshot.seedlings.map((row) => ({ ...row, revision: ROW_REVISION })));
    await db.plantings.bulkPut(snapshot.plantings.map((row) => ({ ...row, revision: ROW_REVISION })));
    await db.surveys.bulkPut(
      snapshot.surveys.map((row) => ({
        ...row,
        acceptedPlantCount: row.acceptedPlantCount ?? importedTotals.get(row.plotId) ?? 0,
        gradeSource: row.gradeSource ?? (row.gradeManual ? 'manual' : 'auto'),
        gradeManual: row.gradeSource === 'manual' || row.gradeManual === true,
        rateWriteback: row.rateWriteback ?? false,
        rateWritebackReplantId: row.rateWritebackReplantId ?? '',
        revision: ROW_REVISION,
      })),
    );
    await db.replants.bulkPut(
      snapshot.replants.map((row) => ({
        ...row,
        baselinePlantCount: row.baselinePlantCount ?? importedTotals.get(row.plotId) ?? 0,
        reconciliationStatus: row.reconciliationStatus ?? 'pending',
        holdReason: row.holdReason ?? '',
        confirmedAt: row.confirmedAt ?? '',
        revision: ROW_REVISION,
      })),
    );
    await db.replantCompletions.bulkPut(
      (snapshot.replantCompletions ?? []).map((row) => ({ ...row, revision: ROW_REVISION })),
    );
  });
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await db.transaction('rw', [db.plots, db.seedlings, db.plantings, db.surveys, db.replants, db.replantCompletions], async () => {
    await Promise.all([
      db.plots.clear(),
      db.seedlings.clear(),
      db.plantings.clear(),
      db.surveys.clear(),
      db.replants.clear(),
      db.replantCompletions.clear(),
    ]);
  });
  await seedDatabase();
}

/** 各表行数统计 */
export async function countAll(): Promise<Record<string, number>> {
  const [plots, seedlings, plantings, surveys, replants, replantCompletions] = await Promise.all([
    db.plots.count(),
    db.seedlings.count(),
    db.plantings.count(),
    db.surveys.count(),
    db.replants.count(),
    db.replantCompletions.count(),
  ]);
  return { plots, seedlings, plantings, surveys, replants, replantCompletions };
}
