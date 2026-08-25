import type { EntityType, PullEvent } from '../types'

interface SyncEventDbRow {
  id: number
  vault_id: string
  mutation_id: string
  entity_type: string
  entity_id: string
  payload: string | null
  version: number
  created_at: string
}

function toPullEvent(row: SyncEventDbRow): PullEvent {
  return {
    id: row.id,
    vaultId: row.vault_id,
    mutationId: row.mutation_id,
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    version: row.version,
    payload: row.payload,
    createdAt: row.created_at,
  }
}

/** mutation_id 全域唯一，不加 vault_id 條件也不會跨 vault 誤判。 */
export async function findExistingMutationIds(
  db: D1Database,
  mutationIds: string[],
): Promise<Set<string>> {
  if (mutationIds.length === 0) {
    return new Set()
  }

  const placeholders = mutationIds.map(() => '?').join(', ')
  const result = await db
    .prepare(`SELECT mutation_id FROM sync_events WHERE mutation_id IN (${placeholders})`)
    .bind(...mutationIds)
    .all<{ mutation_id: string }>()

  return new Set(result.results.map((row) => row.mutation_id))
}

export interface InsertSyncEventInput {
  vaultId: string
  mutationId: string
  entityType: EntityType
  entityId: string
  payload: string | null
  version: number
}

export async function insert(db: D1Database, input: InsertSyncEventInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_events (vault_id, mutation_id, entity_type, entity_id, payload, version)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.vaultId,
      input.mutationId,
      input.entityType,
      input.entityId,
      input.payload,
      input.version,
    )
    .run()
}

/** cursor 是使用者層級的，一次撈出這個使用者名下所有 vault 的新事件，由 client 端自行過濾。 */
export async function pullEvents(
  db: D1Database,
  userId: string,
  lastCursor: number,
  excludeMutationIds: string[],
): Promise<PullEvent[]> {
  const excludeClause =
    excludeMutationIds.length > 0
      ? `AND se.mutation_id NOT IN (${excludeMutationIds.map(() => '?').join(', ')})`
      : ''

  const result = await db
    .prepare(
      `SELECT se.* FROM sync_events se
       JOIN vaults v ON v.id = se.vault_id
       WHERE v.user_id = ?
         AND se.id > ?
         ${excludeClause}
       ORDER BY se.id ASC`,
    )
    .bind(userId, lastCursor, ...excludeMutationIds)
    .all<SyncEventDbRow>()

  return result.results.map(toPullEvent)
}

/**
 * 「加入既有 vault」流程專用：忽略這台裝置的全域 lastCursor，直接把指定
 * vaultId 的完整歷史（從第一筆事件開始）撈出來。原因是 lastCursor 是這台
 * 裝置跨所有 vault 的全域游標，跟這個「剛加入、本地從沒同步過」的 vaultId
 * 完全無關——正常的增量 pull（se.id > lastCursor）會直接跳過它 id 比較小
 * 的歷史事件，永遠補不回來。
 */
export async function pullEventsForVaultIds(
  db: D1Database,
  vaultIds: string[],
  excludeMutationIds: string[],
): Promise<PullEvent[]> {
  if (vaultIds.length === 0) {
    return []
  }

  const vaultPlaceholders = vaultIds.map(() => '?').join(', ')
  const excludeClause =
    excludeMutationIds.length > 0
      ? `AND mutation_id NOT IN (${excludeMutationIds.map(() => '?').join(', ')})`
      : ''

  const result = await db
    .prepare(
      `SELECT * FROM sync_events
       WHERE vault_id IN (${vaultPlaceholders})
         ${excludeClause}
       ORDER BY id ASC`,
    )
    .bind(...vaultIds, ...excludeMutationIds)
    .all<SyncEventDbRow>()

  return result.results.map(toPullEvent)
}

export async function getMaxCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT MAX(id) AS new_cursor FROM sync_events`)
    .first<{ new_cursor: number | null }>()
  return row?.new_cursor ?? 0
}
