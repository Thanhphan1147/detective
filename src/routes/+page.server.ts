import type { Actions } from '@sveltejs/kit';
import { fail } from '@sveltejs/kit';
import { Octokit } from '@octokit/rest';
import { diffPythonBlocks, extractPythonBlocks } from '$lib/server/ast';
import { parseUnifiedDiff } from '$lib/server/patch';

const TIMEOUT_MS = 12_000;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 300_000;

const octokit = new Octokit({
	auth: process.env.GITHUB_TOKEN || undefined
});

const parsePullRequestUrl = (value: string) => {
	const match = value.match(
		/^https?:\/\/github\.com\/(?<owner>[^/]+)\/(?<repo>[^/]+)\/pull\/(?<number>\d+)/i
	);

	if (!match?.groups) {
		return null;
	}

	return {
		owner: match.groups.owner,
		repo: match.groups.repo,
		pullNumber: Number(match.groups.number)
	};
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error('Request timed out')), timeoutMs)
			)
		]);
	} finally {
		clearTimeout(timeout);
	}
};

const fetchFileContent = async (
	owner: string,
	repo: string,
	path: string,
	ref: string
) => {
	const response = await octokit.repos.getContent({ owner, repo, path, ref });
	if (Array.isArray(response.data)) {
		throw new Error(`Expected file but received directory for ${path}`);
	}

	if (!('content' in response.data)) {
		throw new Error(`No content available for ${path}`);
	}

	if (response.data.size && response.data.size > MAX_FILE_BYTES) {
		throw new Error(`File ${path} is too large to parse.`);
	}

	return Buffer.from(response.data.content, 'base64').toString('utf-8');
};

export const actions = {
	default: async ({ request }) => {
		const formData = await request.formData();
		const prUrl = String(formData.get('prUrl') ?? '').trim();
		const patchFile = formData.get('patchFile');

		const hasPatchUpload = patchFile instanceof File && patchFile.size > 0;

		if (!prUrl && !hasPatchUpload) {
			return fail(400, { error: 'Please paste a PR URL or upload a .patch file.' });
		}

		if (hasPatchUpload && patchFile instanceof File) {
			const patchText = await patchFile.text();
			if (!patchText.trim()) {
				return fail(400, { error: 'The uploaded patch file is empty.' });
			}

			const parsedFiles = parseUnifiedDiff(patchText);
			const pythonFiles = parsedFiles.filter((file) => file.fileName.endsWith('.py'));
			const smartDiffs = pythonFiles.flatMap((file) => {
				const oldBlocks = extractPythonBlocks(file.oldText);
				const newBlocks = extractPythonBlocks(file.newText);
				return diffPythonBlocks(file.fileName, oldBlocks, newBlocks);
			});

			return {
				prUrl,
				standardDiff: patchText,
				smartDiffs,
				note:
					'Smart diffs from patches use only the hunk context. For full accuracy, prefer a GitHub PR URL.'
			};
		}

		const parsed = parsePullRequestUrl(prUrl);
		if (!parsed) {
			return fail(400, { error: 'That does not look like a valid GitHub PR URL.' });
		}

		try {
			const pull = await withTimeout(
				octokit.pulls.get({
					owner: parsed.owner,
					repo: parsed.repo,
					pull_number: parsed.pullNumber
				}),
				TIMEOUT_MS
			);

			const files = await withTimeout(
				octokit.paginate(octokit.pulls.listFiles, {
					owner: parsed.owner,
					repo: parsed.repo,
					pull_number: parsed.pullNumber,
					per_page: 100
				}),
				TIMEOUT_MS
			);

			if (files.length > MAX_FILES) {
				return fail(413, {
					error: `This PR has ${files.length} files. Please try a smaller PR.`
				});
			}

			const pythonFiles = files.filter((file) => file.filename.endsWith('.py'));
			const baseSha = pull.data.base.sha;
			const headSha = pull.data.head.sha;

			const standardDiff = files
				.map(
					(file) =>
						`# ${file.filename}\n${file.patch ?? '(Patch unavailable for this file)'}\n`
				)
				.join('\n');

			const smartDiffs = [] as ReturnType<typeof diffPythonBlocks>;

			for (const file of pythonFiles) {
				const oldContent = file.status === 'added'
					? null
					: await fetchFileContent(parsed.owner, parsed.repo, file.filename, baseSha);
				const newContent = file.status === 'removed'
					? null
					: await fetchFileContent(parsed.owner, parsed.repo, file.filename, headSha);

				const oldBlocks = oldContent ? extractPythonBlocks(oldContent) : new Map();
				const newBlocks = newContent ? extractPythonBlocks(newContent) : new Map();
				const diffs = diffPythonBlocks(file.filename, oldBlocks, newBlocks);
				smartDiffs.push(...diffs);
			}

			return {
				prUrl,
				parsed,
				standardDiff,
				smartDiffs
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error occurred.';
			return fail(500, {
				error: `Unable to process this PR right now. ${message}`
			});
		}
	}
} satisfies Actions;
