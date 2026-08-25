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
 * 建立指令」，不保證伺服器已經接受它。
 *
 * resolvedVaultId／resolvedVaultName 在產生候選值的當下就寫入 settings，
 * 不等伺服器確認：若改成等確認才寫入，只要中途重試（例如網路失敗、app
 * 重啟），下次呼叫這裡都會判定成「尚未解析」而產生一個全新的候選 UUID，
 * 舊候選 id 底下已經在佇列裡排隊的 FILE command（vaultId 指向舊 id）就會
 * 永遠送不出去、變成孤兒。候選值只在收到明確的 ERROR（名稱不合法等真正的
 * 建立失敗）才會被清除重來——撞到自己另一台裝置的既有 vault 不算 ERROR，
 * 後端會回 OK + resolvedVaultId，由 syncRunner 負責把候選值換成真正的 id，
 * 見 syncRunner.ts 裡對 resolvedVaultId 的處理。
 *
 * syncQueue／fileVersions 只保存單一 vaultId 的狀態：換到新候選值時一併
 * 清空，屬於舊 vaultId 那些還沒送出去的 FILE command 直接捨棄，不遷移過
 * 去——這台裝置從這一刻起只在意新的 vaultId，其餘一律視同不存在。
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
	settings.syncQueue = [];
	settings.fileVersions = {};
	enqueueVaultCreate(settings, candidateId, settings.vaultName);
	await plugin.saveSettings();

	return candidateId;
}
