import type { PutEntityParams } from '../types'
import * as fileRepository from '../repositories/fileRepository'
import type { FileRow } from '../repositories/fileRepository'
import * as syncEventService from './syncEventService'
import { isBoolean, isStringOrNull, parsePayloadJson, PayloadValidationError } from '../utils/validation'

export interface FilePayload {
  contentHash: string | null
  isDeleted: boolean
}

const CONTENT_HASH_RE = /^[0-9a-f]{64}$/

/** isDeleted=true 時 contentHash 一律視為 null，即使帶了值也忽略，避免產生無意義的資料。 */
export function parseFilePayload(payloadJson: string): FilePayload {
  const raw = parsePayloadJson(payloadJson)

  if (!isBoolean(raw.isDeleted)) {
    throw new PayloadValidationError('payload.isDeleted 必須是 boolean')
  }
  if (raw.isDeleted) {
    return { contentHash: null, isDeleted: true }
  }

  if (!isStringOrNull(raw.contentHash) || raw.contentHash === null || !CONTENT_HASH_RE.test(raw.contentHash)) {
    throw new PayloadValidationError('payload.contentHash 必須是 64 字元的 SHA-256 hex 字串')
  }

  return { contentHash: raw.contentHash, isDeleted: false }
}

/** CREATE/MODIFY/DELETE 統一收斂在這裡：baseVersion===0 走 insert，否則走 update。 */
export async function put(db: D1Database, params: PutEntityParams): Promise<FileRow | null> {
  let payload: FilePayload
  try {
    payload = parseFilePayload(params.payloadJson)
  } catch {
    return null
  }

  const row =
    params.baseVersion === 0
      ? await fileRepository.insert(db, params.vaultId, params.entityId, payload)
      : await fileRepository.update(db, params.vaultId, params.entityId, params.baseVersion, payload)

  if (!row) {
    return null
  }

  // sync_events.payload 必須是 API-規格書第 7 節定義的 FilePayload 形狀
  // （camelCase：contentHash / isDeleted），不能直接塞 D1 的 FileRow——
  // 後者是 snake_case（content_hash / is_deleted），插件端用 camelCase
  // 解析會讀到 undefined，導致 isDeleted 恆為 true，把每筆 pull 都誤判成刪除。
  const eventPayload: FilePayload = {
    contentHash: row.content_hash,
    isDeleted: row.is_deleted === 1,
  }

  await syncEventService.insert(db, {
    vaultId: params.vaultId,
    mutationId: params.mutationId,
    entityType: 'FILE',
    entityId: params.entityId,
    version: row.version,
    payload: eventPayload,
  })

  return row
}
