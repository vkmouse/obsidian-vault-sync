import type { PushCommand } from '../types'

/**
 * 驗證 vault 名稱：1–100 字元，不限制字元種類（中文、emoji、符號皆可）。
 * 刻意不做 trim——是否要去除頭尾空白是使用者的選擇，擅自處理可能讓
 * 使用者存的名稱跟他實際輸入的不一樣。
 */
export function validateVaultName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null
  }
  if (name.length < 1 || name.length > 100) {
    return null
  }
  return name
}

const SYNC_ACTIONS = new Set(['CREATE', 'MODIFY', 'DELETE'])

/** SHA-256 hex，固定 64 個小寫十六進位字元。 */
const CONTENT_HASH_RE = /^[0-9a-f]{64}$/

/** 形狀不合法就回傳 null，讓呼叫端直接判 ERROR，不繼續往下做版本檢查。 */
export function validatePushCommand(command: unknown): PushCommand | null {
  if (typeof command !== 'object' || command === null) {
    return null
  }
  const c = command as Record<string, unknown>

  if (typeof c.mutationId !== 'string' || c.mutationId.length === 0) {
    return null
  }
  if (typeof c.path !== 'string' || c.path.length === 0) {
    return null
  }
  if (typeof c.action !== 'string' || !SYNC_ACTIONS.has(c.action)) {
    return null
  }
  if (typeof c.baseVersion !== 'number' || !Number.isInteger(c.baseVersion) || c.baseVersion < 0) {
    return null
  }

  // DELETE 不需要 contentHash，但沒有明確禁止帶——寬鬆接受，反正不會被用到。
  let contentHash: string | undefined
  if (c.contentHash !== undefined) {
    if (typeof c.contentHash !== 'string' || !CONTENT_HASH_RE.test(c.contentHash)) {
      return null
    }
    contentHash = c.contentHash
  }
  if ((c.action === 'CREATE' || c.action === 'MODIFY') && !contentHash) {
    return null
  }

  return {
    mutationId: c.mutationId,
    path: c.path,
    action: c.action as PushCommand['action'],
    baseVersion: c.baseVersion,
    contentHash,
  }
}

/** 即使形狀驗證失敗，也盡量把 mutationId 撈出來，讓 pushResults 能對得上原始陣列位置。 */
export function extractMutationId(rawCommand: unknown): string | null {
  if (
    typeof rawCommand === 'object' &&
    rawCommand !== null &&
    typeof (rawCommand as Record<string, unknown>).mutationId === 'string' &&
    (rawCommand as Record<string, unknown>).mutationId !== ''
  ) {
    return (rawCommand as Record<string, unknown>).mutationId as string
  }
  return null
}
