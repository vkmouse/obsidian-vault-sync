import { Plugin, TAbstractFile, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, VaultSyncSettingTab } from './settings';
import { SyncQueueManager } from './sync/queue';
import { runSync } from './sync/syncRunner';
import type { PluginData } from './types';

export default class VaultSyncPlugin extends Plugin {
	settings!: PluginData;
	queueManager!: SyncQueueManager;

	async onload() {
		await this.loadSettings();

		this.queueManager = new SyncQueueManager({
			getVaultState: () => {
				const vaultId = this.settings.resolvedVaultId;
				return vaultId ? { vaultId, settings: this.settings } : null;
			},
			onQueueChanged: () => {
				void this.saveSettings();
			},
		});

		this.registerVaultEvents();

		this.addRibbonIcon('refresh-cw', 'Vault Sync：立即同步', () => {
			void runSync(this);
		});

		this.addCommand({
			id: 'vault-sync-run',
			name: '立即同步',
			callback: () => {
				void runSync(this);
			},
		});

		this.addSettingTab(new VaultSyncSettingTab(this.app, this));
	}

	onunload() {
		this.queueManager?.dispose();
	}

	/**
	 * plugin 剛載入、vault 索引重建時，Obsidian 會對所有既有檔案各觸發一次
	 * create 事件，不是真的新檔案；用 layoutReady 篩掉這些事件，避免把整個
	 * vault 誤判成待推送的新增。
	 */
	private registerVaultEvents(): void {
		const isTrackable = (file: TAbstractFile): file is TFile =>
			file instanceof TFile && this.app.workspace.layoutReady;

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (isTrackable(file)) this.queueManager.onVaultEvent(file.path, 'create');
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (isTrackable(file)) this.queueManager.onVaultEvent(file.path, 'modify');
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) this.queueManager.onVaultEvent(file.path, 'delete');
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) this.queueManager.onRenameEvent(oldPath, file.path);
			}),
		);
	}

	async loadSettings() {
		// 舊版 data.json 用的欄位是 globalSyncCursor，改名成 lastCursor 之後型別上
		// 已經不存在這個欄位，若不遷移，Object.assign 會判定成「沒有 lastCursor」，
		// 直接用 DEFAULT_SETTINGS.lastCursor=0 覆蓋掉，讓使用者升級後從頭重拉一次
		// 全部歷史事件（雖然冪等、不算資料遺失，但體感是整個帳號重新同步一次）。
		const raw = (await this.loadData()) as (Partial<PluginData> & { globalSyncCursor?: number }) | null;
		if (raw && raw.lastCursor === undefined && typeof raw.globalSyncCursor === 'number') {
			raw.lastCursor = raw.globalSyncCursor;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
