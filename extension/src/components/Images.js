// @ts-check
import html, { For, Show, useComputed, useEffect, useSignal } from '../html.js';

import { getReferralUrl, isIncludedIn, isNotIncludedIn, isNotStrictEqual, stopPropagation, unique } from '../utils.js';
import * as actions from './actions.js';
import { Checkbox } from './Checkbox.js';
import {
	columns,
	displayedImages,
	filteredOutImages,
	imageErrored,
	imageLoaded,
	matchingImages,
	selectedFilteredOutImages,
	selectedImages,
	selectedMatchingImages,
	sortedDisplayedImages,
	sortMode,
	tab,
} from './data.js';
import { ExternalLink } from './ExternalLink.js';
import { useImageStats } from './useImageStats.js';
import { useScrollToEnd } from './useScrollToEnd.js';

/**
 * @typedef {import('./useImageStats.js').ImageStatsData} ImageStatsData
 * @typedef {import('./useImageStats.js').ImageStats} ImageStats
 */

/**
 * @typedef {import('./data.js').Options} Options
 */

/**
 * @typedef {Object} CSSProperties
 * @property {string} [minHeight]
 * @property {string} [backgroundImage]
 * @property {string} [backgroundRepeat]
 * @property {string} [backgroundSize]
 */

/**
 * @typedef {Object} ImagesProps
 * @property {string} [class]
 * @property {CSSProperties} [style]
 */

