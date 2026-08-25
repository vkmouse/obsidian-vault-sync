export interface VaultRow {
  id: string
  user_id: string
  name: string
  created_at: string
}

/**
 * 建立 vault；`id` 由呼叫端（client）先產生好的候選 UUID 傳入。同名 vault
 * 已存在時不寫入、回傳 `null`——撞名沒有 fallback 相容邏輯，直接視為這筆
 * VAULT command 失敗，交由呼叫端讓同批次引用同一個 vaultId 的 FILE
 * command 一起 ERROR。
 */
export async function insert(
  db: D1Database,
  id: string,
  userId: string,
  name: string,
): Promise<VaultRow | null> {
  return db
    .prepare(
      `INSERT INTO vaults (id, user_id, name)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, name) DO NOTHING
       RETURNING *`,
    )
    .bind(id, userId, name)
    .first<VaultRow>()
}

/**
 * 一次 batch 查出這批 vaultId 目前的 owner，供 sync.ts 初始化
 * vaultWritable map；查無此列的 vaultId 不會出現在回傳的 Map 裡。
 */
export async function findOwnersByIds(
  db: D1Database,
  vaultIds: string[],
): Promise<Map<string, string>> {
  if (vaultIds.length === 0) {
    return new Map()
  }

  const placeholders = vaultIds.map(() => '?').join(', ')
  const result = await db
    .prepare(`SELECT id, user_id FROM vaults WHERE id IN (${placeholders})`)
    .bind(...vaultIds)
    .all<{ id: string; user_id: string }>()

  return new Map(result.results.map((row) => [row.id, row.user_id]))
}
