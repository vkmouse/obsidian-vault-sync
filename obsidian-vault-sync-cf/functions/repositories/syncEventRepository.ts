import type { EntityType, PullEvent } from '../types'

interface SyncEventDbRow {
  id: number
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

export async function pullEvents(
  db: D1Database,
  vaultId: string,
  lastCursor: number,
  excludeMutationIds: string[],
): Promise<PullEvent[]> {
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

  return result.results.map(toPullEvent)
}

export async function getMaxCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT MAX(id) AS new_cursor FROM sync_events`)
    .first<{ new_cursor: number | null }>()
  return row?.new_cursor ?? 0
}
