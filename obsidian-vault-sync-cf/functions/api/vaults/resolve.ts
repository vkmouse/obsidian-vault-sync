import type { AuthContext, Env, ResolveVaultRequestBody, ResolveVaultResponseBody } from '../../types'
import * as vaultService from '../../services/vaultService'

export const onRequestPost: PagesFunction<Env, any, AuthContext> = async (context) => {
  const { DB } = context.env
  const userId = context.data.userId as string

  let body: ResolveVaultRequestBody
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Request body 必須是合法的 JSON' }, { status: 400 })
  }

  if (typeof body?.candidateId !== 'string' || body.candidateId.length === 0) {
    return Response.json({ error: '缺少 candidateId' }, { status: 400 })
  }

  const result = await vaultService.resolve(DB, userId, body.name, body.candidateId)
  if (result.status === 'invalid') {
    return Response.json({ error: 'name 不合法' }, { status: 400 })
  }

  const response: ResolveVaultResponseBody = { vaultId: result.row.id }
  return Response.json(response)
}
