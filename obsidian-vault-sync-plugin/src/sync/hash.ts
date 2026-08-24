/**
 * Client-規格書第 7 節：contentHash 一律是 SHA-256、小寫十六進位字串、固定 64 字元。
 * 見第 8.1 節：用 `crypto.subtle.digest('SHA-256', ...)` 取得 digest 後轉為 hex。
 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}