export function Images(/** @type {ImagesProps} */ { class: className, style, ...props }) {
	const allImagesFromCurrentTabAreSelected = displayedImages.value.every(isIncludedIn(selectedImages.value));

	const downloadInProgress = useSignal(false);

	async function downloadSelected() {
		if (selectedImages.value.length === 0 || downloadInProgress.value) return;
		downloadInProgress.value = true;
		await actions.downloadImages(selectedImages.value);
		downloadInProgress.value = false;
	}

	const sortOrder = ['none', 'size', 'width', 'height'];
	const sortLabels = { none: 'Sort', size: 'KB', width: 'W', height: 'H' };
	const sortTitles = {
		none: 'Sort images by file size (largest first)',
		size: 'Sorted by file size — click to sort by width',
		width: 'Sorted by width — click to sort by height',
		height: 'Sorted by height — click to turn sorting off',
	};
	function cycleSort() {
		sortMode.value = sortOrder[(sortOrder.indexOf(sortMode.value) + 1) % sortOrder.length];
	}

	// Floating download button: appears once the toolbar has scrolled out of view
	// so the user can download without scrolling back to the top.
	const showFloatingDownload = useSignal(false);
	useEffect(() => {
		const scroller = document.getElementById('image-downloader-root');
		if (!scroller) return;
		const onScroll = () => (showFloatingDownload.value = scroller.scrollTop > 140);
		scroller.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
		return () => scroller.removeEventListener('scroll', onScroll);
	}, []);

	return html`
		<div class="id-toolbar flex flex-wrap items-center gap-2 p-2 pb-0 tabular-nums">
			<ul
				class="flex items-center overflow-hidden rounded-full border border-slate-300 text-xs text-nowrap dark:border-slate-600"
				onChange=${(/** @type {Event} */ e) => {
					tab.value = /** @type {HTMLInputElement} */ (e.target).value;
				}}
			>
				<li>
					<${Tab}
						title="Images matching your filters"
						input=${{ name: 'visibility', value: 'matching', checked: tab.value === 'matching' }}
					>
						<${Circle} class="bg-green-600 text-white">
							${
								selectedMatchingImages.value.length > 0
									? html`<span class="text-2xs">${selectedMatchingImages.value.length}</span>`
									: '+'
							}
						<//>
						${matchingImages.value.length} matching
					<//>
				</li>

				<li>
					<${Tab}
						class="border-l border-slate-300 dark:border-slate-600"
						title="Images removed by your filters"
						input=${{ name: 'visibility', value: 'filtered_out', checked: tab.value === 'filtered_out' }}
					>
						<${Circle} class="bg-slate-600 text-white">
							${
								selectedFilteredOutImages.value.length > 0
									? html`<span class="text-2xs">${selectedFilteredOutImages.value.length}</span>`
									: '-'
							}
						<//>
						${filteredOutImages.value.length} filtered out
					<//>
				</li>
			</ul>

			<${Checkbox}
				class="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 p-1 text-xs text-nowrap text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
				checked=${selectedImages.value.length > 0 && allImagesFromCurrentTabAreSelected}
				indeterminate=${selectedImages.value.length > 0 && !allImagesFromCurrentTabAreSelected}
				disabled=${displayedImages.value.length === 0}
				title="Click to select or unselect all displayed images"
				onChange=${(/** @type {Event} */ e) => {
					const { checked } = /** @type {HTMLInputElement} */ (e.currentTarget);
					selectedImages.value = checked
						? unique([...selectedImages.value, ...displayedImages.value])
						: selectedImages.value.filter(isNotIncludedIn(displayedImages.value));
				}}
			>
				${selectedImages.value.length} selected
			<//>

			<button
				type="button"
				class="id-download-selected ml-auto ${downloadInProgress.value ? 'is-loading' : ''}"
				disabled=${selectedImages.value.length === 0 || downloadInProgress.value}
				title="Download all selected images at once"
				onClick=${downloadSelected}
			>
				<img class="id-download-icon" src="/images/download.svg" alt="Download selected" />
				${selectedImages.value.length > 0
					? html`<span class="id-download-count">${selectedImages.value.length}</span>`
					: ''}
			</button>
		</div>

		<div class="id-columns flex items-center gap-2 px-2 pt-2 pb-0 text-xs">
			<button
				type="button"
				class="id-sort ${sortMode.value !== 'none' ? 'is-active' : ''}"
				title=${sortTitles[sortMode.value]}
				onClick=${cycleSort}
			>
				<span class="id-sort-arrow">${sortMode.value === 'none' ? '↕' : '↓'}</span>
				${sortLabels[sortMode.value]}
			</button>

			<img class="id-columns-icon" src="/images/system.svg" alt="Columns" title="Number of columns" />
			<input
				type="range"
				class="id-columns-range"
				min="1"
				max="6"
				step="1"
				value=${columns}
				title=${`${columns.value} columns`}
				aria-label="Number of columns"
				onInput=${(/** @type {Event} */ e) =>
					(columns.value = parseInt(/** @type {HTMLInputElement} */ (e.currentTarget).value, 10))}
			/>
			<span class="id-columns-count tabular-nums">${columns}</span>
		</div>

		<div
			class="grid gap-2 p-2"
			style=${{ gridTemplateColumns: `repeat(${columns.value}, minmax(0, 1fr))`, ...style }}
			...${props}
		>
			<${For} each=${sortedDisplayedImages}>
				${(/** @type {string} */ imageUrl) => html`
					<${ImageCard}
						key=${imageUrl}
						imageUrl=${imageUrl}
						onClick=${() => {
							selectedImages.value = selectedImages.value.includes(imageUrl)
								? selectedImages.value.filter(isNotStrictEqual(imageUrl))
								: [...selectedImages.value, imageUrl];
						}}
					/>
				`}
			<//>
		</div>

		${showFloatingDownload.value && selectedImages.value.length > 0
			? html`
					<button
						type="button"
						class="id-download-fab ${downloadInProgress.value ? 'is-loading' : ''}"
						title="Download selected images"
						onClick=${downloadSelected}
					>
						<img class="id-download-icon" src="/images/download.svg" alt="Download selected" />
						<span class="id-download-count">${selectedImages.value.length}</span>
					</button>
				`
			: ''}
	`;
}

function Tab(
	/** @type {{ class?: string, children?: any, input?: { name: string, value: string, checked: boolean } }} */ {
		class: className = '',
		children,
		input,
		...props
	}
) {
	return html`
		<label
			class="${className} bg-slate-50 p-1 text-slate-600 transition-colors hover:bg-slate-100 has-checked:bg-slate-200 has-checked:text-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:has-checked:bg-slate-700 dark:has-checked:text-slate-200"
			...${props}
		>
			<input class="sr-only" type="radio" ...${input} />
			${children}
		</label>
	`;
}

