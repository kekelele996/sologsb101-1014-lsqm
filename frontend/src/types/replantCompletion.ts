/**
 * 现场补植完成记录（ReplantCompletion）
 * 仅由现场班组维护，记录实际补植株数与完成日期；验收组确认前不改动验收结论。
 */

export interface ReplantCompletion {
  id: string;
  /** 使用补植计划 id，便于两侧数据对应，但不由验收组改写 */
  replantId: string;
  /** 所属地块 */
  plotId: string;
  /** 现场实际补植株数 */
  actualCount: number;
  /** 现场实际完成日期 YYYY-MM-DD */
  completedDate: string;
  /** 现场填报班组 */
  operator: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
