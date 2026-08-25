export interface DiffStats {
	added: string[];
	/** 兩邊都有這個路徑就算 modified：整包鏡像模式沒有 hash 可比對內容是否真的不同。 */
	modified: string[];
	removed: string[];
}

export function computeDiff(knownPaths: string[], targetPaths: string[]): DiffStats {
	const known = new Set(knownPaths);
	const target = new Set(targetPaths);
	const added: string[] = [];
	const modified: string[] = [];
	const removed: string[] = [];

	for (const path of target) {
		if (known.has(path)) modified.push(path);
		else added.push(path);
	}
	for (const path of known) {
		if (!target.has(path)) removed.push(path);
	}

	return { added, modified, removed };
}
