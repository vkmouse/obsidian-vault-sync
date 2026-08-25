import { zipSync, unzipSync } from 'fflate';

export interface ZipEntry {
	path: string;
	data: Uint8Array;
}

export function packZip(entries: ZipEntry[]): Uint8Array {
	const files: Record<string, Uint8Array> = {};
	for (const entry of entries) {
		files[entry.path] = entry.data;
	}
	return zipSync(files);
}

/** 資料夾在 zip 裡是路徑以 '/' 結尾的空條目，過濾掉、只留實際檔案。 */
export function unpackZip(zipBytes: Uint8Array): ZipEntry[] {
	const files = unzipSync(zipBytes);
	return Object.entries(files)
		.filter(([path]) => !path.endsWith('/'))
		.map(([path, data]) => ({ path, data }));
}

/** requestUrl 的 body 需要真正的 ArrayBuffer；Uint8Array 可能是更大 buffer 的一段切片。 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
