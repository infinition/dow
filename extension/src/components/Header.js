// @ts-check
import html, { Show } from '../html.js';

import { toggle } from '../utils.js';
import { AdvancedFilters } from './AdvancedFilters.js';
import { Bubble } from './Bubble.js';
import {
	filterMaxHeightEnabled,
	filterMaxWidthEnabled,
	filterMinHeightEnabled,
	filterMinWidthEnabled,
	filterUrl,
	filterUrlMode,
	hideErroredImages,
	loadImagesFromActiveTab,
	onlyImagesFromLinks,
	onlyUniqueImages,
	showAdvancedFilters,
} from './data.js';
import { UrlFilterMode } from './UrlFilterMode.js';

export function Header(/** @type {Object} */ props) {
	const numberOfActiveAdvancedFilters = [
		filterMinWidthEnabled,
		filterMaxWidthEnabled,
		filterMinHeightEnabled,
		filterMaxHeightEnabled,
		onlyUniqueImages,
		onlyImagesFromLinks,
		hideErroredImages,
	].filter((s) => s.value).length;

	return html`
		<header ...${props}>
			<div class="flex items-center gap-1 p-2">
				<button
					class="min-w-8"
					title="Reload images from current tab"
					onClick=${() => loadImagesFromActiveTab({ waitForIdleDOM: 1 })}
				>
					<img class="inline w-3.5" src="/images/reload.svg" />
				</button>

				<input
					id="filter_by_url_input"
					type="text"
					placeholder="Filter by URL"
					title="Filter by parts of the URL or regular expressions."
					value=${filterUrl}
					class="flex-1"
					onInput=${(/** @type {Event} */ e) =>
						(filterUrl.value = /** @type {HTMLInputElement} */ (e.currentTarget).value.trim())}
				/>

				<${UrlFilterMode}
					id="url_filter_mode_select"
					value=${filterUrlMode}
					onChange=${(/** @type {Event} */ e) =>
						(filterUrlMode.value = /** @type {HTMLInputElement} */ (e.currentTarget).value)}
				/>

				<button
					class="relative min-w-8"
					title=${!showAdvancedFilters.value && numberOfActiveAdvancedFilters > 0
						? `${numberOfActiveAdvancedFilters} advanced ${numberOfActiveAdvancedFilters === 1 ? 'filter' : 'filters'} active`
						: 'Toggle advanced filters'}
					onClick=${toggle(showAdvancedFilters)}
				>
					<img
						class="${showAdvancedFilters.value ? '' : '-rotate-90'} inline w-3 transition-transform"
						src="/images/chevron.svg"
					/>

					<${Bubble} show=${!showAdvancedFilters.value && numberOfActiveAdvancedFilters > 0}>
						${numberOfActiveAdvancedFilters}
					<//>
				</button>
			</div>

			<${Show} when=${showAdvancedFilters}>
				<${AdvancedFilters} />
			<//>
		</header>
	`;
}
