// @ts-check
import html, { useSignal } from '../html.js';

import { removeSpecialCharacters } from '../utils.js';
import { folderName, newFileName } from './data.js';
import { useRunAfterUpdate } from './useRunAfterUpdate.js';

export function Footer(/** @type {Object} */ props) {
	// Downloading itself lives in the toolbar button (which already applies these
	// options). Here we keep only the subfolder / rename inputs, tucked away in a
	// dropdown so they don't eat vertical space unless needed.
	const open = useSignal(false);
	const runAfterUpdate = useRunAfterUpdate();

	const hasOptions = Boolean(folderName.value || newFileName.value);

	return html`
		<footer ...${props}>
			${open.value
				? html`
						<div class="id-dl-options grid gap-2" style=${{ gridTemplateColumns: '1fr 1fr' }}>
							<input
								id="subfolder_name_input"
								type="text"
								placeholder="Save to subfolder"
								title="Set the name of the subfolder you want to download the images to."
								value=${folderName}
								onChange=${(/** @type {Event} */ e) => {
									const input = /** @type HTMLInputElement */ (e.currentTarget);
									const savedSelectionStart = removeSpecialCharacters(
										input.value.slice(0, input.selectionStart || 0)
									).length;

									runAfterUpdate(() => {
										input.selectionStart = input.selectionEnd = savedSelectionStart;
									});

									folderName.value = removeSpecialCharacters(input.value);
								}}
							/>

							<input
								id="rename_pattern_input"
								type="text"
								placeholder="Rename files"
								title="Set a new file name for the images you want to download."
								value=${newFileName}
								onChange=${(/** @type {Event} */ e) => {
									const input = /** @type HTMLInputElement */ (e.currentTarget);
									const savedSelectionStart = removeSpecialCharacters(
										input.value.slice(0, input.selectionStart || 0)
									).length;

									runAfterUpdate(() => {
										input.selectionStart = input.selectionEnd = savedSelectionStart;
									});

									newFileName.value = removeSpecialCharacters(input.value);
								}}
							/>
						</div>
					`
				: ''}

			<button
				type="button"
				class="id-dl-options-toggle ${open.value ? 'is-open' : ''}"
				title="Subfolder & rename options"
				onClick=${() => (open.value = !open.value)}
			>
				<span class="id-dl-options-label">
					Download options${hasOptions ? html`<span class="id-dl-dot" title="Options set"></span>` : ''}
				</span>
				<span class="id-dl-caret">${open.value ? '▾' : '▴'}</span>
			</button>
		</footer>
	`;
}