function Circle(/** @type {{ class?: string, children?: any }} */ { class: className = '', children, ...props }) {
	return html`
		<span
			class="corner-round ${className} inline-block h-4 min-w-4 rounded-full px-1 text-center font-bold"
			...${props}
		>
			${children}
		</span>
	`;
}

function ImageCard(/** @type {{ imageUrl: string }} */ { imageUrl, ...props }) {
	const stats = useImageStats(imageUrl);
	const statsAreLoaded = useComputed(() => stats.data.value.status === 'loaded');
	const retryCount = useSignal(0);
	const isSelected = selectedImages.value.includes(imageUrl);

	return html`
		<div
			class="group relative cursor-pointer flex justify-center items-center overflow-hidden rounded-xl shadow-md border bg-[conic-gradient(var(--color-slate-100)_90deg,var(--color-slate-300)_90deg_180deg,var(--color-slate-100)_180deg_270deg,var(--color-slate-300)_270deg)] dark:bg-[conic-gradient(var(--color-slate-800)_90deg,var(--color-slate-700)_90deg_180deg,var(--color-slate-800)_180deg_270deg,var(--color-slate-700)_270deg)] ${isSelected ? 'border-sky-600 dark:border-sky-400 outline-2 outline-sky-600 dark:outline-sky-400' : 'border-slate-300 dark:border-slate-700'}"
			style=${{
				minHeight: `192px`,
				backgroundRepeat: 'repeat',
				backgroundSize: '12px 12px',
			}}
			...${props}
		>
			${
				stats.data.value.status === 'error'
					? html`<${ImageError}
							onClick=${() => {
								retryCount.value++;
								stats.reset();
							}}
						/>`
					: html`<img
							key=${retryCount}
							class="drop-shadow-md"
							src=${imageUrl}
							onLoad=${(/** @type {Event}  */ e) => {
								imageLoaded(imageUrl);
								stats.onLoad(e);
							}}
							onError=${(/** @type {Event}  */ e) => {
								imageErrored(imageUrl);
								stats.onError();
							}}
						/>`
			}

			<div
				class=${`
					absolute top-1 left-1
					w-7 h-7
					rounded-md border shadow-md
					${isSelected ? 'border-sky-600 bg-sky-600' : 'hidden border-slate-400 bg-white'}
					group-hover:block
					after:content-['']
					after:absolute after:top-1/2 after:left-1/2
					after:-translate-x-1/2 after:-translate-y-2/3
					after:w-4.5 after:h-2.5
					after:border-3 after:border-t-0 after:border-r-0
					after:-rotate-45
					${isSelected ? 'after:border-white' : 'after:border-slate-400'}
				`}
			></div>

			<div class="absolute top-1 right-1 hidden group-hover:flex gap-1">
				<${RemoveBackgroundButton} imageUrl=${imageUrl} />
				<${OpenImageButton} imageUrl=${imageUrl} onClick=${stopPropagation} />
				<${DownloadImageButton} imageUrl=${imageUrl} onClick=${stopPropagation} />
			</div>

			<div class="absolute right-1 bottom-1 left-1">
				<!-- Toggle opacity - toggling display messes with the input content scrolling -->
				<${ImageUrlTextbox} class="opacity-0 group-hover:opacity-100 w-full" url=${imageUrl} />

				<div class="group-hover:hidden flex gap-1">
					<${ImageStat} class="uppercase">${stats.data.value.extension}</${ImageStat}>

					<${Show} when=${statsAreLoaded}>
						<${ImageStat}>${stats.data.value.width}×${stats.data.value.height}</${ImageStat}>
						<${ImageStat} class="small-caps lowercase">${stats.data.value.size ? stats.data.value.size.formatted : ''}</${ImageStat}>
					<//>
				</div>
			</div>
		</div>
	`;
}

