import { requestUrl } from 'obsidian';
import type {
	CreateVaultResponse,
	SyncRequestBody,
	SyncResponseBody,
	UploadObjectResponse,
} from '../types';

export interface ApiCredentials {
	apiBaseUrl: string;
	accessClientId: string;
	accessClientSecret: string;
}

/** 一般性的 API 失敗（非 2xx、非下面特別處理的狀態碼）。 */
export class SyncApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = 'SyncApiError';
		this.status = status;
	}
}

/** 收到「vault 不屬於你」的 403；代表本地快取的 vaultId 已經失效。 */
export class VaultForbiddenError extends Error {
	constructor() {
		super('這個 vaultId 不屬於目前的帳號');
		this.name = 'VaultForbiddenError';
	}
}

function authHeaders(creds: ApiCredentials): Record<string, string> {
	return {
		'CF-Access-Client-Id': creds.accessClientId,
		'CF-Access-Client-Secret': creds.accessClientSecret,
	};
}

export async function createOrResolveVault(
	creds: ApiCredentials,
	name: string,
): Promise<CreateVaultResponse> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults`,
		method: 'POST',
		headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
		body: JSON.stringify({ name }),
		throw: false,
	});
	if (res.status !== 200) {
		throw new SyncApiError(`POST /api/vaults 失敗，HTTP ${res.status}`, res.status);
	}
	return res.json as CreateVaultResponse;
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

export async function postSync(
	creds: ApiCredentials,
	vaultId: string,
	body: SyncRequestBody,
): Promise<SyncResponseBody> {
	const res = await requestUrl({
		url: `${creds.apiBaseUrl}/api/vaults/${vaultId}/sync`,
		method: 'POST',
		headers: { ...authHeaders(creds), 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
		throw: false,
	});
	if (res.status === 403) {
		throw new VaultForbiddenError();
	}
	if (res.status !== 200) {
		throw new SyncApiError(`POST /api/vaults/${vaultId}/sync 失敗，HTTP ${res.status}`, res.status);
	}
	return res.json as SyncResponseBody;
}
