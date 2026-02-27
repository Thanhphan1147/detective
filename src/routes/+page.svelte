<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { diffLines } from 'diff';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { SmartDiffEntry } from '$lib/server/ast';

	type FormState = {
		prUrl?: string;
		parsed?: { owner: string; repo: string; pullNumber: number };
		standardDiff?: string;
		smartDiffs?: SmartDiffEntry[];
		note?: string;
		error?: string;
	};

	const { form } = $props<{ form?: FormState }>();

	let prUrl = $state('');
	let activeTab = $state<'standard' | 'methods' | 'classes'>('methods');
	let isSubmitting = $state(false);
	let highlightCode = $state<((code: string) => string) | null>(null);
	let collapsedPanels = $state<Record<string, { left: boolean; right: boolean }>>({});
	let collapsedCards = $state<Record<string, boolean>>({});
	let collapsedStacks = $state<Record<string, boolean>>({});
	let patchFileName = $state('');
	let patchFileInput: HTMLInputElement | null = null;

	const normalizeMethodName = (name: string) => {
		const trimmed = name.trim();
		if (trimmed.startsWith('class ')) {
			return trimmed.replace(/^class\s+/u, '').split(/[:(]/u)[0]?.trim() ?? trimmed;
		}
		if (trimmed.startsWith('def ')) {
			return trimmed.replace(/^def\s+/u, '').split('(')[0]?.trim() ?? trimmed;
		}
		return trimmed.split('(')[0]?.trim() ?? trimmed;
	};

	const isClassDiff = (diff: SmartDiffEntry) => diff.methodName.trim().startsWith('class ');

	const buildGroupedDiffs = (sourceDiffs: SmartDiffEntry[]) => {
		const map = new Map<string, SmartDiffEntry[]>();
		for (const diff of sourceDiffs) {
			const bucket = map.get(diff.fileName) ?? [];
			bucket.push(diff);
			map.set(diff.fileName, bucket);
		}

		return [...map.entries()].map(([fileName, diffs]) => {
			const byName = new Map<string, SmartDiffEntry[]>();
			for (const diff of diffs) {
				const key = normalizeMethodName(diff.methodName);
				const list = byName.get(key) ?? [];
				list.push(diff);
				byName.set(key, list);
			}

			const merged: SmartDiffEntry[] = [];
			for (const list of byName.values()) {
				if (list.length === 2) {
					const added = list.find((item) => item.status.trim().toLowerCase() === 'added');
					const removed = list.find((item) => item.status.trim().toLowerCase() === 'removed');
					if (added && removed) {
						merged.push({
							fileName: added.fileName,
							methodName: added.methodName || removed.methodName,
							oldCode: removed.oldCode ?? null,
							newCode: added.newCode ?? null,
							status: 'modified'
						});
						continue;
					}
				}
				merged.push(...list);
			}

			return [fileName, merged] as const;
		});
	};

	const groupedMethodDiffs = $derived.by(() => {
		const diffs = (form?.smartDiffs ?? []).filter((diff: SmartDiffEntry) => !isClassDiff(diff));
		return buildGroupedDiffs(diffs);
	});

	const groupedClassDiffs = $derived.by(() => {
		const diffs = (form?.smartDiffs ?? []).filter((diff: SmartDiffEntry) => isClassDiff(diff));
		return buildGroupedDiffs(diffs);
	});

	const groupedDiffs = $derived.by(() =>
		activeTab === 'classes' ? groupedClassDiffs : groupedMethodDiffs
	);

	const hasResults = $derived.by(() => Boolean(form?.standardDiff || form?.smartDiffs?.length));
	const errorMessage = $derived.by(() => form?.error ?? '');

	$effect(() => {
		if (form?.prUrl && form.prUrl !== prUrl) {
			prUrl = form.prUrl;
		}
	});

	const escapeHtml = (value: string) =>
		value
			.replace(/&/gu, '&amp;')
			.replace(/</gu, '&lt;')
			.replace(/>/gu, '&gt;')
			.replace(/"/gu, '&quot;')
			.replace(/'/gu, '&#39;');

	const formatCode = (code: string) => (highlightCode ? highlightCode(code) : escapeHtml(code));

	const getDiffLines = (oldCode: string, newCode: string, side: 'old' | 'new') => {
		const parts = diffLines(oldCode, newCode);
		const lines: Array<{ text: string; className: string }> = [];
		for (const part of parts) {
			const lineValues = part.value.split('\n');
			if (lineValues[lineValues.length - 1] === '') {
				lineValues.pop();
			}
			for (const line of lineValues) {
				if (side === 'old' && part.added) {
					continue;
				}
				if (side === 'new' && part.removed) {
					continue;
				}
				const className = part.added
					? 'diff-added'
					: part.removed
					? 'diff-removed'
					: '';
				lines.push({ text: line, className });
			}
		}
		return lines;
	};

	const formatDiffCode = (oldCode: string, newCode: string, side: 'old' | 'new') => {
		const lines = getDiffLines(oldCode, newCode, side);
		return lines
			.map((line) => {
				const safeText = line.text === '' ? '&nbsp;' : formatCode(line.text);
				const className = line.className ? `diff-line ${line.className}` : 'diff-line';
				return `<span class=\"${className}\">${safeText}</span>`;
			})
			.join('\n');
	};

	const togglePanel = (key: string, side: 'left' | 'right') => {
		const current = collapsedPanels[key] ?? { left: false, right: false };
		collapsedPanels = {
			...collapsedPanels,
			[key]: {
				...current,
				[side]: !current[side]
			}
		};
	};

	const toggleCard = (key: string) => {
		collapsedCards = {
			...collapsedCards,
			[key]: !(collapsedCards[key] ?? false)
		};
	};

	const toggleStack = (key: string) => {
		collapsedStacks = {
			...collapsedStacks,
			[key]: !(collapsedStacks[key] ?? false)
		};
	};

	const handlePatchChange = (event: Event) => {
		const input = event.currentTarget as HTMLInputElement;
		patchFileName = input.files?.[0]?.name ?? '';
	};

	const clearPatchFile = () => {
		patchFileName = '';
		if (patchFileInput) {
			patchFileInput.value = '';
		}
	};

	onMount(async () => {
		const [{ default: hljs }, { default: python }] = await Promise.all([
			import('highlight.js/lib/core'),
			import('highlight.js/lib/languages/python')
		]);

		hljs.registerLanguage('python', python);
		highlightCode = (code: string) => hljs.highlight(code, { language: 'python' }).value;
	});

	const handleEnhance: SubmitFunction = () => {
		isSubmitting = true;
		return async ({ update }) => {
			await update();
			isSubmitting = false;
		};
	};
</script>

<main class="smartdiff-page">
	<div class="smartdiff-container smartdiff-stack">
		<section class="p-strip">
			<div class="u-fixed-width">
				<h1 class="p-heading--2">Detective: Diff checker</h1>
				<p class="p-muted-heading">
					Paste a GitHub Pull Request URL or upload a patch file to compare python methods using AST.
				</p>
			</div>
		</section>

		<div class="smartdiff-card">
			<form
				method="POST"
				enctype="multipart/form-data"
				class="p-form smartdiff-stack--tight"
				use:enhance={handleEnhance}
			>
				<div class="p-form__group">
					<label class="p-form__label" for="prUrl">Pull request URL</label>
					<input
						class="p-form__control"
						type="url"
						id="prUrl"
						name="prUrl"
						placeholder="https://github.com/owner/repo/pull/123"
						bind:value={prUrl}
					/>
				</div>
				<div class="p-form__group">
					<label class="p-form__label" for="patchFile">Or upload a .patch file</label>
					<div class="smartdiff-stack--tight">
						{#if patchFileName}
							<div class="p-button-group">
								<span class="p-text--small">{patchFileName}</span>
								<button
									class="p-button"
									type="button"
									aria-label="Remove patch file"
									onclick={clearPatchFile}
								>
									×
								</button>
							</div>
						{:else}
							<div class="p-button-group">
								<label class="p-button" for="patchFile">Choose file</label>
								<span class="p-text--small smartdiff-muted">.patch files only</span>
							</div>
						{/if}
						<input
							class="u-hide"
							type="file"
							id="patchFile"
							name="patchFile"
							accept=".patch"
							bind:this={patchFileInput}
							onchange={handlePatchChange}
						/>
					</div>
				</div>
				<button
					type="submit"
					class="p-button--positive"
					disabled={isSubmitting}
				>
					{isSubmitting ? 'Analyzing…' : 'Analyze PR'}
				</button>
			</form>
		</div>

		{#if errorMessage}
			<div class="p-notification--negative" role="alert">
				<p class="p-notification__content">{errorMessage}</p>
			</div>
		{/if}

		{#if form?.note}
			<div class="p-notification--information" role="status">
				<p class="p-notification__content">{form.note}</p>
			</div>
		{/if}

		{#if hasResults}
			<div class="smartdiff-stack">
				<div class="p-tabs smartdiff-tabs">
					<div class="p-tabs__list" role="tablist">
						<button
							class={`p-tabs__item ${activeTab === 'methods' ? 'is-selected' : ''}`}
							onclick={() => (activeTab = 'methods')}
							type="button"
							role="tab"
						>
							Diff by methods
						</button>
						<button
							class={`p-tabs__item ${activeTab === 'classes' ? 'is-selected' : ''}`}
							onclick={() => (activeTab = 'classes')}
							type="button"
							role="tab"
						>
							Diff by class
						</button>
						<button
							class={`p-tabs__item ${activeTab === 'standard' ? 'is-selected' : ''}`}
							onclick={() => (activeTab = 'standard')}
							type="button"
							role="tab"
						>
							Standard Diff
						</button>
					</div>
				</div>

				{#if activeTab === 'standard'}
					<div class="smartdiff-card">
						<h2 class="p-heading--5">Standard GitHub Patch</h2>
						<pre class="smartdiff-code">
{form?.standardDiff ?? 'No patch data available.'}
						</pre>
					</div>
				{:else}
					{#if groupedDiffs.length === 0}
						<div class="smartdiff-card">No Python method changes detected in this diff.</div>
					{:else}
							{#each groupedDiffs as [fileName, diffs]}
								<section
									class="smartdiff-card smartdiff-stack--tight"
									role="button"
									tabindex="0"
									onclick={() => toggleStack(fileName)}
									onkeydown={(event) => {
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault();
											toggleStack(fileName);
										}
									}}
								>
									<h3 class="p-heading--5">{fileName}</h3>
									{#if !collapsedStacks[fileName]}
										<div class="smartdiff-stack--tight">
											{#each diffs as diff}
												{@const diffKey = `${fileName}:${diff.methodName}`}
												{@const normalizedStatus = diff.status.trim().toLowerCase()}
												{@const isRemoved =
													normalizedStatus === 'removed' || (diff.oldCode && !diff.newCode)}
												{@const isAdded =
													normalizedStatus === 'added' || (!diff.oldCode && diff.newCode)}
										{#if isRemoved}
											<div class="smartdiff-card smartdiff-stack--tight">
												<div class="smartdiff-row">
													<p class="p-heading--6">{diff.methodName}</p>
													<span class="smartdiff-tag smartdiff-tag--removed">removed</span>
												</div>
												<div class="p-notification--information" role="status">
													<p class="p-notification__content">This method was removed.</p>
												</div>
											</div>
											{:else}
												<div
													class="smartdiff-card smartdiff-stack--tight"
													role="button"
													tabindex="0"
													onclick={(event) => {
														event.stopPropagation();
														toggleCard(diffKey);
													}}
													onkeydown={(event) => {
														if (event.key === 'Enter' || event.key === ' ') {
															event.preventDefault();
															event.stopPropagation();
															toggleCard(diffKey);
														}
													}}
												>
												<div class="smartdiff-row">
													<p class="p-heading--6">{diff.methodName}</p>
													<span
														class={`smartdiff-tag ${
															normalizedStatus === 'modified'
																? 'smartdiff-tag--modified'
																: normalizedStatus === 'added'
																? 'smartdiff-tag--added'
																: 'smartdiff-tag--removed'
														}`}
													>
														{normalizedStatus}
													</span>
												</div>
												{#if !collapsedCards[diffKey]}
													<div class="p-button-group">
														{#if !isAdded}
															<button
																class="p-button"
																onclick={(event) => {
																	event.stopPropagation();
																	togglePanel(diffKey, 'left');
																}}
																type="button"
															>
																{collapsedPanels[diffKey]?.left ? 'Show old' : 'Hide old'}
															</button>
														{/if}
														{#if !isAdded}
															<button
																class="p-button"
																onclick={(event) => {
																	event.stopPropagation();
																	togglePanel(diffKey, 'right');
																}}
																type="button"
															>
																{collapsedPanels[diffKey]?.right ? 'Show new' : 'Hide new'}
															</button>
														{/if}
													</div>
													<div class="smartdiff-grid">
														{#if !isAdded && !collapsedPanels[diffKey]?.left}
															<div>
																<p class="p-text--small smartdiff-muted">Old</p>
																	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
																	<pre
																		class="smartdiff-code"
																		onclick={(event) => event.stopPropagation()}
																		onkeydown={(event) => event.stopPropagation()}
																	>
																		<code class="language-python hljs">{@html formatDiffCode(diff.oldCode ?? '', diff.newCode ?? '', 'old')}</code>
																	</pre>
															</div>
														{/if}
														{#if !collapsedPanels[diffKey]?.right}
															<div>
																<p class="p-text--small smartdiff-muted">New</p>
																	<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
																	<pre
																		class="smartdiff-code"
																		onclick={(event) => event.stopPropagation()}
																		onkeydown={(event) => event.stopPropagation()}
																	>
																		<code class="language-python hljs">
																			{@html isAdded ? formatCode(diff.newCode ?? '—') : formatDiffCode(diff.oldCode ?? '', diff.newCode ?? '', 'new')}
																		</code>
																	</pre>
															</div>
														{/if}
													</div>
												{/if}
											</div>
										{/if}
											{/each}
										</div>
									{/if}
								</section>
						{/each}
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</main>
