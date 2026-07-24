// @ts-check
import html, { useEffect, useRef } from '../html.js';
import { setToCheckboxValue } from '../utils.js';

import noUiSlider from '/lib/nouislider.mjs';
import { Checkbox } from './Checkbox.js';
import {
	defaults,
	filterMaxHeight,
	filterMaxHeightEnabled,
	filterMaxWidth,
	filterMaxWidthEnabled,
	filterMinHeight,
	filterMinHeightEnabled,
	filterMinWidth,
	filterMinWidthEnabled,
	hideErroredImages,
	onlyImagesFromLinks,
	onlyUniqueImages,
} from './data.js';

export function AdvancedFilters() {
	const widthSliderRef = useSlider('width');
	const heightSliderRef = useSlider('height');

	return html`
		<div class="id-filters p-2 pt-0">
			<table class="w-full tabular-nums">
				<colgroup>
					<col class="w-10" />
					<col class="w-20" />
					<col />
					<col class="w-16" />
				</colgroup>

				<tr>
					<td class="id-filter-dim pb-0.5">Width</td>

					<td class="text-right">
						<small class="id-filter-value ${filterMinWidthEnabled.value ? 'is-active' : ''}">
							${filterMinWidth}px ≤
						</small>
					</td>

					<td class="px-3 py-2">
						<div ref=${widthSliderRef}></div>
					</td>

					<td>
						<small class="id-filter-value ${filterMaxWidthEnabled.value ? 'is-active' : ''}">
							≤ ${filterMaxWidth}px
						</small>
					</td>
				</tr>

				<tr>
					<td class="id-filter-dim pb-0.5">Height</td>

					<td class="text-right">
						<small class="id-filter-value ${filterMinHeightEnabled.value ? 'is-active' : ''}">
							${filterMinHeight}px ≤
						</small>
					</td>

					<td class="px-3 py-2">
						<div ref=${heightSliderRef}></div>
					</td>

					<td>
						<small class="id-filter-value ${filterMaxHeightEnabled.value ? 'is-active' : ''}">
							≤ ${filterMaxHeight}px
						</small>
					</td>
				</tr>
			</table>

			<div class="flex gap-3">
				<${Checkbox}
					class="py-1"
					title="Attempt to deduplicate images by keeping only the highest resolution and best format"
					checked=${onlyUniqueImages.value}
					onChange=${setToCheckboxValue(onlyUniqueImages)}
				>
					Only unique
				<//>

				<${Checkbox}
					class="py-1"
					title="Only show images from direct links on the page; useful on some websites"
					checked=${onlyImagesFromLinks.value}
					onChange=${setToCheckboxValue(onlyImagesFromLinks)}
				>
					Only links
				<//>

				<${Checkbox}
					class="py-1"
					title="Hide images that failed to load"
					checked=${hideErroredImages.value}
					onChange=${setToCheckboxValue(hideErroredImages)}
				>
					Hide errors
				<//>
			</div>
		</div>
	`;
}

function useSlider(/** @type {'width' | 'height'} */ dimension) {
	const sliderRef = useRef(/** @type {HTMLElement | null} */ (null));

	useEffect(() => {
		const slider = /** @type {import('/lib/nouislider.mjs').target | null} */ (sliderRef.current);
		if (!slider) return;

		const minDefault = dimension === 'width' ? defaults.filter_min_width : defaults.filter_min_height;
		const maxDefault = dimension === 'width' ? defaults.filter_max_width : defaults.filter_max_height;
		const minSignal = dimension === 'width' ? filterMinWidth : filterMinHeight;
		const maxSignal = dimension === 'width' ? filterMaxWidth : filterMaxHeight;
		const minEnabledSignal = dimension === 'width' ? filterMinWidthEnabled : filterMinHeightEnabled;
		const maxEnabledSignal = dimension === 'width' ? filterMaxWidthEnabled : filterMaxHeightEnabled;

		/** @type {ResizeObserver | null} */
		let observer = null;

		// Build only once the element actually has a width. Creating noUiSlider on
		// a zero-width element (e.g. while the popup tab is still laying out)
		// collapses both handles into a few pixels — the "collapsed slider" bug.
		function build() {
			if (slider.noUiSlider || slider.offsetWidth === 0) return;

			noUiSlider.create(slider, {
				behaviour: 'extend-tap',
				connect: true,
				format: {
					from: (/** @type {string} */ value) => parseInt(value, 10),
					to: (/** @type {number} */ value) => Math.trunc(value),
				},
				range: {
					min: minDefault,
					max: maxDefault,
				},
				step: 10,
				start: [minSignal.value, maxSignal.value],
			});

			// The slider itself is the on/off switch: a handle resting at its extreme
			// (min at the far left, max at the far right) means "no filter for this
			// bound"; moving it inward enables filtering by that value.
			slider.noUiSlider?.on('update', (/** @type {(string | number)[]} */ [min, max]) => {
				const minValue = /** @type {number} */ (min);
				const maxValue = /** @type {number} */ (max);
				minSignal.value = minValue;
				maxSignal.value = maxValue;
				minEnabledSignal.value = minValue > minDefault;
				maxEnabledSignal.value = maxValue < maxDefault;
			});

			if (observer) {
				observer.disconnect();
				observer = null;
			}
		}

		build();
		if (!slider.noUiSlider) {
			observer = new ResizeObserver(build);
			observer.observe(slider);
		}

		return () => {
			if (observer) observer.disconnect();
			if (slider.noUiSlider) {
				slider.noUiSlider.destroy();
			}
		};
	}, [dimension]);

	return sliderRef;
}
