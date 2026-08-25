import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type VaultSyncPlugin from './main';
import type { PluginData } from './types';
import { runSync } from './sync/syncRunner';
import { DEBOUNCE_MS } from './sync/queue';

export const DEFAULT_SETTINGS: PluginData = {
	accessClientId: '',
	accessClientSecret: '',
	apiBaseUrl: '',
	vaultName: '',
	resolvedVaultId: null,
	resolvedVaultName: null,
	lastCursor: 0,
	syncQueue: [],
	fileVersions: {},
};

/** 需與後端的名稱長度限制一致，否則本地驗證通過但送出去仍會被拒。 */
export function isValidVaultName(name: string): boolean {
	return name.length >= 1 && name.length <= 100;
}

export class VaultSyncSettingTab extends PluginSettingTab {
	plugin: VaultSyncPlugin;
	/** 改名欄位的 debounce 計時器；同一個 SettingTab 實例在分頁開關之間會被重用，所以放在實例欄位上。 */
	private renameDebounceHandle: number | null = null;

	constructor(app: App, plugin: VaultSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 使用者切出設定頁時，如果改名的 debounce 還沒跑完，立刻把確認提示跳出來，
	 * 避免最後一次修改被吃掉（只是提前跳提示讓使用者決定，不會自動套用變更）。
	 */
	hide(): void {
		if (this.renameDebounceHandle !== null) {
			window.clearTimeout(this.renameDebounceHandle);
			this.renameDebounceHandle = null;
			this.promptRenameConfirmIfChanged();
		}
	}

	/** 改名文字停手 DEBOUNCE_MS 後呼叫，沿用 queue.ts 檔案事件的同一個常數，跟其他 debounce 行為一致。 */
	private scheduleRenameConfirm(): void {
		if (this.renameDebounceHandle !== null) {
			window.clearTimeout(this.renameDebounceHandle);
		}
		this.renameDebounceHandle = window.setTimeout(() => {
			this.renameDebounceHandle = null;
			this.promptRenameConfirmIfChanged();
		}, DEBOUNCE_MS);
	}

	/**
	 * 名稱跟目前已綁定的 resolvedVaultName 不同才跳確認提示；相同（例如打完又改回去）就安靜結束，
	 * 不打擾使用者。提示上的「確定」不會立刻套用變更，只有按下去才會真的產生新 vaultId、清空佇列並同步，
	 * 讓打錯字或改到一半都不會誤觸資料清空。
	 */
	private promptRenameConfirmIfChanged(): void {
		const { settings } = this.plugin;
		if (settings.vaultName === settings.resolvedVaultName) return;
		if (!isValidVaultName(settings.vaultName)) return; // 防呆：理論上 onChange 已經擋掉非法值

		// 快照這次要確認的名稱：如果使用者在按下「確定」之前又改了名稱（此時新的
		// debounce 週期會另外跳一個新提示），這個舊提示按下去要能認出自己已經過期、
		// 安靜略過，而不是套用一個使用者已經不要的舊名稱。
		const targetName = settings.vaultName;

		let notice: Notice;
		const fragment = createFragment((el) => {
			el.createSpan({
				text: `Vault Sync：Vault 名稱已改為「${targetName}」，確定要套用並嘗試同步嗎？`,
			});
			el.createEl('br');
			const button = el.createEl('button', { text: '確定', cls: 'vault-sync-notice-confirm-button' });
			button.addEventListener('click', () => {
				notice.hide();
				if (this.plugin.settings.vaultName !== targetName) return; // 名稱在等待確認時又被改了，這個提示已過期
				void runSync(this.plugin);
			});
		});
		notice = new Notice(fragment, 0); // duration=0：不自動消失，等使用者按下確定或自行關閉
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('API base URL')
			.setDesc('Cloudflare Pages 專案的網域，例如 https://obsidian-vault-sync-cf.pages.dev（結尾不要加斜線）。')
			.addText((text) =>
				text
					.setPlaceholder('https://your-project.pages.dev')
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value.trim().replace(/\/+$/, '');
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('CF-Access-Client-Id')
			.setDesc('Cloudflare Access Service Token 的 Client Id。')
			.addText((text) =>
				text
					.setPlaceholder('Client Id')
					.setValue(this.plugin.settings.accessClientId)
					.onChange(async (value) => {
						this.plugin.settings.accessClientId = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('CF-Access-Client-Secret')
			.setDesc('Cloudflare Access Service Token 的 Client Secret。同一組憑證可以裝在多台裝置上使用。')
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Client Secret')
					.setValue(this.plugin.settings.accessClientSecret)
					.onChange(async (value) => {
						this.plugin.settings.accessClientSecret = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Vault 名稱')
			.setDesc(
				'人類可讀的名稱（1–100 字元），用來在伺服器端換到真正的 vaultId。停止輸入後會跳出確認提示，按下確定才會真正套用並嘗試同步。',
			)
			.addText((text) =>
				text
					.setPlaceholder('例如：work、我的筆記')
					.setValue(this.plugin.settings.vaultName)
					.onChange(async (value) => {
						if (!isValidVaultName(value)) {
							new Notice('Vault 名稱長度必須介於 1 到 100 字元之間，未儲存這次修改。');
							text.setValue(this.plugin.settings.vaultName);
							return;
						}
						// 只存純文字，不動 resolvedVaultId／佇列；每個字都會觸發這裡，
						// 真正的 resolve 邏輯放在下面的 debounce 之後才跑。
						this.plugin.settings.vaultName = value;
						await this.plugin.saveSettings();
						this.scheduleRenameConfirm();
					}),
			);

		if (this.plugin.settings.resolvedVaultId) {
			new Setting(containerEl)
				.setName('目前已綁定的 vaultId')
				.setDesc(
					`${this.plugin.settings.resolvedVaultId}（對應名稱：${this.plugin.settings.resolvedVaultName ?? ''}）`,
				);
		}
	}
}
