import type { EntityType, PullEvent } from '../types'
import * as syncEventRepository from '../repositories/syncEventRepository'

export async function findExistingMutationIds(
  db: D1Database,
  mutationIds: string[],
): Promise<Set<string>> {
  return syncEventRepository.findExistingMutationIds(db, mutationIds)
}

export async function pullEvents(
  db: D1Database,
  vaultId: string,
  lastCursor: number,
  excludeMutationIds: string[],
): Promise<PullEvent[]> {
  return syncEventRepository.pullEvents(db, vaultId, lastCursor, excludeMutationIds)
}

export async function getMaxCursor(db: D1Database): Promise<number> {
  return syncEventRepository.getMaxCursor(db)
}

export interface RecordEventInput {
  vaultId: string
  mutationId: string
  entityType: EntityType
  entityId: string
  version: number
  /** 業務表 RETURNING 出來的完整 row；由這裡統一 JSON.stringify。 */
  payload: unknown
}

export async function insert(db: D1Database, input: RecordEventInput): Promise<void> {
  await syncEventRepository.insert(db, {
    vaultId: input.vaultId,
    mutationId: input.mutationId,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: JSON.stringify(input.payload),
    version: input.version,
  })
}
