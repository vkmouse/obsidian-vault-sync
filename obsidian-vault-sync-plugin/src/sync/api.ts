import { requestUrl } from 'obsidian';

export interface ApiCredentials {
	apiBaseUrl: string;
	accessClientId: string;
	accessClientSecret: string;
}

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

export interface ResolveVaultResponse {
	vaultId: string;
}

export async function postResolveVault(
	creds: ApiCredentials,
	name: string,
	candidateId: string,
): Promise<ResolveVaultResponse> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/resolve`,
		method: 'POST',
		headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, candidateId }),
		throw: false,
	});
	if (res.status !== 200) {
		throw new SyncApiError(`POST /api/vaults/resolve 失敗，HTTP ${res.status}`, res.status);
	}
	return res.json as ResolveVaultResponse;
}

/** 回傳上傳完成後遠端記錄的時間，供設定頁顯示「上次 push 時間」。 */
export async function uploadVaultBlob(creds: ApiCredentials, vaultId: string, zipBytes: ArrayBuffer): Promise<string> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/${vaultId}/blob`,
		method: 'PUT',
		headers: { ...authHeaders(creds), 'Content-Type': 'application/zip' },
		body: zipBytes,
		throw: false,
	});
	if (res.status !== 200) {
		throw new SyncApiError(`PUT /api/vaults/${vaultId}/blob 失敗，HTTP ${res.status}`, res.status);
	}
	return (res.json as { uploadedAt: string }).uploadedAt;
}

/** 回傳 null 代表遠端還沒有任何 blob（404），不是錯誤——代表這個 vault 從沒 push 過。 */
export async function downloadVaultBlob(creds: ApiCredentials, vaultId: string): Promise<ArrayBuffer | null> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/${vaultId}/blob`,
		method: 'GET',
		headers: authHeaders(creds),
		throw: false,
	});
	if (res.status === 404) {
		return null;
	}
	if (res.status !== 200) {
		throw new SyncApiError(`GET /api/vaults/${vaultId}/blob 失敗，HTTP ${res.status}`, res.status);
	}
	return res.arrayBuffer;
}

export interface BlobHead {
	lastModified: string | null;
}

/** 設定頁顯示「遠端上次更新於...」用，不需要真的下載整包內容。 */
export async function headVaultBlob(creds: ApiCredentials, vaultId: string): Promise<BlobHead | null> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/${vaultId}/blob`,
		method: 'HEAD',
		headers: authHeaders(creds),
		throw: false,
	});
	if (res.status === 404) {
		return null;
	}
	if (res.status !== 200) {
		throw new SyncApiError(`HEAD /api/vaults/${vaultId}/blob 失敗，HTTP ${res.status}`, res.status);
	}
	return { lastModified: res.headers['last-modified'] ?? null };
}
