/**
 * 推送 metadata 變更 + 拉取增量事件。內容透過物件上傳端點先傳完，這裡
 * 只帶 payload（含 contentHash），讓請求本體維持輕量。
 *
 * vaultId 的歸屬檢查放在這一支：版本檢查跟事件寫入本來就要查 D1，
 * 順便查一次 owner 不會多一種 round-trip 類型。
 */
import type {
  AuthContext,
  Env,
  EntityType,
  PushCommand,
  PushResult,
  PutEntityHandler,
  SyncRequestBody,
  SyncResponseBody,
} from '../../../types'
import * as fileService from '../../../services/fileService'
import * as syncEventService from '../../../services/syncEventService'
import * as vaultRepository from '../../../repositories/vaultRepository'
import { extractMutationId, validateCommandShape } from '../../../utils/validation'

type Params = 'vaultId'

/** entityType -> Service.put，即使目前只有一種也做成 map，方便未來加新的可同步實體。 */
const handlerMap: Record<EntityType, PutEntityHandler> = {
  FILE: fileService.put,
}

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

  type ValidatedEntry = { ok: true; command: PushCommand } | { ok: false; result: PushResult }

  const requestMutationIds: string[] = []
  const validated: ValidatedEntry[] = body.pushCommands.map((raw: unknown) => {
    const extractedId = extractMutationId(raw)
    if (extractedId) {
      requestMutationIds.push(extractedId)
    }

    const command = validateCommandShape(raw)
    if (!command) {
      return { ok: false, result: { mutationId: extractedId ?? 'unknown', status: 'ERROR' } }
    }
    return { ok: true, command }
  })

  const validMutationIds = validated
    .filter((entry): entry is Extract<ValidatedEntry, { ok: true }> => entry.ok)
    .map((entry) => entry.command.mutationId)
  const duplicateMutationIds = await syncEventService.findExistingMutationIds(DB, validMutationIds)

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

    const handler = handlerMap[command.entityType]
    if (!handler) {
      pushResults.push({ mutationId: command.mutationId, status: 'ERROR' })
      continue
    }

    const result = await handler(DB, {
      vaultId,
      entityId: command.entityId,
      baseVersion: command.baseVersion,
      mutationId: command.mutationId,
      payloadJson: command.payload,
    })
    pushResults.push({ mutationId: command.mutationId, status: result === null ? 'ERROR' : 'OK' })
  }

  // 一定要等 push 全部處理完才 pull，才能把這次 push 剛寫入的事件也涵蓋進去。
  const pullEvents = await syncEventService.pullEvents(DB, vaultId, body.lastCursor, requestMutationIds)

  const newCursor = await syncEventService.getMaxCursor(DB)

  const response: SyncResponseBody = { pushResults, newCursor, pullEvents }
  return Response.json(response)
}
