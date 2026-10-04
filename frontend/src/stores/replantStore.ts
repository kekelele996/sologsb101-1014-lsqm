/**
 * 补植计划状态管理（Zustand）
 * 维护补植计划的行内草稿、复核状态与批量选中项；
 * 状态推进与「补植完成回写地块缺株数」也在这里统一收口。
 */
import { create } from 'zustand';
import type { Replant, ReplantDraft, ReplantState } from '../types/replant';
import {
  ROW_REVISION,
  confirmReplantCompletion,
  db,
  exportSnapshot,
  importSnapshot,
  initDatabase,
  putReplant,
  removeReplant,
  resetDatabase,
  type DatabaseSnapshot,
} from '../utils/db';
import { deleteReplantCompletionOnFieldSide, saveReplantCompletionOnFieldSide } from '../utils/fieldOperations';
import type { ReplantCompletion } from '../types/replantCompletion';
import { nowIso, uuid } from '../utils/id';
import { usePlotStore } from './plotStore';
import { runOnSide } from '../utils/sideRetry';

/** 补植计划筛选条件 */
export interface ReplantFilters {
  plotId: string | 'all';
  state: ReplantState | 'all';
  keyword: string;
}

export interface ReplantStoreState {
  filters: ReplantFilters;
  /** 每行的行内编辑草稿，key = replant id */
  drafts: Record<string, Partial<ReplantDraft>>;
  /** 当前复核选中的状态（用于批量推进） */
  reviewState: ReplantState | 'all';
  selectedIds: string[];
  lastMessage: string;
  revision: number;
  init: () => Promise<void>;
  setFilters: (patch: Partial<ReplantFilters>) => void;
  resetFilters: () => void;
  setDraft: (replantId: string, patch: Partial<ReplantDraft>) => void;
  clearDraft: (replantId: string) => void;
  hasDraft: (replantId: string) => boolean;
  saveDraft: (replantId: string) => Promise<void>;
  createReplant: (draft: ReplantDraft) => Promise<Replant>;
  saveReplantEdit: (replantId: string, draft: ReplantDraft) => Promise<void>;
  deleteReplant: (replantId: string) => Promise<void>;
  /** 现场班组提交实际补植株数和日期（不改验收结论） */
  completeOnFieldSide: (input: {
    replantId: string;
    plotId: string;
    actualCount: number;
    completedDate: string;
    operator: string;
  }) => Promise<string>;
  /** 现场班组撤回自己的完成记录 */
  withdrawCompletion: (replantId: string) => Promise<string>;
  /** 验收组确认现场完成记录；对不上时在验收计划侧挂起 */
  confirmCompletion: (replantId: string) => Promise<{ status: 'confirmed' | 'hold'; message: string }>;
  batchConfirm: () => Promise<{ confirmed: number; held: number }>;
  setSelectedIds: (ids: string[]) => void;
  setReviewState: (state: ReplantState | 'all') => void;
  exportAll: () => Promise<DatabaseSnapshot>;
  importAll: (snapshot: DatabaseSnapshot) => Promise<void>;
  resetAll: () => Promise<void>;
}

const EMPTY_FILTERS: ReplantFilters = { plotId: 'all', state: 'all', keyword: '' };

