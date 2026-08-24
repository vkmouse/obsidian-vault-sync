/**
 * 推送 metadata 變更 + 拉取增量事件。內容本身透過物件上傳端點先傳完，
 * 這裡只帶 contentHash，讓請求本體維持輕量。
 *
 * vaultId 的歸屬檢查放在這一支：版本檢查跟事件寫入本來就要查 D1，
 * 順便查一次 owner 不會多一種 round-trip 類型。
 */
import type { AuthContext, Env, PushCommand, PushResult, SyncRequestBody, SyncResponseBody } from '../../../types'
import * as fileRepository from '../../../repositories/fileRepository'
import * as syncEventRepository from '../../../repositories/syncEventRepository'
import * as vaultRepository from '../../../repositories/vaultRepository'
import { extractMutationId, validatePushCommand } from '../../../utils/validation'

type Params = 'vaultId'

export const onRequestPost: PagesFunction<Env, Params, AuthContext> = async (context) => {
  const { DB } = context.env
  const userId = context.data.userId as string
  const vaultId = context.params.vaultId as string

  // 存在但不是自己的 vault 視為越權（403），不存在則是單純查無此列（404）。
  const ownerUserId = await vaultRepository.findUserIdById(DB, vaultId)
  if (ownerUserId === null) {
    return Response.json({ error: '找不到這個 vaultId' }, { status: 404 })
  }
  if (ownerUserId !== userId) {
    return Response.json({ error: '這個 vaultId 不屬於目前的帳號' }, { status: 403 })
  }

  let body: SyncRequestBody
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Request body 必須是合法的 JSON' }, { status: 400 })
  }

  if (typeof body?.lastCursor !== 'number' || !Number.isInteger(body.lastCursor) || body.lastCursor < 0) {
    return Response.json({ error: 'lastCursor 必須是 >= 0 的整數' }, { status: 400 })
  }
  if (!Array.isArray(body.pushCommands)) {
    return Response.json({ error: '缺少 pushCommands 陣列' }, { status: 400 })
  }

  // 形狀不合法直接判 ERROR，不進入版本檢查；同時收集這次請求的所有
  // mutationId，供批次冪等性查詢與稍後排除自己剛推上去的事件使用。
  type ValidatedEntry = { ok: true; command: PushCommand } | { ok: false; result: PushResult }

  const requestMutationIds: string[] = []
  const validated: ValidatedEntry[] = body.pushCommands.map((raw: unknown) => {
    const extractedId = extractMutationId(raw)
    if (extractedId) {
      requestMutationIds.push(extractedId)
    }

    const command = validatePushCommand(raw)
    if (!command) {
      // 連 mutationId 都撈不出來，沒有識別碼可以回給呼叫端對應，只能佔位。
      return { ok: false, result: { mutationId: extractedId ?? 'unknown', status: 'ERROR' } }
    }
    return { ok: true, command }
  })

  // 一次查完整批 mutationId，不逐筆查。
  const validMutationIds = validated
    .filter((entry): entry is Extract<ValidatedEntry, { ok: true }> => entry.ok)
    .map((entry) => entry.command.mutationId)
  const duplicateMutationIds = await syncEventRepository.findExistingMutationIds(DB, validMutationIds)

  const pushResults: PushResult[] = []

  for (const entry of validated) {
    if (!entry.ok) {
      pushResults.push(entry.result)
      continue
    }

    const command = entry.command

    if (duplicateMutationIds.has(command.mutationId)) {
      pushResults.push({ mutationId: command.mutationId, status: 'SKIPPED' })
      continue
    }

    pushResults.push(await applyPushCommand(DB, vaultId, command))
  }

  // 一定要等 push 全部處理完才 pull，才能把這次 push 剛寫入的事件也涵蓋進去。
  const pullEvents = await syncEventRepository.pullEvents(DB, vaultId, body.lastCursor, requestMutationIds)

  const newCursor = await syncEventRepository.getMaxCursor(DB)

  const response: SyncResponseBody = { pushResults, newCursor, pullEvents }
  return Response.json(response)
}

async function applyPushCommand(
  db: D1Database,
  vaultId: string,
  command: PushCommand,
): Promise<PushResult> {
  const { mutationId, path, action, baseVersion } = command

  if (action === 'CREATE') {
    const created = await fileRepository.create(db, vaultId, path, command.contentHash as string)
    if (!created) {
      // 該 vault 內 path 已存在。
      return { mutationId, status: 'ERROR' }
    }
    await syncEventRepository.insertEvent(db, {
      vaultId,
      mutationId,
      path,
      action,
      version: created.version,
      contentHash: created.content_hash,
    })
    return { mutationId, status: 'OK' }
  }

  if (action === 'MODIFY') {
    const newVersion = baseVersion + 1
    const modified = await fileRepository.modify(
      db,
      vaultId,
      path,
      baseVersion,
      newVersion,
      command.contentHash as string,
    )
    if (!modified) {
      // 版本不吻合（baseVersion 過期），或該 path 不存在——first-write-wins。
      return { mutationId, status: 'SKIPPED' }
    }
    await syncEventRepository.insertEvent(db, {
      vaultId,
      mutationId,
      path,
      action,
      version: modified.version,
      contentHash: modified.content_hash,
    })
    return { mutationId, status: 'OK' }
  }

  const newVersion = baseVersion + 1
  const deleted = await fileRepository.softDelete(db, vaultId, path, baseVersion, newVersion)
  if (!deleted) {
    return { mutationId, status: 'SKIPPED' }
  }
  await syncEventRepository.insertEvent(db, {
    vaultId,
    mutationId,
    path,
    action,
    version: deleted.version,
    contentHash: null,
  })
  return { mutationId, status: 'OK' }
}