function ImageError(/** @type {{ onClick?: (e: MouseEvent) => void }} */ { onClick, ...props }) {
	return html`
		<button
			class="flex h-auto flex-col items-center justify-center gap-1 border-red-300 m-2 bg-red-50 p-4 text-xs text-red-600 hover:bg-red-100"
			type="button"
			title="Retry loading image"
			onClick=${(/** @type {MouseEvent} e */ e) => {
				e.stopPropagation();
				onClick?.(e);
			}}
			...${props}
		>
			<div><${Circle} class="bg-red-600 text-white">×<//> Error loading image</div>
			Click to retry
		</button>
	`;
}

function RemoveBackgroundButton(/** @type {{ imageUrl: string }} */ { imageUrl, ...props }) {
	return html`
		<${ExternalLink}
			...${props}
			class="btn h-7 w-7 rounded bg-size-[20px] bg-center bg-no-repeat text-transparent shadow-md"
			style=${{ backgroundImage: 'url("/images/cutout.svg")' }}
			href=${getReferralUrl('https://cutoutmagic.com/library', { url: imageUrl, utm_content: 'remove_background_button' })}
			title="Remove background with CutoutMagic.com"
			onClick=${stopPropagation}
		>
			Remove background with CutoutMagic.com
		<//>
	`;
}

function OpenImageButton(
	/** @type {{ imageUrl: string, onClick?: (e: MouseEvent) => void }} */ { imageUrl, onClick, ...props }
) {
	function openNewTab(/** @type {MouseEvent} */ e) {
		chrome.tabs.create({ url: imageUrl, active: false });
		if (onClick) {
			onClick(e);
		}
	}

	return html`
		<button
			class="h-7 w-7 rounded bg-size-[20px] bg-center bg-no-repeat shadow-md"
			style=${{ backgroundImage: 'url("/images/open.svg")' }}
			type="button"
			title="Open in new tab"
			onClick=${openNewTab}
			...${props}
		/>
	`;
}

function DownloadImageButton(
	/** @type {{ imageUrl: string, onClick?: (e: MouseEvent) => void }} */ { imageUrl, onClick, ...props }
) {
	function downloadImages(/** @type {MouseEvent} */ e) {
		actions.downloadImages([imageUrl]);
		if (onClick) {
			onClick(e);
		}
	}

	return html`
		<button
			class="h-7 w-7 rounded bg-size-[20px] bg-center bg-no-repeat shadow-md"
			style=${{ backgroundImage: 'url("/images/download.svg")' }}
			type="button"
			title="Download"
			onClick=${downloadImages}
			...${props}
		/>
	`;
}

function ImageStat(/** @type {{ class?: string; children?: any }} */ { class: className = '', children, ...props }) {
	return html`
		<small class="${className} rounded bg-slate-950/80 px-1 text-white empty:hidden" ...${props}>${children}</small>
	`;
}

function ImageUrlTextbox(/** @type {{ class?: string; url: string }} */ { class: className = '', url, ...props }) {
	const inputRef = useScrollToEnd();

	function setInputValue(/** @type {string} */ value) {
		if (inputRef.current) {
			inputRef.current.value = value;
		}
	}

	return html`
		<div class="${className} flex">
			<input
				ref=${inputRef}
				class="flex-1 rounded-r-none border-r-0"
				type="text"
				readonly
				value=${url}
				onClick=${(/** @type {MouseEvent} */ e) => {
					e.stopPropagation();
					/** @type {HTMLInputElement} */ (e.currentTarget).select();
				}}
				...${props}
			/>

			<button
				type="button"
				class="w-8 rounded-l-none bg-center bg-no-repeat"
				style=${{ backgroundImage: 'url("/images/copy.svg")' }}
				title="Copy image URL to clipboard"
				onClick=${async (/** @type {Event} */ e) => {
					e.stopPropagation();
					await window.navigator.clipboard.writeText(url);
					setInputValue('Copied URL!');
					setTimeout(() => setInputValue(url), 2000);
				}}
			/>
		</div>
	`;
}
