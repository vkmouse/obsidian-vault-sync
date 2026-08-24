export interface FileRow {
  vault_id: string
  path: string
  version: number
  content_hash: string | null
  is_deleted: number
  updated_at: string
}

/** path 已存在時不寫入，回傳 null。 */
export async function create(
  db: D1Database,
  vaultId: string,
  path: string,
  contentHash: string,
): Promise<FileRow | null> {
  return db
    .prepare(
      `INSERT INTO files (vault_id, path, version, content_hash, is_deleted)
       VALUES (?, ?, 1, ?, 0)
       ON CONFLICT (vault_id, path) DO NOTHING
       RETURNING *`,
    )
    .bind(vaultId, path, contentHash)
    .first<FileRow>()
}

/**
 * 版本檢查跟更新合成一句 SQL（`WHERE version = baseVersion`），不用另外
 * 開 transaction 或多查一次確認版本。版本不吻合或 path 不存在時回傳 null。
 */
export async function modify(
  db: D1Database,
  vaultId: string,
  path: string,
  baseVersion: number,
  newVersion: number,
  contentHash: string,
): Promise<FileRow | null> {
  return db
    .prepare(
      `UPDATE files
       SET version = ?, content_hash = ?, updated_at = CURRENT_TIMESTAMP
       WHERE vault_id = ?
         AND path = ?
         AND version = ?
       RETURNING *`,
    )
    .bind(newVersion, contentHash, vaultId, path, baseVersion)
    .first<FileRow>()
}

/** 軟刪除，同樣以版本比對防止覆蓋掉較新的變更；不吻合或 path 不存在時回傳 null。 */
export async function softDelete(
  db: D1Database,
  vaultId: string,
  path: string,
  baseVersion: number,
  newVersion: number,
): Promise<FileRow | null> {
  return db
    .prepare(
      `UPDATE files
       SET is_deleted = 1, content_hash = NULL, version = ?, updated_at = CURRENT_TIMESTAMP
       WHERE vault_id = ?
         AND path = ?
         AND version = ?
       RETURNING *`,
    )
    .bind(newVersion, vaultId, path, baseVersion)
    .first<FileRow>()
}
