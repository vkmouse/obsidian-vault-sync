export interface VaultRow {
  id: string
  user_id: string
  name: string
  created_at: string
}

/**
 * 建立 vault；`id` 由呼叫端先產生好的候選 UUID 傳入，同名 vault 已存在時
 * 不會真的寫入，回傳 `null`，交由呼叫端查詢既有記錄。
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

/** 同一使用者底下 name 唯一，最多一列，`.first()` 足夠。 */
export async function findByUserAndName(
  db: D1Database,
  userId: string,
  name: string,
): Promise<Pick<VaultRow, 'id'> | null> {
  return db
    .prepare(`SELECT id FROM vaults WHERE user_id = ? AND name = ?`)
    .bind(userId, name)
    .first<Pick<VaultRow, 'id'>>()
}
