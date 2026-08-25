import { enqueueVaultCreate } from './queue';
import type VaultSyncPlugin from '../main';

export class VaultNotConfiguredError extends Error {
	constructor() {
		super('尚未在設定畫面填入 Vault 名稱與 API 憑證');
		this.name = 'VaultNotConfiguredError';
	}
}

/**
 * 回傳值只保證「本地已經有一個候選 vaultId、且佇列裡已排了一筆待送出的
 * 建立指令」，不保證伺服器已經接受它——真正成不成功要等 runSync 送出
 * 後看 pushResult 才知道。
 *
 * resolvedVaultId／resolvedVaultName 在產生候選值的當下就寫入 settings，
 * 不等伺服器確認：若改成等確認才寫入，只要中途重試（例如網路失敗、app
 * 重啟），下次呼叫這裡都會判定成「尚未解析」而產生一個全新的候選 UUID，
 * 舊候選 id 底下已經在佇列裡排隊的 FILE command（vaultId 指向舊 id）就會
 * 永遠送不出去、變成孤兒。候選值只在收到明確的 ERROR（撞名）才會被清除
 * 重來，這個決定在 syncRunner.ts 的 applyBatchResponse 裡處理。
 */
export async function ensureVaultResolved(plugin: VaultSyncPlugin): Promise<string> {
	const { settings } = plugin;

	if (!settings.apiBaseUrl || !settings.accessClientId || !settings.accessClientSecret || !settings.vaultName) {
		throw new VaultNotConfiguredError();
	}

	if (settings.vaultName === settings.resolvedVaultName && settings.resolvedVaultId) {
		console.log(`[vault-sync] vaultId 沿用本地快取：${settings.resolvedVaultId}（name=${settings.vaultName}）`);
		return settings.resolvedVaultId;
	}

	const candidateId = crypto.randomUUID();
	console.log(
		`[vault-sync] 本地快取無效或名稱已變更，產生新候選 vaultId=${candidateId}（name=${settings.vaultName}）`,
	);

	settings.resolvedVaultId = candidateId;
	settings.resolvedVaultName = settings.vaultName;
	const state = plugin.getOrCreateVaultState(candidateId);
	enqueueVaultCreate(state, candidateId, settings.vaultName);
	await plugin.saveSettings();

	return candidateId;
}
