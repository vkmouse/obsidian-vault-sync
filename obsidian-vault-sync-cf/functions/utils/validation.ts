import type { EntityType, PushCommand } from '../types'

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

const ENTITY_TYPES = new Set<EntityType>(['VAULT', 'FILE'])

/** 只驗證外殼欄位；payload 內部形狀留給對應 entityType 的 Service 驗證。
 *  形狀不合法回傳 null（而非拋例外），讓呼叫端直接判 ERROR。 */
export function validateCommandShape(command: unknown): PushCommand | null {
  if (typeof command !== 'object' || command === null) {
    return null
  }
  const c = command as Record<string, unknown>

  if (typeof c.mutationId !== 'string' || c.mutationId.length === 0) {
    return null
  }
  if (typeof c.entityType !== 'string' || !ENTITY_TYPES.has(c.entityType as EntityType)) {
    return null
  }
  if (typeof c.vaultId !== 'string' || c.vaultId.length === 0) {
    return null
  }
  if (typeof c.entityId !== 'string' || c.entityId.length === 0) {
    return null
  }
  if (typeof c.baseVersion !== 'number' || !Number.isInteger(c.baseVersion) || c.baseVersion < 0) {
    return null
  }
  if (typeof c.payload !== 'string' || c.payload.length === 0) {
    return null
  }

  return {
    mutationId: c.mutationId,
    entityType: c.entityType as EntityType,
    vaultId: c.vaultId,
    entityId: c.entityId,
    baseVersion: c.baseVersion,
    payload: c.payload,
  }
}

export function isStringOrNull(value: unknown): value is string | null {
  return value === null || value === undefined || typeof value === 'string'
}

export function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PayloadValidationError'
  }
}

export function parsePayloadJson(payloadJson: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch {
    throw new PayloadValidationError('payload 不是合法的 JSON 字串')
  }

  if (!isPlainObject(parsed)) {
    throw new PayloadValidationError('payload 必須是一個 JSON 物件')
  }

  return parsed
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
