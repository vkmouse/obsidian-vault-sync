/**
 * 使用者層級的全域同步佇列：一次 request 可橫跨多個 vault 的 push command，
 * pull 也回傳這個使用者名下所有 vault 的新事件，由 client 端自行過濾。
 *
 * vaultId 的歸屬檢查不再是整個 request 403，而是逐 vaultId 判定「這批
 * command 能不能寫」（vaultWritable），owner 對不上的只讓涉及該 vaultId
 * 的 command 個別 ERROR，見下方 resolveVaultOwnership 的說明。
 */
import type {
  AuthContext,
  Env,
  PushCommand,
  PushResult,
  SyncRequestBody,
  SyncResponseBody,
} from '../types'
import * as fileService from '../services/fileService'
import * as vaultService from '../services/vaultService'
import * as syncEventService from '../services/syncEventService'
import * as vaultRepository from '../repositories/vaultRepository'
import { extractMutationId, validateCommandShape } from '../utils/validation'

type ValidatedEntry = { ok: true; command: PushCommand } | { ok: false; result: PushResult }

interface VaultOwnershipState {
  /** 已存在且屬於自己 → true；已存在但屬於別人、或尚不存在 → false。 */
  writable: Map<string, boolean>
  /** 這批 vaultId 裡，資料庫裡已經有列的（無論屬於誰），VAULT command 對這些 id 不能再 INSERT。 */
  preExisting: Set<string>
}

async function resolveVaultOwnership(
  db: D1Database,
  userId: string,
  vaultIds: Set<string>,
): Promise<VaultOwnershipState> {
  const owners = await vaultRepository.findOwnersByIds(db, [...vaultIds])
  const writable = new Map<string, boolean>()
  const preExisting = new Set<string>()
  for (const vaultId of vaultIds) {
    if (owners.has(vaultId)) {
      preExisting.add(vaultId)
    }
    writable.set(vaultId, owners.get(vaultId) === userId)
  }
  return { writable, preExisting }
}

export const onRequestPost: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const userId = context.data.userId as string

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

  const validCommands = validated
    .filter((entry): entry is Extract<ValidatedEntry, { ok: true }> => entry.ok)
    .map((entry) => entry.command)

  const duplicateMutationIds = await syncEventService.findExistingMutationIds(
    DB,
    validCommands.map((command) => command.mutationId),
  )

  const referencedVaultIds = new Set(validCommands.map((command) => command.vaultId))
  // preExisting 另外記錄一份：vaultId 是 PRIMARY KEY，對已存在的 id 重複
  // INSERT 會撞主鍵，跟 insert() 目前處理的「同名撞號」是不同的衝突種類，
  // 所以 VAULT command 要先擋在 INSERT 之前，不能單靠 writable 判斷。
  const { writable: vaultWritable, preExisting: preExistingVaultIds } = await resolveVaultOwnership(
    DB,
    userId,
    referencedVaultIds,
  )

  const pushResults: PushResult[] = []

  // 「加入既有 vault」時，client 送來的候選 UUID 要導向伺服器上真正的
  // vaultId：這批次裡任何引用候選 id 的 FILE command 都要改寫成真正 id 才能
  // 正確寫入／檢查歸屬；真正 id 也要標成 writable，因為它不在原本
  // referencedVaultIds（候選 id）算出來的 vaultWritable 裡。joinedVaultIds
  // 則供最後的全歷史補課 pull 使用。
  const vaultIdRemap = new Map<string, string>()
  const joinedVaultIds = new Set<string>()

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

    if (command.entityType === 'VAULT') {
      if (preExistingVaultIds.has(command.vaultId)) {
        pushResults.push({ mutationId: command.mutationId, status: 'ERROR' })
        continue
      }
      const result = await vaultService.put(DB, userId, command)
      if (result.status === 'invalid') {
        pushResults.push({ mutationId: command.mutationId, status: 'ERROR' })
        continue
      }
      if (result.status === 'created') {
        vaultWritable.set(command.vaultId, true)
        pushResults.push({ mutationId: command.mutationId, status: 'OK' })
        continue
      }
      // result.status === 'joined'
      vaultIdRemap.set(command.vaultId, result.row.id)
      vaultWritable.set(result.row.id, true)
      joinedVaultIds.add(result.row.id)
      pushResults.push({ mutationId: command.mutationId, status: 'OK', resolvedVaultId: result.row.id })
      continue
    }

    // entityType === 'FILE'：候選 vaultId 若已被上面的 VAULT command 判定為
    // 「加入」，導向真正的 vaultId 再判斷 writable、再寫入。
    const effectiveVaultId = vaultIdRemap.get(command.vaultId) ?? command.vaultId
    if (!vaultWritable.get(effectiveVaultId)) {
      pushResults.push({ mutationId: command.mutationId, status: 'ERROR' })
      continue
    }

    const row = await fileService.put(DB, {
      vaultId: effectiveVaultId,
      entityId: command.entityId,
      baseVersion: command.baseVersion,
      mutationId: command.mutationId,
      payloadJson: command.payload,
    })
    pushResults.push({ mutationId: command.mutationId, status: row ? 'OK' : 'ERROR' })
  }

  // 一定要等 push 全部處理完才 pull，才能把這次 push 剛寫入的事件也涵蓋進去。
  const pullEvents = await syncEventService.pullEvents(DB, userId, body.lastCursor, requestMutationIds)

  // 本次有加入既有 vault：無視 lastCursor，把該 vaultId 的完整歷史併入同一個
  // response，跟正常增量 pull 依 id 去重、合併排序，client 端不用再另外發
  // 一次請求就能補齊 fileVersions。
  if (joinedVaultIds.size > 0) {
    const backfill = await syncEventService.pullEventsForVaultIds(DB, [...joinedVaultIds], requestMutationIds)
    const seenIds = new Set(pullEvents.map((e) => e.id))
    for (const event of backfill) {
      if (!seenIds.has(event.id)) {
        pullEvents.push(event)
        seenIds.add(event.id)
      }
    }
    pullEvents.sort((a, b) => a.id - b.id)
  }

  const newCursor = await syncEventService.getMaxCursor(DB)

  const response: SyncResponseBody = { pushResults, newCursor, pullEvents }
  return Response.json(response)
}
