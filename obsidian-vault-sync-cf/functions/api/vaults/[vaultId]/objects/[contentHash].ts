/**
 * 上傳/下載檔案內容本身。刻意不查 D1 確認 `vaultId` 是否屬於發起請求的人,
 * 純粹依 path 組出 R2 key 直接讀寫——這兩支是高頻操作，多一次 D1 查詢的
 * 延遲會被放大很多倍。代價是：只要有合法帳號、且知道別人的 vaultId 與
 * 確切 contentHash，就能下載到內容（但列不出有哪些 hash 存在，也拿不到
 * 檔名等 metadata），是已知並接受的風險。
 */
import type { AuthContext, Env } from '../../../../types'
import { sha256Hex } from '../../../../utils/hash'

type Params = 'vaultId' | 'contentHash'

interface UploadObjectResponse {
  contentHash: string
  status: 'CREATED' | 'ALREADY_EXISTS'
}

function objectKey(vaultId: string, contentHash: string): string {
  return `objects/${vaultId}/${contentHash}`
}

/** 上傳檔案內容本身。 */
export const onRequestPut: PagesFunction<Env, Params, AuthContext> = async (context) => {
  const { BUCKET } = context.env
  const vaultId = context.params.vaultId as string
  const contentHash = context.params.contentHash as string

  const body = await context.request.arrayBuffer()

  // 重新算一次 hash 而不是信任路徑參數，避免收到跟內容不符的 contentHash
  // 而寫入一筆日後永遠對不上的物件。
  const actualHash = await sha256Hex(body)
  if (actualHash !== contentHash) {
    return Response.json({ error: 'contentHash 與內容實際的 SHA-256 不符' }, { status: 400 })
  }

  // 同一份內容可能被重複上傳（多裝置、重試等），已存在就跳過寫入，
  // 讓這個端點永遠可以安全地重複呼叫。put() 在條件不成立時回傳 null。
  const putResult = await BUCKET.put(objectKey(vaultId, contentHash), body, {
    onlyIf: { etagDoesNotMatch: '*' },
  })

  const response: UploadObjectResponse = {
    contentHash,
    status: putResult ? 'CREATED' : 'ALREADY_EXISTS',
  }
  return Response.json(response)
}

/** 下載檔案內容本身。 */
export const onRequestGet: PagesFunction<Env, Params, AuthContext> = async (context) => {
  const { BUCKET } = context.env
  const vaultId = context.params.vaultId as string
  const contentHash = context.params.contentHash as string

  const object = await BUCKET.get(objectKey(vaultId, contentHash))

  if (!object) {
    return new Response(null, { status: 404 })
  }

  return new Response(object.body, {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
}