export const useReplantStore = create<ReplantStoreState>((set, get) => ({
  filters: { ...EMPTY_FILTERS },
  drafts: {},
  reviewState: 'all',
  selectedIds: [],
  lastMessage: '',
  revision: 0,

  async init() {
    await initDatabase();
    set({ revision: get().revision + 1 });
  },

  setFilters(patch) {
    set({ filters: { ...get().filters, ...patch } });
  },

  resetFilters() {
    set({ filters: { ...EMPTY_FILTERS }, selectedIds: [] });
  },

  setDraft(replantId, patch) {
    set({ drafts: { ...get().drafts, [replantId]: { ...get().drafts[replantId], ...patch } } });
  },

  clearDraft(replantId) {
    const next = { ...get().drafts };
    delete next[replantId];
    set({ drafts: next });
  },

  hasDraft(replantId) {
    return get().drafts[replantId] !== undefined;
  },

  async saveDraft(replantId) {
    const draft = get().drafts[replantId];
    if (draft === undefined) return;
    const existing = await db.replants.get(replantId);
    if (!existing) return;
    await runOnSide('验收组', () => putReplant({ ...existing, ...draft } as Replant));
    get().clearDraft(replantId);
    set({ revision: get().revision + 1, lastMessage: '草稿已保存到补植计划' });
  },

  async createReplant(draft) {
    const stamp = nowIso();
    const row: Replant = {
      id: uuid('replant'),
      plotId: draft.plotId,
      missingCount: draft.missingCount,
      planDate: draft.planDate,
      species: draft.species,
      state: draft.state === '已复核' ? '待补植' : draft.state,
      baselinePlantCount: usePlotStore
        .getState()
        .plantings.filter((row) => row.plotId === draft.plotId)
        .reduce((acc, row) => acc + row.count, 0),
      reconciliationStatus: 'pending',
      holdReason: '',
      confirmedAt: '',
      createdAt: stamp,
      updatedAt: stamp,
      revision: ROW_REVISION,
    };
    await runOnSide('验收组', () => putReplant(row));
    set({ revision: get().revision + 1 });
    return row;
  },

  async saveReplantEdit(replantId, draft) {
    const existing = await db.replants.get(replantId);
    if (!existing) return;
    await runOnSide('验收组', () =>
      putReplant({
        ...existing,
        plotId: draft.plotId,
        missingCount: draft.missingCount,
        planDate: draft.planDate,
        species: draft.species,
      }),
    );
    set({ revision: get().revision + 1 });
  },

  async deleteReplant(replantId) {
    await runOnSide('验收组', () => removeReplant(replantId));
    get().clearDraft(replantId);
    set({
      selectedIds: get().selectedIds.filter((id) => id !== replantId),
      revision: get().revision + 1,
    });
  },

  async completeOnFieldSide(input) {
    const row: ReplantCompletion = {
      id: input.replantId,
      replantId: input.replantId,
      plotId: input.plotId,
      actualCount: input.actualCount,
      completedDate: input.completedDate,
      operator: input.operator,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      revision: ROW_REVISION,
    };
    const message = await saveReplantCompletionOnFieldSide(row);
    set({ revision: get().revision + 1, lastMessage: message });
    return message;
  },

  async withdrawCompletion(replantId) {
    const message = await deleteReplantCompletionOnFieldSide(replantId);
    set({ revision: get().revision + 1, lastMessage: message });
    return message;
  },

  async confirmCompletion(replantId) {
    const result = await runOnSide('验收组', () => confirmReplantCompletion(replantId));
    await usePlotStore.getState().refreshCounts();
    set({
      revision: get().revision + 1,
      lastMessage: result.message,
    });
    return result;
  },

  async batchConfirm() {
    const ids = get().selectedIds;
    let confirmed = 0;
    let held = 0;
    for (const id of ids) {
      const completion = await db.replantCompletions.get(id);
      if (!completion) continue;
      const result = await get().confirmCompletion(id);
      if (result.status === 'confirmed') confirmed += 1;
      else held += 1;
    }
    set({
      selectedIds: [],
      lastMessage: `验收组已批量确认：${confirmed} 条通过，${held} 条挂起`,
    });
    return { confirmed, held };
  },

  setSelectedIds(ids) {
    set({ selectedIds: [...ids] });
  },

  setReviewState(state) {
    set({ reviewState: state });
  },

  async exportAll() {
    return exportSnapshot();
  },

  async importAll(snapshot) {
    await importSnapshot(snapshot);
    set({ revision: get().revision + 1 });
  },

  async resetAll() {
    await resetDatabase();
    set({ drafts: {}, selectedIds: [], revision: get().revision + 1 });
  },
}));
