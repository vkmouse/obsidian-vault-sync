import type { PushCommand } from '../types'
import * as vaultRepository from '../repositories/vaultRepository'
import type { VaultRow } from '../repositories/vaultRepository'
import * as syncEventService from './syncEventService'
import { validateVaultName } from '../utils/validation'

export type PutVaultResult =
  | { status: 'created'; row: VaultRow }
  | { status: 'joined'; row: VaultRow }
  | { status: 'invalid' }

/**
 * VAULT 只有 create 語意，沒有 update/delete，baseVersion 固定必須是 0。
 *
 * insert 撞名時不直接判失敗：(user_id, name) 是複合唯一鍵，撞名在 DB 層只
 * 可能撞到「同一個 userId」名下已經存在的 vault（不同使用者本來就不會撞同
 * 一列），所以撞名等同於「這其實是我自己另一台裝置已經建立好的 vault，這
 * 次當加入」，不需要另外查 owner 判斷是不是自己人。
 */
export async function put(
  db: D1Database,
  userId: string,
  command: PushCommand,
): Promise<PutVaultResult> {
  if (command.baseVersion !== 0) {
    return { status: 'invalid' }
  }

  const name = validateVaultName(command.entityId)
  if (name === null) {
    return { status: 'invalid' }
  }

  const row = await vaultRepository.insert(db, command.vaultId, userId, name)
  if (row) {
    await syncEventService.insert(db, {
      vaultId: command.vaultId,
      mutationId: command.mutationId,
      entityType: 'VAULT',
      entityId: name,
      version: 1,
      payload: { name: row.name },
    })
    return { status: 'created', row }
  }

  const existing = await vaultRepository.findByUserAndName(db, userId, name)
  if (!existing) {
    // 理論上不會發生（撞了 unique constraint 卻查不到那一列），防呆當失敗處理。
    return { status: 'invalid' }
  }
  return { status: 'joined', row: existing }
}
