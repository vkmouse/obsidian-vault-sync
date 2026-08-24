/**
 * 用人類可讀的 `name` 換到（或新建）對應的 `vaultId`。`vaultId` 全程由
 * 伺服器產生，呼叫端無法自訂或指定，避免呼叫端猜測或偽造別人的 vault 識別碼。
 */
import type { AuthContext, Env } from '../types'
import * as vaultRepository from '../repositories/vaultRepository'
import { validateVaultName } from '../utils/validation'

interface CreateVaultRequestBody {
  name?: unknown
}

interface CreateVaultResponse {
  vaultId: string
  name: string
  status: 'CREATED' | 'ALREADY_EXISTS'
}

export const onRequestPost: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const userId = context.data.userId as string

  let body: CreateVaultRequestBody
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Request body 必須是合法的 JSON' }, { status: 400 })
  }

  const name = validateVaultName(body?.name)
  if (name === null) {
    return Response.json({ error: 'name 長度必須介於 1 到 100 字元之間' }, { status: 400 })
  }

  // 先產生候選 UUID 再交給 insert 判斷是否要用：若同名 vault 已存在，
  // 這個值會被捨棄，避免多一次「查完再建」的往返。
  const candidateId = crypto.randomUUID()
  const inserted = await vaultRepository.insert(DB, candidateId, userId, name)

  if (inserted) {
    const response: CreateVaultResponse = {
      vaultId: inserted.id,
      name: inserted.name,
      status: 'CREATED',
    }
    return Response.json(response)
  }

  // 沒建立成功代表同名 vault 已存在（自己先前建的，或跟另一個併發請求撞名）。
  const existing = await vaultRepository.findByUserAndName(DB, userId, name)
  if (!existing) {
    // 理論上不會發生，出現代表資料庫狀態跟預期不一致，直接回錯讓呼叫端重試。
    return Response.json({ error: '無法解析既有的 vaultId' }, { status: 500 })
  }

  const response: CreateVaultResponse = {
    vaultId: existing.id,
    name,
    status: 'ALREADY_EXISTS',
  }
  return Response.json(response)
}
