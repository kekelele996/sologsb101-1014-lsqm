/**
 * 分侧保存重试
 * 现场班组与验收组的数据写入各自独立捕获失败；一侧失败不会回滚或重试另一侧。
 */

export type SaveSide = '现场班组' | '验收组';

const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_MS = 50;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** 仅重试当前侧的一次写入；所有重试失败后抛出带侧别信息的错误 */
export async function runOnSide<T>(side: SaveSide, action: () => Promise<T>, retryLimit = DEFAULT_RETRY_LIMIT): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < retryLimit) await wait(DEFAULT_RETRY_DELAY_MS * attempt);
    }
  }
  const message = lastError instanceof Error ? lastError.message : '本地保存失败';
  throw new Error(`${side}保存失败（已仅重试本侧 ${retryLimit} 次）：${message}`);
}
