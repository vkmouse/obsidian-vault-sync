import * as vaultRepository from '../repositories/vaultRepository'
import type { VaultRow } from '../repositories/vaultRepository'
import { validateVaultName } from '../utils/validation'

export type ResolveVaultResult =
  | { status: 'created'; row: VaultRow }
  | { status: 'joined'; row: VaultRow }
  | { status: 'invalid' }

/**
 * 撞名時不判失敗：(user_id, name) 是複合唯一鍵，只可能撞到同一個使用者
 * 名下已存在的 vault，等同「另一台裝置已建立過，這次當加入」。
 */
export async function resolve(
  db: D1Database,
  userId: string,
  name: unknown,
  candidateId: string,
): Promise<ResolveVaultResult> {
  const validName = validateVaultName(name)
  if (validName === null) {
    return { status: 'invalid' }
  }

  const row = await vaultRepository.insert(db, candidateId, userId, validName)
  if (row) {
    return { status: 'created', row }
  }

  const existing = await vaultRepository.findByUserAndName(db, userId, validName)
  if (!existing) {
    // 理論上不會發生（撞了 unique constraint 卻查不到那一列），防呆當失敗處理。
    return { status: 'invalid' }
  }
  return { status: 'joined', row: existing }
}
