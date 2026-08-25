import { App, Modal, Setting } from 'obsidian';
import type { DiffStats } from './diff';

export type SyncDirection = 'push' | 'pull';

/** 只能列出數量，不能逐一檢視內容——整包鏡像模式的已知限制，不是這裡少做。 */
export class ConfirmSyncModal extends Modal {
	private settled = false;
	private resolveFn!: (confirmed: boolean) => void;

	private constructor(
		app: App,
		private direction: SyncDirection,
		private diff: DiffStats,
	) {
		super(app);
	}

	static confirm(app: App, direction: SyncDirection, diff: DiffStats): Promise<boolean> {
		return new Promise((resolve) => {
			const modal = new ConfirmSyncModal(app, direction, diff);
			modal.resolveFn = resolve;
			modal.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		const side = this.direction === 'push' ? '遠端' : '本地';
		// pull 覆蓋掉的本地檔案是直接永久刪除；push 則是覆蓋遠端且不擋任何併發，
		// 兩邊風險不同，各自提醒使用者真正該注意的後果。
		const warning =
			this.direction === 'pull'
				? '本地多餘的檔案會被永久刪除，不會進回收桶。'
				: '遠端尚未 pull 的修改會被整包覆蓋，沒有任何保護。';

		contentEl.createEl('h2', { text: this.direction === 'push' ? '確認 Push' : '確認 Pull' });
		contentEl.createEl('p', {
			text: `${side}將新增 ${this.diff.added.length} 個、覆蓋 ${this.diff.modified.length} 個、刪除 ${this.diff.removed.length} 個檔案。`,
		});
		contentEl.createEl('p', { text: warning, cls: 'mod-warning' });

		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText('取消').onClick(() => this.finish(false)))
			.addButton((btn) => btn.setButtonText('確定').setCta().onClick(() => this.finish(true)));
	}

	onClose(): void {
		this.finish(false); // ESC／點擊背景關閉視為取消
		this.contentEl.empty();
	}

	private finish(confirmed: boolean): void {
		if (this.settled) return;
		this.settled = true;
		this.resolveFn(confirmed);
		this.close();
	}
}
