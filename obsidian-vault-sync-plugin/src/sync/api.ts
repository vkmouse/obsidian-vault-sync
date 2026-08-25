import { requestUrl } from 'obsidian';
import type { SyncRequestBody, SyncResponseBody, UploadObjectResponse } from '../types';

export interface ApiCredentials {
	apiBaseUrl: string;
	accessClientId: string;
	accessClientSecret: string;
}

/** 一般性的 API 失敗（非 2xx）。 */
export class SyncApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'SyncApiError';
		this.status = status;
	}
}

function authHeaders(creds: ApiCredentials): Record<string, string> {
	return {
		'CF-Access-Client-Id': creds.accessClientId,
		'CF-Access-Client-Secret': creds.accessClientSecret,
	};
}

export async function uploadObject(
	creds: ApiCredentials,
	vaultId: string,
	contentHash: string,
	content: ArrayBuffer,
): Promise<UploadObjectResponse> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/${vaultId}/objects/${contentHash}`,
		method: 'PUT',
		headers: { ...authHeaders(creds), 'Content-Type': 'application/octet-stream' },
		body: content,
		throw: false,
	});
	if (res.status !== 200) {
		throw new SyncApiError(
			`PUT /api/vaults/${vaultId}/objects/${contentHash} 失敗，HTTP ${res.status}`,
			res.status,
		);
	}
	return res.json as UploadObjectResponse;
}

/** 回傳 null 代表 404（內容不存在），跟其他錯誤狀態區分開。 */
export async function downloadObject(
	creds: ApiCredentials,
	vaultId: string,
	contentHash: string,
): Promise<ArrayBuffer | null> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/${vaultId}/objects/${contentHash}`,
		method: 'GET',
		headers: authHeaders(creds),
		throw: false,
	});
	if (res.status === 404) {
		return null;
	}
	if (res.status !== 200) {
		throw new SyncApiError(
			`GET /api/vaults/${vaultId}/objects/${contentHash} 失敗，HTTP ${res.status}`,
			res.status,
		);
	}
	return res.arrayBuffer;
}

/** 使用者層級的全域佇列端點，不再帶 vaultId 路由參數：一次請求可橫跨多個 vault 的 command。 */
export async function postSync(
	creds: ApiCredentials,
	body: SyncRequestBody,
): Promise<SyncResponseBody> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/sync`,
		method: 'POST',
		headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		throw: false,
	});
	if (res.status !== 200) {
		throw new SyncApiError(`POST /api/sync 失敗，HTTP ${res.status}`, res.status);
	}
	return res.json as SyncResponseBody;
}
