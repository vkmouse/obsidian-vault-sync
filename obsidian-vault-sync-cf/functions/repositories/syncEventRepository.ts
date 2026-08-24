import type { SyncAction, SyncEventRow } from '../types'

interface SyncEventDbRow {
  id: number
  mutation_id: string
  path: string
  action: string
  version: number
  content_hash: string | null
  created_at: string
}

function toSyncEventRow(row: SyncEventDbRow): SyncEventRow {
  return {
    id: row.id,
    mutationId: row.mutation_id,
    path: row.path,
    action: row.action as SyncAction,
    version: row.version,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  }
}

/**
 * 一次查完整批 mutationId，不逐筆查。不加 vault_id 條件是因為 mutation_id
 * 全域唯一（UUID），跨 vault 也不會誤判，沒必要多帶一個條件。
 * mutationIds 為空陣列時直接回傳空 Set，避免產生不合法的 `IN ()` SQL。
 */
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

export async function insertEvent(
  db: D1Database,
  params: {
    vaultId: string
    mutationId: string
    path: string
    action: SyncAction
    version: number
    contentHash: string | null
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sync_events (vault_id, mutation_id, path, action, version, content_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.vaultId,
      params.mutationId,
      params.path,
      params.action,
      params.version,
      params.contentHash,
    )
    .run()
}

/**
 * 排除本次請求自己送出的 mutationId，避免推上去的事件被原封不動拉回來。
 * excludeMutationIds 為空時省略 NOT IN 條件，避免產生不合法的 `NOT IN ()`。
 */
export async function pullEvents(
  db: D1Database,
  vaultId: string,
  lastCursor: number,
  excludeMutationIds: string[],
): Promise<SyncEventRow[]> {
  const excludeClause =
    excludeMutationIds.length > 0
      ? `AND mutation_id NOT IN (${excludeMutationIds.map(() => '?').join(', ')})`
      : ''

  const result = await db
    .prepare(
      `SELECT * FROM sync_events
       WHERE vault_id = ?
         AND id > ?
         ${excludeClause}
       ORDER BY id ASC`,
    )
    .bind(vaultId, lastCursor, ...excludeMutationIds)
    .all<SyncEventDbRow>()

  return result.results.map(toSyncEventRow)
}

/** 全域最大 id，不依 vault_id 過濾——client 下次 pull 一樣會用 vault_id 篩掉無關的事件，但可以少帶一個條件。 */
export async function getMaxCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT MAX(id) AS new_cursor FROM sync_events`)
    .first<{ new_cursor: number | null }>()
  return row?.new_cursor ?? 0
}
