/**
 * 整包 vault zip 的 push/pull/HEAD。跟舊的 objects/[contentHash] 端點刻意
 * 跳過 ownership 檢查相反：這裡一次動整個 vault、且是低頻手動操作，敏感度
 * 和頻率都反過來了，每次都查 D1 確認 vaultId 屬於發起請求的使用者。
 */
import type { AuthContext, Env, UploadBlobResponseBody } from '../../../types'
import * as vaultRepository from '../../../repositories/vaultRepository'

type Params = 'vaultId'

function blobKey(vaultId: string): string {
  return `vaults/${vaultId}.zip`
}

/** null：vaultId 不存在（回 404）；false：存在但不屬於這個使用者（回 403）。 */
async function checkOwnership(
  db: D1Database,
  userId: string,
  vaultId: string,
): Promise<boolean | null> {
  const owners = await vaultRepository.findOwnersByIds(db, [vaultId])
  const owner = owners.get(vaultId)
  if (owner === undefined) {
    return null
  }
  return owner === userId
}

function ownershipErrorResponse(owned: boolean | null): Response {
  return new Response(null, { status: owned === null ? 404 : 403 })
}

export const onRequestPut: PagesFunction<Env, Params, AuthContext> = async (context) => {
  const { DB, BUCKET } = context.env
  const userId = context.data.userId as string
  const vaultId = context.params.vaultId as string

  const owned = await checkOwnership(DB, userId, vaultId)
  if (!owned) {
    return ownershipErrorResponse(owned)
  }

  const body = await context.request.arrayBuffer()
  const object = await BUCKET.put(blobKey(vaultId), body)

  const response: UploadBlobResponseBody = { status: 'OK', uploadedAt: object.uploaded.toISOString() }
  return Response.json(response)
}

export const onRequestGet: PagesFunction<Env, Params, AuthContext> = async (context) => {
  const { DB, BUCKET } = context.env
  const userId = context.data.userId as string
  const vaultId = context.params.vaultId as string

  const owned = await checkOwnership(DB, userId, vaultId)
  if (!owned) {
    return ownershipErrorResponse(owned)
  }

  const object = await BUCKET.get(blobKey(vaultId))
  if (!object) {
    return new Response(null, { status: 404 })
  }

  return new Response(object.body, {
    status: 200,
    headers: { 'Content-Type': 'application/zip' },
  })
}

export const onRequestHead: PagesFunction<Env, Params, AuthContext> = async (context) => {
  const { DB, BUCKET } = context.env
  const userId = context.data.userId as string
  const vaultId = context.params.vaultId as string

  const owned = await checkOwnership(DB, userId, vaultId)
  if (!owned) {
    return ownershipErrorResponse(owned)
  }

  const object = await BUCKET.head(blobKey(vaultId))
  if (!object) {
    return new Response(null, { status: 404 })
  }

  return new Response(null, {
    status: 200,
    headers: {
      'Content-Length': String(object.size),
      'Last-Modified': object.uploaded.toUTCString(),
    },
  })
}
