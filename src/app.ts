import { prepareImage } from './image-pipeline.js';
import { renderPixels } from './renderer-registry.js';
import {
	CHARACTER_SETS,
	DEFAULT_SETTINGS,
	validateSettings,
	type AppSettings,
	type CharacterSet,
	type RenderMode,
	type ThemeMode,
} from './settings.js';

const SETTINGS_KEY = 'ascii-image-art.settings.v2';
const PRESETS_KEY = 'ascii-image-art.presets.v1';
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 80_000_000;
const MAX_HISTORY = 40;

type OutputView = 'result' | 'original' | 'compare';

interface SavedPreset {
	name: string;
	settings: AppSettings;
}

interface RenderResponse {
	jobId: number;
	rows: string[];
}

const builtInPresets: Record<string, Partial<AppSettings>> = {
	portrait: { width: 72, aspectRatio: 0.48, mode: 'ascii', characterSet: 'detailed' },
	landscape: { width: 120, aspectRatio: 0.5, mode: 'ascii', characterSet: 'standard' },
	highContrast: { width: 100, contrast: 24, brightness: 3, gamma: 0.9 },
	detailed: { width: 160, aspectRatio: 0.5, mode: 'ascii', characterSet: 'retro' },
	terminal: { width: 80, aspectRatio: 0.5, mode: 'ascii', characterSet: 'terminal' },
	braille: { width: 100, aspectRatio: 0.5, mode: 'braille', ditherer: 'floydSteinberg' },
	minimal: { width: 80, mode: 'ascii', characterSet: 'minimal' },
	maximum: { width: 200, mode: 'braille', ditherer: 'stucki' },
};

function getElement<T extends HTMLElement>( selector: string ) {
	const element = document.querySelector<T>( selector );
	if ( !element ) throw new Error( `Required interface element not found: ${selector}` );
	return element;
}

