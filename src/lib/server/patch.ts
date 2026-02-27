export type PatchFile = {
	fileName: string;
	oldText: string;
	newText: string;
};

const isDiffHeader = (line: string) => line.startsWith('diff --git ');
const isHunkHeader = (line: string) => line.startsWith('@@');
const isDiffStatLine = (line: string) => /\s\|\s\d+\s[+-]+$/u.test(line.trim());

const normalizePath = (rawPath: string) => rawPath.replace(/^a\//u, '').replace(/^b\//u, '');

export const parseUnifiedDiff = (patchText: string) => {
	const files: PatchFile[] = [];
	const lines = patchText.split(/\r?\n/u);
	let currentFile: PatchFile | null = null;
	let inHunk = false;

	const pushCurrent = () => {
		if (currentFile) {
			files.push(currentFile);
		}
		currentFile = null;
		inHunk = false;
	};

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];

		if (isDiffHeader(line)) {
			pushCurrent();
			const match = /diff --git a\/(.+?) b\/(.+)$/u.exec(line);
			if (!match) {
				continue;
			}
			const fileName = normalizePath(match[2]);
			currentFile = { fileName, oldText: '', newText: '' };
			continue;
		}

		if (!currentFile) {
			continue;
		}

		if (line.startsWith('--- ') || line.startsWith('+++ ')) {
			continue;
		}

		if (isHunkHeader(line)) {
			inHunk = true;
			continue;
		}

		if (!inHunk) {
			continue;
		}

		if (line.startsWith(' ')) {
			const content = line.slice(1);
			if (isDiffStatLine(content)) {
				continue;
			}
			currentFile.oldText += `${content}\n`;
			currentFile.newText += `${content}\n`;
			continue;
		}

		if (line.startsWith('-')) {
			const content = line.slice(1);
			if (isDiffStatLine(content)) {
				continue;
			}
			currentFile.oldText += `${content}\n`;
			continue;
		}

		if (line.startsWith('+')) {
			const content = line.slice(1);
			if (isDiffStatLine(content)) {
				continue;
			}
			currentFile.newText += `${content}\n`;
			continue;
		}
	}

	pushCurrent();
	return files;
};
