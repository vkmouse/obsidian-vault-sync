import type { PushCommand } from '../types'
import * as vaultRepository from '../repositories/vaultRepository'
import type { VaultRow } from '../repositories/vaultRepository'
import * as syncEventService from './syncEventService'
import { validateVaultName } from '../utils/validation'

/** VAULT 只有 create 語意，沒有 update/delete，baseVersion 固定必須是 0。 */
export async function put(
  db: D1Database,
  userId: string,
  command: PushCommand,
): Promise<VaultRow | null> {
  if (command.baseVersion !== 0) {
    return null
  }

  const name = validateVaultName(command.entityId)
  if (name === null) {
    return null
  }

  const row = await vaultRepository.insert(db, command.vaultId, userId, name)
  if (!row) {
    return null
  }

  await syncEventService.insert(db, {
    vaultId: command.vaultId,
    mutationId: command.mutationId,
    entityType: 'VAULT',
    entityId: name,
    version: 1,
    payload: { name: row.name },
  })

  return row
}