function loadSettings() {
	try {
		const saved = localStorage.getItem( SETTINGS_KEY );
		return saved ? validateSettings( JSON.parse( saved ) as Partial<AppSettings> ) : { ...DEFAULT_SETTINGS };
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

function loadCustomPresets(): SavedPreset[] {
	try {
		const value: unknown = JSON.parse( localStorage.getItem( PRESETS_KEY ) ?? '[]' );
		if ( !Array.isArray( value ) ) return [];
		return value.filter( ( item ): item is SavedPreset => typeof item?.name === 'string' && !!item.settings )
			.map( item => ( { name: item.name.slice( 0, 40 ), settings: validateSettings( item.settings ) } ) );
	} catch {
		return [];
	}
}

let settings = loadSettings();
let bitmap: ImageBitmap | null = null;
let currentFileName = 'image';
let previewUrl = '';
let ascii = '';
let view: OutputView = 'result';
let zoom = 1;
let renderWorker: Worker | null = null;
let workerFailed = false;
let workerBusy = false;
let renderId = 0;
let frameId = 0;
let loadId = 0;
let rangeSnapshot: AppSettings | null = null;
let customPresets = loadCustomPresets();
const undoHistory: AppSettings[] = [];
const redoHistory: AppSettings[] = [];

const filePicker = getElement<HTMLInputElement>( '#filepicker' );
const output = getElement<HTMLPreElement>( '#output' );
const compareOutput = getElement<HTMLPreElement>( '#compare-output' );
const sourcePreview = getElement<HTMLImageElement>( '#source-preview' );
const comparePreview = getElement<HTMLImageElement>( '#compare-image' );
const emptyState = getElement<HTMLElement>( '#empty-state' );
const errorMessage = getElement<HTMLElement>( '#error-message' );
const status = getElement<HTMLElement>( '#render-status' );

function announce( message: string, state: 'ready' | 'working' | 'done' | 'error' = 'ready' ) {
	status.textContent = message;
	status.dataset.state = state;
}

function showError( message: string ) {
	errorMessage.textContent = message;
	errorMessage.hidden = false;
	announce( message, 'error' );
}

function clearError() {
	errorMessage.hidden = true;
	errorMessage.textContent = '';
}

function persistSettings() {
	try {
		localStorage.setItem( SETTINGS_KEY, JSON.stringify( settings ) );
	} catch {
		announce( 'Settings could not be saved in this browser.', 'error' );
	}
}

function persistCustomPresets() {
	try {
		localStorage.setItem( PRESETS_KEY, JSON.stringify( customPresets ) );
	} catch {
		announce( 'Custom presets could not be saved in this browser.', 'error' );
	}
}

function remember( stack: AppSettings[], value: AppSettings ) {
	stack.push( { ...value } );
	if ( stack.length > MAX_HISTORY ) stack.shift();
}

function setSettings( patch: Partial<AppSettings>, record = true, redraw = true ) {
	if ( record ) {
		remember( undoHistory, settings );
		redoHistory.length = 0;
	}
	settings = validateSettings( { ...settings, ...patch } );
	clearError();
	syncControls();
	persistSettings();
	updateHistoryButtons();
	if ( redraw ) queueRender();
}

function syncControls() {
	getElement<HTMLSelectElement>( '#render-mode' ).value = settings.mode;
	getElement<HTMLSelectElement>( '#character-set' ).value = settings.characterSet;
	getElement<HTMLInputElement>( '#characters' ).value = settings.characters;
	getElement<HTMLInputElement>( '#width-number' ).value = settings.width.toString();
	getElement<HTMLInputElement>( '#width-slider' ).value = settings.width.toString();
	getElement<HTMLInputElement>( '#aspect-ratio' ).value = settings.aspectRatio.toString();
	getElement<HTMLSelectElement>( '#dither' ).value = settings.ditherer;
	getElement<HTMLInputElement>( '#threshold' ).value = settings.threshold.toString();
	getElement<HTMLInputElement>( '#brightness' ).value = settings.brightness.toString();
	getElement<HTMLInputElement>( '#contrast' ).value = settings.contrast.toString();
	getElement<HTMLInputElement>( '#gamma' ).value = settings.gamma.toString();
		getElement<HTMLInputElement>( '#exposure' ).value = settings.exposure.toString();
		getElement<HTMLInputElement>( '#saturation' ).value = settings.saturation.toString();
		getElement<HTMLInputElement>( '#sharpness' ).value = settings.sharpness.toString();
		getElement<HTMLInputElement>( '#blur' ).value = settings.blur.toString();
		getElement<HTMLInputElement>( '#black-point' ).value = settings.blackPoint.toString();
		getElement<HTMLInputElement>( '#white-point' ).value = settings.whitePoint.toString();
	getElement<HTMLInputElement>( '#invert' ).checked = settings.invert;
	getElement<HTMLInputElement>( '#reverse-palette' ).checked = settings.reversePalette;
	getElement<HTMLInputElement>( '#swap-dots' ).checked = settings.swapDotsAndSpaces;
	getElement<HTMLInputElement>( '#compact-whitespace' ).checked = settings.compactWhitespace;
	getElement<HTMLInputElement>( '#mirror' ).checked = settings.mirror;
	getElement<HTMLInputElement>( '#font-size' ).value = settings.fontSize.toString();
	getElement<HTMLInputElement>( '#line-height' ).value = settings.lineHeight.toString();
	getElement<HTMLInputElement>( '#letter-spacing' ).value = settings.letterSpacing.toString();
	getElement<HTMLButtonElement>( '#theme-toggle' ).textContent = `Theme: ${settings.theme}`;
	getElement<HTMLElement>( '#character-set-field' ).hidden = settings.mode !== 'ascii';
	getElement<HTMLElement>( '#characters-field' ).hidden = settings.mode !== 'ascii';
	getElement<HTMLElement>( '#reverse-palette-field' ).hidden = settings.mode !== 'ascii';
	getElement<HTMLElement>( '#dither-field' ).hidden = settings.mode !== 'braille';
	getElement<HTMLElement>( '#threshold-field' ).hidden = settings.mode !== 'braille';
	getElement<HTMLElement>( '#swap-dots-field' ).hidden = settings.mode !== 'braille';
	document.documentElement.style.setProperty( '--font-size', `${settings.fontSize * zoom}px` );
	document.documentElement.style.setProperty( '--line-height', settings.lineHeight.toString() );
	document.documentElement.style.setProperty( '--letter-spacing', `${settings.letterSpacing}em` );
	document.documentElement.dataset.theme = settings.theme;
	const dark = settings.theme === 'dark' || ( settings.theme === 'system' && matchMedia( '(prefers-color-scheme: dark)' ).matches );
	document.documentElement.classList.toggle( 'theme-dark', dark );
	getElement<HTMLElement>( '#palette-preview' ).textContent = settings.reversePalette
		? Array.from( settings.characters ).reverse().join( '' )
		: settings.characters;
}

function updateHistoryButtons() {
	getElement<HTMLButtonElement>( '#undo' ).disabled = undoHistory.length === 0;
	getElement<HTMLButtonElement>( '#redo' ).disabled = redoHistory.length === 0;
}

function restoreSettings( stack: AppSettings[], other: AppSettings[] ) {
	const previous = stack.pop();
	if ( !previous ) return;
	remember( other, settings );
	settings = validateSettings( previous );
	syncControls();
	persistSettings();
	updateHistoryButtons();
	queueRender();
}

function bindRange( selector: string, key: keyof AppSettings, parse: ( value: string ) => number ) {
	const input = getElement<HTMLInputElement>( selector );
	const begin = () => { rangeSnapshot ??= { ...settings }; };
	input.addEventListener( 'pointerdown', begin );
	input.addEventListener( 'focus', begin );
	input.addEventListener( 'input', () => setSettings( { [ key ]: parse( input.value ) } as Partial<AppSettings>, false ) );
	input.addEventListener( 'change', () => {
		if ( rangeSnapshot ) remember( undoHistory, rangeSnapshot );
		rangeSnapshot = null;
		redoHistory.length = 0;
		persistSettings();
		updateHistoryButtons();
	} );
}

function wireControls() {
	getElement<HTMLButtonElement>( '#choose-file' ).addEventListener( 'click', () => filePicker.click() );
	filePicker.addEventListener( 'change', () => {
		const file = filePicker.files?.[ 0 ];
		if ( file ) void loadImage( file );
		filePicker.value = '';
	} );

	getElement<HTMLSelectElement>( '#render-mode' ).addEventListener( 'change', event => setSettings( { mode: ( event.currentTarget as HTMLSelectElement ).value as RenderMode } ) );
	getElement<HTMLSelectElement>( '#character-set' ).addEventListener( 'change', event => {
		const name = ( event.currentTarget as HTMLSelectElement ).value as CharacterSet;
		setSettings( name === 'custom' ? { characterSet: name } : { characterSet: name, characters: CHARACTER_SETS[ name ] } );
	} );
	getElement<HTMLInputElement>( '#characters' ).addEventListener( 'input', event => {
		const characters = Array.from( ( event.currentTarget as HTMLInputElement ).value ).filter( char => char !== '\n' && char !== '\r' ).slice( 0, 128 ).join( '' );
		if ( !characters.trim() ) {
			showError( 'Enter at least one visible character for the custom palette.' );
			return;
		}
		setSettings( { characterSet: 'custom', characters }, false );
	} );
	getElement<HTMLInputElement>( '#characters' ).addEventListener( 'change', () => commitRangeEdit() );
	getElement<HTMLInputElement>( '#characters' ).addEventListener( 'focus', () => { rangeSnapshot ??= { ...settings }; } );

	bindRange( '#width-slider', 'width', Number );
	getElement<HTMLInputElement>( '#width-number' ).addEventListener( 'change', event => setSettings( { width: Number( ( event.currentTarget as HTMLInputElement ).value ) }, false ) );
	getElement<HTMLInputElement>( '#width-number' ).addEventListener( 'input', event => {
		const input = event.currentTarget as HTMLInputElement;
		if ( input.value !== '' ) setSettings( { width: Number( input.value ) }, false );
	} );
	getElement<HTMLInputElement>( '#width-number' ).addEventListener( 'change', () => commitRangeEdit() );
	getElement<HTMLInputElement>( '#width-number' ).addEventListener( 'focus', () => { rangeSnapshot ??= { ...settings }; } );
	bindRange( '#aspect-ratio', 'aspectRatio', Number );
	bindRange( '#threshold', 'threshold', Number );
	bindRange( '#brightness', 'brightness', Number );
	bindRange( '#contrast', 'contrast', Number );
	bindRange( '#gamma', 'gamma', Number );
	bindRange( '#exposure', 'exposure', Number );
	bindRange( '#saturation', 'saturation', Number );
	bindRange( '#sharpness', 'sharpness', Number );
	bindRange( '#blur', 'blur', Number );
	bindRange( '#black-point', 'blackPoint', Number );
	bindRange( '#white-point', 'whitePoint', Number );
	bindRange( '#font-size', 'fontSize', Number );
	bindRange( '#line-height', 'lineHeight', Number );
	bindRange( '#letter-spacing', 'letterSpacing', Number );

	for ( const [ selector, key ] of [
		[ '#invert', 'invert' ], [ '#reverse-palette', 'reversePalette' ], [ '#swap-dots', 'swapDotsAndSpaces' ],
		[ '#compact-whitespace', 'compactWhitespace' ], [ '#mirror', 'mirror' ],
	] as const ) {
		getElement<HTMLInputElement>( selector ).addEventListener( 'change', event => setSettings( { [ key ]: ( event.currentTarget as HTMLInputElement ).checked } ) );
	}
	getElement<HTMLSelectElement>( '#dither' ).addEventListener( 'change', event => setSettings( { ditherer: ( event.currentTarget as HTMLSelectElement ).value as AppSettings[ 'ditherer' ] } ) );
	getElement<HTMLSelectElement>( '#preset-select' ).addEventListener( 'change', event => applyPreset( ( event.currentTarget as HTMLSelectElement ).value ) );
	for ( const button of document.querySelectorAll<HTMLButtonElement>( '[data-width]' ) ) {
		button.addEventListener( 'click', () => setSettings( { width: Number( button.dataset.width ) } ) );
	}
	getElement<HTMLButtonElement>( '#save-preset' ).addEventListener( 'click', savePreset );
	getElement<HTMLButtonElement>( '#delete-preset' ).addEventListener( 'click', deletePreset );
	getElement<HTMLButtonElement>( '#undo' ).addEventListener( 'click', () => restoreSettings( undoHistory, redoHistory ) );
	getElement<HTMLButtonElement>( '#redo' ).addEventListener( 'click', () => restoreSettings( redoHistory, undoHistory ) );
	getElement<HTMLButtonElement>( '#reset' ).addEventListener( 'click', resetSettings );
	getElement<HTMLButtonElement>( '#reset-preferences' ).addEventListener( 'click', resetPreferences );
	getElement<HTMLButtonElement>( '#theme-toggle' ).addEventListener( 'click', cycleTheme );
	getElement<HTMLButtonElement>( '#copy' ).addEventListener( 'click', () => void copyOutput() );
	getElement<HTMLButtonElement>( '#download-txt' ).addEventListener( 'click', () => downloadText() );
	getElement<HTMLButtonElement>( '#download-html' ).addEventListener( 'click', () => downloadHtml() );
	getElement<HTMLButtonElement>( '#download-svg' ).addEventListener( 'click', () => downloadSvg() );
	getElement<HTMLButtonElement>( '#download-png' ).addEventListener( 'click', () => void downloadPng() );
	getElement<HTMLButtonElement>( '#zoom-in' ).addEventListener( 'click', () => setZoom( Math.min( 2.5, zoom + 0.15 ) ) );
	getElement<HTMLButtonElement>( '#zoom-out' ).addEventListener( 'click', () => setZoom( Math.max( 0.5, zoom - 0.15 ) ) );
	getElement<HTMLButtonElement>( '#zoom-fit' ).addEventListener( 'click', fitZoom );
	getElement<HTMLButtonElement>( '#help' ).addEventListener( 'click', openHelp );
	getElement<HTMLButtonElement>( '#close-help' ).addEventListener( 'click', () => getElement<HTMLDialogElement>( '#shortcuts-dialog' ).close() );

	for ( const button of document.querySelectorAll<HTMLButtonElement>( '[data-view]' ) ) {
		button.addEventListener( 'click', () => setView( button.dataset.view as OutputView ) );
	}
	wireDropTarget();
	wireShortcuts();
	updatePresetOptions();
}

function commitRangeEdit() {
	if ( rangeSnapshot ) remember( undoHistory, rangeSnapshot );
	rangeSnapshot = null;
	redoHistory.length = 0;
	persistSettings();
	updateHistoryButtons();
}

function applyPreset( name: string ) {
	const customName = name.startsWith( 'custom:' ) ? name.slice( 7 ) : '';
	const preset = builtInPresets[ name ] ?? customPresets.find( item => item.name === customName )?.settings;
	if ( preset ) {
		const palette = preset.characterSet && preset.characterSet !== 'custom' && !preset.characters
			? { characters: CHARACTER_SETS[ preset.characterSet ] }
			: {};
		setSettings( { ...preset, ...palette } );
	}
}

function updatePresetOptions() {
	const select = getElement<HTMLSelectElement>( '#preset-select' );
	const selected = select.value;
	select.replaceChildren();
	for ( const [ label, value ] of [ [ 'Choose preset…', '' ], [ 'Portrait', 'portrait' ], [ 'Landscape', 'landscape' ], [ 'High Contrast', 'highContrast' ], [ 'Detailed', 'detailed' ], [ 'Terminal', 'terminal' ], [ 'Braille', 'braille' ], [ 'Minimal', 'minimal' ], [ 'Maximum Detail', 'maximum' ] ] ) {
		const option = document.createElement( 'option' );
		option.textContent = label;
		option.value = value;
		select.append( option );
	}
	if ( customPresets.length ) {
		const group = document.createElement( 'optgroup' );
		group.label = 'Saved presets';
		for ( const preset of customPresets ) {
			const option = document.createElement( 'option' );
			option.textContent = preset.name;
			option.value = `custom:${preset.name}`;
			group.append( option );
		}
		select.append( group );
	}
	select.value = selected;
}

function savePreset() {
	const name = prompt( 'Name this preset' )?.trim().slice( 0, 40 );
	if ( !name ) return;
	customPresets = [ ...customPresets.filter( preset => preset.name !== name ), { name, settings: { ...settings } } ];
	persistCustomPresets();
	updatePresetOptions();
	getElement<HTMLSelectElement>( '#preset-select' ).value = `custom:${name}`;
	announce( `Preset “${name}” saved.`, 'done' );
}

function deletePreset() {
	const select = getElement<HTMLSelectElement>( '#preset-select' );
	const name = select.value.startsWith( 'custom:' ) ? select.value.slice( 7 ) : '';
	if ( !name ) {
		announce( 'Choose a saved preset to remove.', 'ready' );
		return;
	}
	customPresets = customPresets.filter( preset => preset.name !== name );
	persistCustomPresets();
	updatePresetOptions();
	announce( `Preset “${name}” removed.`, 'done' );
}

function resetSettings() {
	zoom = 1;
	setSettings( { ...DEFAULT_SETTINGS } );
	setZoom( 1 );
	getElement<HTMLSelectElement>( '#preset-select' ).value = '';
}

function resetPreferences() {
	try {
		localStorage.removeItem( SETTINGS_KEY );
		localStorage.removeItem( PRESETS_KEY );
	} catch { /* Storage can be disabled by the browser. */ }
	customPresets = [];
	undoHistory.length = 0;
	redoHistory.length = 0;
	settings = { ...DEFAULT_SETTINGS };
	updatePresetOptions();
	syncControls();
	updateHistoryButtons();
	queueRender();
	announce( 'Preferences reset.', 'done' );
}

function cycleTheme() {
	const themes: ThemeMode[] = [ 'system', 'light', 'dark' ];
	const next = themes[ ( themes.indexOf( settings.theme ) + 1 ) % themes.length ];
	setSettings( { theme: next }, true, false );
}

function setZoom( value: number ) {
	zoom = Math.max( 0.3, Math.min( 2.5, value ) );
	document.documentElement.style.setProperty( '--font-size', `${settings.fontSize * zoom}px` );
	getElement<HTMLElement>( '#zoom-level' ).textContent = `${Math.round( zoom * 100 )}%`;
}

function fitZoom() {
	if ( !ascii ) return setZoom( 1 );
	const stage = getElement<HTMLElement>( '#preview-stage' );
	const lines = ascii.split( '\n' );
	const columns = lines.reduce( ( widest, line ) => Math.max( widest, Array.from( line ).length ), 0 );
	const availableWidth = Math.max( 1, stage.clientWidth - 48 );
	const availableHeight = Math.max( 1, stage.clientHeight - 48 );
	const baseFontSize = settings.fontSize;
	const widthZoom = availableWidth / Math.max( 1, columns * baseFontSize * 0.62 );
	const heightZoom = availableHeight / Math.max( 1, lines.length * baseFontSize * settings.lineHeight );
	setZoom( Math.min( 1, widthZoom, heightZoom ) );
}

function setView( nextView: OutputView ) {
	view = nextView;
	for ( const button of document.querySelectorAll<HTMLButtonElement>( '[data-view]' ) ) {
		const active = button.dataset.view === view;
		button.setAttribute( 'aria-selected', String( active ) );
	}
	getElement<HTMLElement>( '#result-view' ).hidden = view !== 'result' || !bitmap;
	getElement<HTMLElement>( '#original-view' ).hidden = view !== 'original' || !bitmap;
	getElement<HTMLElement>( '#compare-view' ).hidden = view !== 'compare' || !bitmap;
	getElement<HTMLElement>( '#empty-state' ).hidden = !!bitmap;
}

function wireDropTarget() {
	const target = getElement<HTMLElement>( '#drop-zone' );
	target.addEventListener( 'click', () => filePicker.click() );
	target.addEventListener( 'keydown', event => {
		if ( event.key === 'Enter' || event.key === ' ' ) {
			event.preventDefault();
			filePicker.click();
		}
	} );
	target.addEventListener( 'dragover', event => {
		event.preventDefault();
		target.classList.add( 'is-dragging' );
	} );
	target.addEventListener( 'dragleave', event => {
		if ( !target.contains( event.relatedTarget as Node | null ) ) target.classList.remove( 'is-dragging' );
	} );
	target.addEventListener( 'drop', event => {
		event.preventDefault();
		target.classList.remove( 'is-dragging' );
		const file = ( event as DragEvent ).dataTransfer?.files[ 0 ];
		if ( file ) void loadImage( file );
	} );
	document.addEventListener( 'paste', event => {
		const targetElement = event.target as HTMLElement;
		if ( targetElement.closest( 'input, textarea, select, [contenteditable="true"]' ) ) return;
		const file = Array.from( ( event as ClipboardEvent ).clipboardData?.items ?? [] )
			.find( item => item.type.startsWith( 'image/' ) )?.getAsFile();
		if ( file ) {
			event.preventDefault();
			void loadImage( file );
		}
	} );
}

async function loadImage( file: File ) {
	const id = ++loadId;
	clearError();
	if ( !file.size ) return showError( 'That file is empty. Choose a non-empty image.' );
	if ( file.size > MAX_FILE_BYTES ) return showError( 'Images must be smaller than 40 MB.' );
	if ( !file.type.startsWith( 'image/' ) && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test( file.name ) ) {
		return showError( 'Choose a browser-supported image such as PNG, JPEG, WebP, GIF, or BMP.' );
	}

	announce( 'Loading image…', 'working' );
	try {
		const decoded = await createImageBitmap( file );
		if ( id !== loadId ) {
			decoded.close();
			return;
		}
		if ( decoded.width * decoded.height > MAX_SOURCE_PIXELS || decoded.width > 20000 || decoded.height > 20000 ) {
			decoded.close();
			return showError( 'This image is too large to process reliably. Resize it and try again.' );
		}
		bitmap?.close();
		bitmap = decoded;
		currentFileName = file.name.replace( /\.[^.]+$/, '' ) || 'image';
		if ( previewUrl ) URL.revokeObjectURL( previewUrl );
		previewUrl = URL.createObjectURL( file );
		sourcePreview.src = previewUrl;
		comparePreview.src = previewUrl;
		emptyState.hidden = true;
		getElement<HTMLElement>( '#image-metadata' ).hidden = false;
		getElement<HTMLElement>( '#filename' ).textContent = file.name;
		getElement<HTMLElement>( '#image-dimensions' ).textContent = `${decoded.width.toLocaleString()} × ${decoded.height.toLocaleString()}`;
		getElement<HTMLElement>( '#image-size' ).textContent = formatBytes( file.size );
		getElement<HTMLElement>( '#image-format' ).textContent = file.type.replace( 'image/', '' ).toUpperCase() || 'Image';
		getElement<HTMLButtonElement>( '#copy' ).disabled = true;
		setView( view );
		queueRender();
	} catch ( error ) {
		if ( id !== loadId ) return;
		console.error( 'Image decode failed', error );
		showError( 'The image could not be decoded. It may be corrupted or unsupported by this browser.' );
	}
}

function formatBytes( bytes: number ) {
	if ( bytes < 1024 * 1024 ) return `${Math.max( 1, Math.round( bytes / 1024 ) )} KB`;
	return `${( bytes / 1024 / 1024 ).toFixed( 1 )} MB`;
}

function queueRender() {
	if ( frameId ) cancelAnimationFrame( frameId );
	frameId = requestAnimationFrame( () => {
		frameId = 0;
		render();
	} );
}

function ensureWorker() {
	if ( workerFailed || renderWorker ) return renderWorker;
	try {
		renderWorker = new Worker( new URL( './render-worker.js', import.meta.url ), { type: 'module' } );
		renderWorker.addEventListener( 'message', ( event: MessageEvent<RenderResponse> ) => {
			workerBusy = false;
			if ( event.data.jobId !== renderId ) return;
			finishRender( event.data.jobId, event.data.rows );
		} );
		renderWorker.addEventListener( 'error', error => {
			console.error( 'Render worker failed; switching to main-thread rendering', error );
			renderWorker?.terminate();
			renderWorker = null;
			workerBusy = false;
			workerFailed = true;
			queueRender();
		} );
	} catch ( error ) {
		console.warn( 'Render worker is unavailable; using the main thread.', error );
		workerFailed = true;
	}
	return renderWorker;
}

let renderStartedAt = 0;
let outputLimited = false;

function render() {
	if ( !bitmap ) return;
	if ( renderWorker && workerBusy ) {
		renderWorker.terminate();
		renderWorker = null;
		workerBusy = false;
	}
	const jobId = ++renderId;
	renderStartedAt = performance.now();
	clearError();
	announce( 'Rendering…', 'working' );
	try {
		const prepared = prepareImage( bitmap, bitmap.width, bitmap.height, settings );
		outputLimited = prepared.limited;
		const activeWorker = ensureWorker();
		if ( activeWorker ) {
			const buffer = prepared.pixels.data.buffer as ArrayBuffer;
			activeWorker.postMessage( {
				jobId,
				mode: settings.mode,
				width: prepared.pixels.width,
				height: prepared.pixels.height,
				pixels: buffer,
				settings: {
					invert: settings.invert,
					swapDotsAndSpaces: settings.swapDotsAndSpaces,
					compactWhitespace: settings.compactWhitespace,
					characters: settings.characters,
					reversePalette: settings.reversePalette,
					ditherer: settings.ditherer,
					threshold: settings.threshold,
				},
			}, [ buffer ] );
			workerBusy = true;
			return;
		}
		const rows = renderPixels( settings.mode, prepared.pixels, prepared.pixels.width, prepared.pixels.height, settings );
		finishRender( jobId, rows );
	} catch ( error ) {
		console.error( 'Image rendering failed', error );
		showError( 'Rendering failed. Try a smaller width or a different image.' );
	}
}

function finishRender( jobId: number, rows: string[] ) {
	if ( jobId !== renderId ) return;
	ascii = rows.join( '\n' );
	output.textContent = ascii;
	compareOutput.textContent = ascii;
	output.hidden = false;
	compareOutput.hidden = false;
	getElement<HTMLButtonElement>( '#copy' ).disabled = !ascii;
	const visibleColumns = rows.reduce( ( maximum, row ) => Math.max( maximum, Array.from( row ).length ), 0 );
	const visibleCharacters = Array.from( ascii.replace( /\n/g, '' ) ).length;
	getElement<HTMLElement>( '#columns' ).textContent = visibleColumns.toLocaleString();
	getElement<HTMLElement>( '#rows' ).textContent = rows.length.toLocaleString();
	getElement<HTMLElement>( '#character-count' ).textContent = visibleCharacters.toLocaleString();
	getElement<HTMLElement>( '#render-time' ).textContent = `${Math.round( performance.now() - renderStartedAt )} ms`;
	setView( view );
	announce( outputLimited ? 'Ready · output capped to protect performance.' : 'Ready', 'done' );
}

async function copyOutput() {
	if ( !ascii ) return;
	try {
		if ( navigator.clipboard?.writeText ) {
			await navigator.clipboard.writeText( ascii );
		} else {
			fallbackCopy();
		}
		announce( 'ASCII copied to clipboard.', 'done' );
	} catch ( error ) {
		console.error( 'Clipboard write failed', error );
		try {
			fallbackCopy();
			announce( 'ASCII copied to clipboard.', 'done' );
		} catch {
			showError( 'Clipboard access was blocked. Select the output and copy it manually.' );
		}
	}
}

function fallbackCopy() {
	const textArea = document.createElement( 'textarea' );
	textArea.value = ascii;
	textArea.setAttribute( 'readonly', '' );
	textArea.style.position = 'fixed';
	textArea.style.opacity = '0';
	document.body.append( textArea );
	textArea.select();
	const copied = document.execCommand( 'copy' );
	textArea.remove();
	if ( !copied ) throw new Error( 'Legacy copy command failed.' );
}

function safeBaseName() {
	return currentFileName.replace( /[^a-z0-9_-]+/gi, '-' ).replace( /^-+|-+$/g, '' ) || 'image';
}

function downloadBlob( blob: Blob, extension: string ) {
	const url = URL.createObjectURL( blob );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = `${safeBaseName()}-ascii-${settings.width}.${extension}`;
	link.click();
	window.setTimeout( () => URL.revokeObjectURL( url ), 1000 );
}

function downloadText() {
	if ( !ascii ) return;
	downloadBlob( new Blob( [ ascii ], { type: 'text/plain;charset=utf-8' } ), 'txt' );
	announce( 'Text file downloaded.', 'done' );
}

function escapeHtml( text: string ) {
	return text.replace( /&/g, '&amp;' ).replace( /</g, '&lt;' ).replace( />/g, '&gt;' );
}

function downloadHtml() {
	if ( !ascii ) return;
	const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${safeBaseName()} ASCII art</title><style>body{margin:2rem;background:#101511;color:#e6f0db}pre{font:${settings.fontSize}px/${settings.lineHeight} ui-monospace,monospace;letter-spacing:${settings.letterSpacing}em;white-space:pre;overflow:auto}</style><pre>${escapeHtml( ascii )}</pre></html>`;
	downloadBlob( new Blob( [ html ], { type: 'text/html;charset=utf-8' } ), 'html' );
}

function downloadSvg() {
	if ( !ascii ) return;
	const lines = ascii.split( '\n' );
	const fontSize = settings.fontSize;
	const lineHeight = fontSize * settings.lineHeight;
	const svgText = lines.map( ( line, index ) => `<text x="16" y="${fontSize + 16 + index * lineHeight}">${escapeHtml( line )}</text>` ).join( '' );
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width * fontSize * 0.62 + 32}" height="${lines.length * lineHeight + 32}"><rect width="100%" height="100%" fill="#101511"/><g fill="#e6f0db" font-family="monospace" font-size="${fontSize}" xml:space="preserve">${svgText}</g></svg>`;
	downloadBlob( new Blob( [ svg ], { type: 'image/svg+xml;charset=utf-8' } ), 'svg' );
}

async function downloadPng() {
	if ( !ascii ) return;
	try {
		const lines = ascii.split( '\n' );
		const canvas = document.createElement( 'canvas' );
		const padding = 24;
		const lineHeight = settings.fontSize * settings.lineHeight;
		canvas.width = Math.ceil( settings.width * settings.fontSize * 0.62 + padding * 2 );
		canvas.height = Math.ceil( lines.length * lineHeight + padding * 2 );
		if ( canvas.width * canvas.height > 40_000_000 ) throw new Error( 'The export would be too large.' );
		const context = canvas.getContext( '2d' );
		if ( !context ) throw new Error( 'Canvas export is unavailable in this browser.' );
		context.fillStyle = '#101511';
		context.fillRect( 0, 0, canvas.width, canvas.height );
		context.fillStyle = '#e6f0db';
		context.font = `${settings.fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
		context.textBaseline = 'top';
		lines.forEach( ( line, index ) => context.fillText( line, padding, padding + index * lineHeight ) );
		const blob = await new Promise<Blob>( ( resolve, reject ) => canvas.toBlob( value => value ? resolve( value ) : reject( new Error( 'PNG encoding failed.' ) ), 'image/png' ) );
		downloadBlob( blob, 'png' );
		announce( 'PNG image downloaded.', 'done' );
	} catch ( error ) {
		showError( error instanceof Error ? error.message : 'PNG export failed.' );
	}
}

function openHelp() {
	const dialog = getElement<HTMLDialogElement>( '#shortcuts-dialog' );
	if ( !dialog.open ) dialog.showModal();
}

function wireShortcuts() {
	document.addEventListener( 'keydown', event => {
		const target = event.target as HTMLElement;
		const editing = !!target.closest( 'input, textarea, select, [contenteditable="true"]' );
		const command = event.ctrlKey || event.metaKey;
		if ( command && event.key.toLowerCase() === 'o' ) {
			event.preventDefault();
			filePicker.click();
		} else if ( command && event.key.toLowerCase() === 'c' && !editing && window.getSelection()?.toString() === '' ) {
			event.preventDefault();
			void copyOutput();
		} else if ( command && event.key.toLowerCase() === 'z' && !editing ) {
			event.preventDefault();
			event.shiftKey ? restoreSettings( redoHistory, undoHistory ) : restoreSettings( undoHistory, redoHistory );
		} else if ( command && event.key.toLowerCase() === 's' ) {
			event.preventDefault();
			downloadText();
		} else if ( !editing && !command && event.key.toLowerCase() === 'r' ) {
			resetSettings();
		} else if ( !editing && event.key === '?' ) {
			openHelp();
		}
	} );
}

function startApp() {
	wireControls();
	syncControls();
	updateHistoryButtons();
	setView( 'result' );
	getElement<HTMLElement>( '#image-metadata' ).hidden = true;
	getElement<HTMLButtonElement>( '#copy' ).disabled = true;
	window.addEventListener( 'beforeunload', () => {
		if ( previewUrl ) URL.revokeObjectURL( previewUrl );
		bitmap?.close();
		renderWorker?.terminate();
	} );
}

startApp();