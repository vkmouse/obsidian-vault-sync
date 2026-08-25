/** 回傳小寫十六進位字串，需與後端 content_hash 欄位的格式驗證一致。 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', data);
	const bytes = new Uint8Array(digest);
	let hex = '';
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}
