import { prepareImage } from './image-pipeline.js';
import { renderPixels } from './renderer-registry.js';
import { CHARACTER_SETS, DEFAULT_SETTINGS, validateSettings, } from './settings.js';
const SETTINGS_KEY = 'ascii-image-art.settings.v2';
const PRESETS_KEY = 'ascii-image-art.presets.v1';
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 80_000_000;
const MAX_HISTORY = 40;
const builtInPresets = {
    portrait: { width: 72, aspectRatio: 0.48, mode: 'ascii', characterSet: 'detailed' },
    landscape: { width: 120, aspectRatio: 0.5, mode: 'ascii', characterSet: 'standard' },
    highContrast: { width: 100, contrast: 24, brightness: 3, gamma: 0.9 },
    detailed: { width: 160, aspectRatio: 0.5, mode: 'ascii', characterSet: 'retro' },
    terminal: { width: 80, aspectRatio: 0.5, mode: 'ascii', characterSet: 'terminal' },
    braille: { width: 100, aspectRatio: 0.5, mode: 'braille', ditherer: 'floydSteinberg' },
    minimal: { width: 80, mode: 'ascii', characterSet: 'minimal' },
    maximum: { width: 200, mode: 'braille', ditherer: 'stucki' },
};
function getElement(selector) {
    const element = document.querySelector(selector);
    if (!element)
        throw new Error(`Required interface element not found: ${selector}`);
    return element;
}
function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        return saved ? validateSettings(JSON.parse(saved)) : { ...DEFAULT_SETTINGS };
    }
    catch {
        return { ...DEFAULT_SETTINGS };
    }
}
function loadCustomPresets() {
    try {
        const value = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
        if (!Array.isArray(value))
            return [];
        return value.filter((item) => typeof item?.name === 'string' && !!item.settings)
            .map(item => ({ name: item.name.slice(0, 40), settings: validateSettings(item.settings) }));
    }
    catch {
        return [];
    }
}
let settings = loadSettings();
let bitmap = null;
let currentFileName = 'image';
let previewUrl = '';
let ascii = '';
let view = 'result';
let zoom = 1;
let renderWorker = null;
let workerFailed = false;
let workerBusy = false;
let renderId = 0;
let frameId = 0;
let loadId = 0;
let rangeSnapshot = null;
let customPresets = loadCustomPresets();
const undoHistory = [];
const redoHistory = [];
const filePicker = getElement('#filepicker');
const output = getElement('#output');
const compareOutput = getElement('#compare-output');
const sourcePreview = getElement('#source-preview');
const comparePreview = getElement('#compare-image');
const emptyState = getElement('#empty-state');
const errorMessage = getElement('#error-message');
const status = getElement('#render-status');
function announce(message, state = 'ready') {
    status.textContent = message;
    status.dataset.state = state;
}
function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
    announce(message, 'error');
}
function clearError() {
    errorMessage.hidden = true;
    errorMessage.textContent = '';
}
function persistSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
    catch {
        announce('Settings could not be saved in this browser.', 'error');
    }
}
function persistCustomPresets() {
    try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(customPresets));
    }
    catch {
        announce('Custom presets could not be saved in this browser.', 'error');
    }
}
function remember(stack, value) {
    stack.push({ ...value });
    if (stack.length > MAX_HISTORY)
        stack.shift();
}
function setSettings(patch, record = true, redraw = true) {
    if (record) {
        remember(undoHistory, settings);
        redoHistory.length = 0;
    }
    settings = validateSettings({ ...settings, ...patch });
    clearError();
    syncControls();
    persistSettings();
    updateHistoryButtons();
    if (redraw)
        queueRender();
}
function syncControls() {
    getElement('#render-mode').value = settings.mode;
    getElement('#character-set').value = settings.characterSet;
    getElement('#characters').value = settings.characters;
    getElement('#width-number').value = settings.width.toString();
    getElement('#width-slider').value = settings.width.toString();
    getElement('#aspect-ratio').value = settings.aspectRatio.toString();
    getElement('#dither').value = settings.ditherer;
    getElement('#threshold').value = settings.threshold.toString();
    getElement('#brightness').value = settings.brightness.toString();
    getElement('#contrast').value = settings.contrast.toString();
    getElement('#gamma').value = settings.gamma.toString();
    getElement('#exposure').value = settings.exposure.toString();
    getElement('#saturation').value = settings.saturation.toString();
    getElement('#sharpness').value = settings.sharpness.toString();
    getElement('#blur').value = settings.blur.toString();
    getElement('#black-point').value = settings.blackPoint.toString();
    getElement('#white-point').value = settings.whitePoint.toString();
    getElement('#invert').checked = settings.invert;
    getElement('#reverse-palette').checked = settings.reversePalette;
    getElement('#swap-dots').checked = settings.swapDotsAndSpaces;
    getElement('#compact-whitespace').checked = settings.compactWhitespace;
    getElement('#mirror').checked = settings.mirror;
    getElement('#font-size').value = settings.fontSize.toString();
    getElement('#line-height').value = settings.lineHeight.toString();
    getElement('#letter-spacing').value = settings.letterSpacing.toString();
    getElement('#theme-toggle').textContent = `Theme: ${settings.theme}`;
    getElement('#character-set-field').hidden = settings.mode !== 'ascii';
    getElement('#characters-field').hidden = settings.mode !== 'ascii';
    getElement('#reverse-palette-field').hidden = settings.mode !== 'ascii';
    getElement('#dither-field').hidden = settings.mode !== 'braille';
    getElement('#threshold-field').hidden = settings.mode !== 'braille';
    getElement('#swap-dots-field').hidden = settings.mode !== 'braille';
    document.documentElement.style.setProperty('--font-size', `${settings.fontSize * zoom}px`);
    document.documentElement.style.setProperty('--line-height', settings.lineHeight.toString());
    document.documentElement.style.setProperty('--letter-spacing', `${settings.letterSpacing}em`);
    document.documentElement.dataset.theme = settings.theme;
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('theme-dark', dark);
    getElement('#palette-preview').textContent = settings.reversePalette
        ? Array.from(settings.characters).reverse().join('')
        : settings.characters;
}
function updateHistoryButtons() {
    getElement('#undo').disabled = undoHistory.length === 0;
    getElement('#redo').disabled = redoHistory.length === 0;
}
function restoreSettings(stack, other) {
    const previous = stack.pop();
    if (!previous)
        return;
    remember(other, settings);
    settings = validateSettings(previous);
    syncControls();
    persistSettings();
    updateHistoryButtons();
    queueRender();
}
function bindRange(selector, key, parse) {
    const input = getElement(selector);
    const begin = () => { rangeSnapshot ??= { ...settings }; };
    input.addEventListener('pointerdown', begin);
    input.addEventListener('focus', begin);
    input.addEventListener('input', () => setSettings({ [key]: parse(input.value) }, false));
    input.addEventListener('change', () => {
        if (rangeSnapshot)
            remember(undoHistory, rangeSnapshot);
        rangeSnapshot = null;
        redoHistory.length = 0;
        persistSettings();
        updateHistoryButtons();
    });
}
function wireControls() {
    getElement('#choose-file').addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', () => {
        const file = filePicker.files?.[0];
        if (file)
            void loadImage(file);
        filePicker.value = '';
    });
    getElement('#render-mode').addEventListener('change', event => setSettings({ mode: event.currentTarget.value }));
    getElement('#character-set').addEventListener('change', event => {
        const name = event.currentTarget.value;
        setSettings(name === 'custom' ? { characterSet: name } : { characterSet: name, characters: CHARACTER_SETS[name] });
    });
    getElement('#characters').addEventListener('input', event => {
        const characters = Array.from(event.currentTarget.value).filter(char => char !== '\n' && char !== '\r').slice(0, 128).join('');
        if (!characters.trim()) {
            showError('Enter at least one visible character for the custom palette.');
            return;
        }
        setSettings({ characterSet: 'custom', characters }, false);
    });
    getElement('#characters').addEventListener('change', () => commitRangeEdit());
    getElement('#characters').addEventListener('focus', () => { rangeSnapshot ??= { ...settings }; });
    bindRange('#width-slider', 'width', Number);
    getElement('#width-number').addEventListener('change', event => setSettings({ width: Number(event.currentTarget.value) }, false));
    getElement('#width-number').addEventListener('input', event => {
        const input = event.currentTarget;
        if (input.value !== '')
            setSettings({ width: Number(input.value) }, false);
    });
    getElement('#width-number').addEventListener('change', () => commitRangeEdit());
    getElement('#width-number').addEventListener('focus', () => { rangeSnapshot ??= { ...settings }; });
    bindRange('#aspect-ratio', 'aspectRatio', Number);
    bindRange('#threshold', 'threshold', Number);
    bindRange('#brightness', 'brightness', Number);
    bindRange('#contrast', 'contrast', Number);
    bindRange('#gamma', 'gamma', Number);
    bindRange('#exposure', 'exposure', Number);
    bindRange('#saturation', 'saturation', Number);
    bindRange('#sharpness', 'sharpness', Number);
    bindRange('#blur', 'blur', Number);
    bindRange('#black-point', 'blackPoint', Number);
    bindRange('#white-point', 'whitePoint', Number);
    bindRange('#font-size', 'fontSize', Number);
    bindRange('#line-height', 'lineHeight', Number);
    bindRange('#letter-spacing', 'letterSpacing', Number);
    for (const [selector, key] of [
        ['#invert', 'invert'], ['#reverse-palette', 'reversePalette'], ['#swap-dots', 'swapDotsAndSpaces'],
        ['#compact-whitespace', 'compactWhitespace'], ['#mirror', 'mirror'],
    ]) {
        getElement(selector).addEventListener('change', event => setSettings({ [key]: event.currentTarget.checked }));
    }
    getElement('#dither').addEventListener('change', event => setSettings({ ditherer: event.currentTarget.value }));
    getElement('#preset-select').addEventListener('change', event => applyPreset(event.currentTarget.value));
    for (const button of document.querySelectorAll('[data-width]')) {
        button.addEventListener('click', () => setSettings({ width: Number(button.dataset.width) }));
    }
    getElement('#save-preset').addEventListener('click', savePreset);
    getElement('#delete-preset').addEventListener('click', deletePreset);
    getElement('#undo').addEventListener('click', () => restoreSettings(undoHistory, redoHistory));
    getElement('#redo').addEventListener('click', () => restoreSettings(redoHistory, undoHistory));
    getElement('#reset').addEventListener('click', resetSettings);
    getElement('#reset-preferences').addEventListener('click', resetPreferences);
    getElement('#theme-toggle').addEventListener('click', cycleTheme);
    getElement('#copy').addEventListener('click', () => void copyOutput());
    getElement('#download-txt').addEventListener('click', () => downloadText());
    getElement('#download-html').addEventListener('click', () => downloadHtml());
    getElement('#download-svg').addEventListener('click', () => downloadSvg());
    getElement('#download-png').addEventListener('click', () => void downloadPng());
    getElement('#zoom-in').addEventListener('click', () => setZoom(Math.min(2.5, zoom + 0.15)));
    getElement('#zoom-out').addEventListener('click', () => setZoom(Math.max(0.5, zoom - 0.15)));
    getElement('#zoom-fit').addEventListener('click', fitZoom);
    getElement('#help').addEventListener('click', openHelp);
    getElement('#close-help').addEventListener('click', () => getElement('#shortcuts-dialog').close());
    for (const button of document.querySelectorAll('[data-view]')) {
        button.addEventListener('click', () => setView(button.dataset.view));
    }
    wireDropTarget();
    wireShortcuts();
    updatePresetOptions();
}
function commitRangeEdit() {
    if (rangeSnapshot)
        remember(undoHistory, rangeSnapshot);
    rangeSnapshot = null;
    redoHistory.length = 0;
    persistSettings();
    updateHistoryButtons();
}
function applyPreset(name) {
    const customName = name.startsWith('custom:') ? name.slice(7) : '';
    const preset = builtInPresets[name] ?? customPresets.find(item => item.name === customName)?.settings;
    if (preset) {
        const palette = preset.characterSet && preset.characterSet !== 'custom' && !preset.characters
            ? { characters: CHARACTER_SETS[preset.characterSet] }
            : {};
        setSettings({ ...preset, ...palette });
    }
}
function updatePresetOptions() {
    const select = getElement('#preset-select');
    const selected = select.value;
    select.replaceChildren();
    for (const [label, value] of [['Choose preset…', ''], ['Portrait', 'portrait'], ['Landscape', 'landscape'], ['High Contrast', 'highContrast'], ['Detailed', 'detailed'], ['Terminal', 'terminal'], ['Braille', 'braille'], ['Minimal', 'minimal'], ['Maximum Detail', 'maximum']]) {
        const option = document.createElement('option');
        option.textContent = label;
        option.value = value;
        select.append(option);
    }
    if (customPresets.length) {
        const group = document.createElement('optgroup');
        group.label = 'Saved presets';
        for (const preset of customPresets) {
            const option = document.createElement('option');
            option.textContent = preset.name;
            option.value = `custom:${preset.name}`;
            group.append(option);
        }
        select.append(group);
    }
    select.value = selected;
}
function savePreset() {
    const name = prompt('Name this preset')?.trim().slice(0, 40);
    if (!name)
        return;
    customPresets = [...customPresets.filter(preset => preset.name !== name), { name, settings: { ...settings } }];
    persistCustomPresets();
    updatePresetOptions();
    getElement('#preset-select').value = `custom:${name}`;
    announce(`Preset “${name}” saved.`, 'done');
}
function deletePreset() {
    const select = getElement('#preset-select');
    const name = select.value.startsWith('custom:') ? select.value.slice(7) : '';
    if (!name) {
        announce('Choose a saved preset to remove.', 'ready');
        return;
    }
    customPresets = customPresets.filter(preset => preset.name !== name);
    persistCustomPresets();
    updatePresetOptions();
    announce(`Preset “${name}” removed.`, 'done');
}
function resetSettings() {
    zoom = 1;
    setSettings({ ...DEFAULT_SETTINGS });
    setZoom(1);
    getElement('#preset-select').value = '';
}
function resetPreferences() {
    try {
        localStorage.removeItem(SETTINGS_KEY);
        localStorage.removeItem(PRESETS_KEY);
    }
    catch { /* Storage can be disabled by the browser. */ }
    customPresets = [];
    undoHistory.length = 0;
    redoHistory.length = 0;
    settings = { ...DEFAULT_SETTINGS };
    updatePresetOptions();
    syncControls();
    updateHistoryButtons();
    queueRender();
    announce('Preferences reset.', 'done');
}
function cycleTheme() {
    const themes = ['system', 'light', 'dark'];
    const next = themes[(themes.indexOf(settings.theme) + 1) % themes.length];
    setSettings({ theme: next }, true, false);
}
function setZoom(value) {
    zoom = Math.max(0.3, Math.min(2.5, value));
    document.documentElement.style.setProperty('--font-size', `${settings.fontSize * zoom}px`);
    getElement('#zoom-level').textContent = `${Math.round(zoom * 100)}%`;
}
function fitZoom() {
    if (!ascii)
        return setZoom(1);
    const stage = getElement('#preview-stage');
    const lines = ascii.split('\n');
    const columns = lines.reduce((widest, line) => Math.max(widest, Array.from(line).length), 0);
    const availableWidth = Math.max(1, stage.clientWidth - 48);
    const availableHeight = Math.max(1, stage.clientHeight - 48);
    const baseFontSize = settings.fontSize;
    const widthZoom = availableWidth / Math.max(1, columns * baseFontSize * 0.62);
    const heightZoom = availableHeight / Math.max(1, lines.length * baseFontSize * settings.lineHeight);
    setZoom(Math.min(1, widthZoom, heightZoom));
}
function setView(nextView) {
    view = nextView;
    for (const button of document.querySelectorAll('[data-view]')) {
        const active = button.dataset.view === view;
        button.setAttribute('aria-selected', String(active));
    }
    getElement('#result-view').hidden = view !== 'result' || !bitmap;
    getElement('#original-view').hidden = view !== 'original' || !bitmap;
    getElement('#compare-view').hidden = view !== 'compare' || !bitmap;
    getElement('#empty-state').hidden = !!bitmap;
}
function wireDropTarget() {
    const target = getElement('#drop-zone');
    target.addEventListener('click', () => filePicker.click());
    target.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            filePicker.click();
        }
    });
    target.addEventListener('dragover', event => {
        event.preventDefault();
        target.classList.add('is-dragging');
    });
    target.addEventListener('dragleave', event => {
        if (!target.contains(event.relatedTarget))
            target.classList.remove('is-dragging');
    });
    target.addEventListener('drop', event => {
        event.preventDefault();
        target.classList.remove('is-dragging');
        const file = event.dataTransfer?.files[0];
        if (file)
            void loadImage(file);
    });
    document.addEventListener('paste', event => {
        const targetElement = event.target;
        if (targetElement.closest('input, textarea, select, [contenteditable="true"]'))
            return;
        const file = Array.from(event.clipboardData?.items ?? [])
            .find(item => item.type.startsWith('image/'))?.getAsFile();
        if (file) {
            event.preventDefault();
            void loadImage(file);
        }
    });
}
async function loadImage(file) {
    const id = ++loadId;
    clearError();
    if (!file.size)
        return showError('That file is empty. Choose a non-empty image.');
    if (file.size > MAX_FILE_BYTES)
        return showError('Images must be smaller than 40 MB.');
    if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)) {
        return showError('Choose a browser-supported image such as PNG, JPEG, WebP, GIF, or BMP.');
    }
    announce('Loading image…', 'working');
    try {
        const decoded = await createImageBitmap(file);
        if (id !== loadId) {
            decoded.close();
            return;
        }
        if (decoded.width * decoded.height > MAX_SOURCE_PIXELS || decoded.width > 20000 || decoded.height > 20000) {
            decoded.close();
            return showError('This image is too large to process reliably. Resize it and try again.');
        }
        bitmap?.close();
        bitmap = decoded;
        currentFileName = file.name.replace(/\.[^.]+$/, '') || 'image';
        if (previewUrl)
            URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        sourcePreview.src = previewUrl;
        comparePreview.src = previewUrl;
        emptyState.hidden = true;
        getElement('#image-metadata').hidden = false;
        getElement('#filename').textContent = file.name;
        getElement('#image-dimensions').textContent = `${decoded.width.toLocaleString()} × ${decoded.height.toLocaleString()}`;
        getElement('#image-size').textContent = formatBytes(file.size);
        getElement('#image-format').textContent = file.type.replace('image/', '').toUpperCase() || 'Image';
        getElement('#copy').disabled = true;
        setView(view);
        queueRender();
    }
    catch (error) {
        if (id !== loadId)
            return;
        console.error('Image decode failed', error);
        showError('The image could not be decoded. It may be corrupted or unsupported by this browser.');
    }
}
function formatBytes(bytes) {
    if (bytes < 1024 * 1024)
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function queueRender() {
    if (frameId)
        cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => {
        frameId = 0;
        render();
    });
}
function ensureWorker() {
    if (workerFailed || renderWorker)
        return renderWorker;
    try {
        renderWorker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
        renderWorker.addEventListener('message', (event) => {
            workerBusy = false;
            if (event.data.jobId !== renderId)
                return;
            finishRender(event.data.jobId, event.data.rows);
        });
        renderWorker.addEventListener('error', error => {
            console.error('Render worker failed; switching to main-thread rendering', error);
            renderWorker?.terminate();
            renderWorker = null;
            workerBusy = false;
            workerFailed = true;
            queueRender();
        });
    }
    catch (error) {
        console.warn('Render worker is unavailable; using the main thread.', error);
        workerFailed = true;
    }
    return renderWorker;
}
let renderStartedAt = 0;
let outputLimited = false;
function render() {
    if (!bitmap)
        return;
    if (renderWorker && workerBusy) {
        renderWorker.terminate();
        renderWorker = null;
        workerBusy = false;
    }
    const jobId = ++renderId;
    renderStartedAt = performance.now();
    clearError();
    announce('Rendering…', 'working');
    try {
        const prepared = prepareImage(bitmap, bitmap.width, bitmap.height, settings);
        outputLimited = prepared.limited;
        const activeWorker = ensureWorker();
        if (activeWorker) {
            const buffer = prepared.pixels.data.buffer;
            activeWorker.postMessage({
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
            }, [buffer]);
            workerBusy = true;
            return;
        }
        const rows = renderPixels(settings.mode, prepared.pixels, prepared.pixels.width, prepared.pixels.height, settings);
        finishRender(jobId, rows);
    }
    catch (error) {
        console.error('Image rendering failed', error);
        showError('Rendering failed. Try a smaller width or a different image.');
    }
}
function finishRender(jobId, rows) {
    if (jobId !== renderId)
        return;
    ascii = rows.join('\n');
    output.textContent = ascii;
    compareOutput.textContent = ascii;
    output.hidden = false;
    compareOutput.hidden = false;
    getElement('#copy').disabled = !ascii;
    const visibleColumns = rows.reduce((maximum, row) => Math.max(maximum, Array.from(row).length), 0);
    const visibleCharacters = Array.from(ascii.replace(/\n/g, '')).length;
    getElement('#columns').textContent = visibleColumns.toLocaleString();
    getElement('#rows').textContent = rows.length.toLocaleString();
    getElement('#character-count').textContent = visibleCharacters.toLocaleString();
    getElement('#render-time').textContent = `${Math.round(performance.now() - renderStartedAt)} ms`;
    setView(view);
    announce(outputLimited ? 'Ready · output capped to protect performance.' : 'Ready', 'done');
}
async function copyOutput() {
    if (!ascii)
        return;
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(ascii);
        }
        else {
            fallbackCopy();
        }
        announce('ASCII copied to clipboard.', 'done');
    }
    catch (error) {
        console.error('Clipboard write failed', error);
        try {
            fallbackCopy();
            announce('ASCII copied to clipboard.', 'done');
        }
        catch {
            showError('Clipboard access was blocked. Select the output and copy it manually.');
        }
    }
}
function fallbackCopy() {
    const textArea = document.createElement('textarea');
    textArea.value = ascii;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.append(textArea);
    textArea.select();
    const copied = document.execCommand('copy');
    textArea.remove();
    if (!copied)
        throw new Error('Legacy copy command failed.');
}
function safeBaseName() {
    return currentFileName.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'image';
}
function downloadBlob(blob, extension) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeBaseName()}-ascii-${settings.width}.${extension}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadText() {
    if (!ascii)
        return;
    downloadBlob(new Blob([ascii], { type: 'text/plain;charset=utf-8' }), 'txt');
    announce('Text file downloaded.', 'done');
}
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function downloadHtml() {
    if (!ascii)
        return;
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${safeBaseName()} ASCII art</title><style>body{margin:2rem;background:#101511;color:#e6f0db}pre{font:${settings.fontSize}px/${settings.lineHeight} ui-monospace,monospace;letter-spacing:${settings.letterSpacing}em;white-space:pre;overflow:auto}</style><pre>${escapeHtml(ascii)}</pre></html>`;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'html');
}
function downloadSvg() {
    if (!ascii)
        return;
    const lines = ascii.split('\n');
    const fontSize = settings.fontSize;
    const lineHeight = fontSize * settings.lineHeight;
    const svgText = lines.map((line, index) => `<text x="16" y="${fontSize + 16 + index * lineHeight}">${escapeHtml(line)}</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width * fontSize * 0.62 + 32}" height="${lines.length * lineHeight + 32}"><rect width="100%" height="100%" fill="#101511"/><g fill="#e6f0db" font-family="monospace" font-size="${fontSize}" xml:space="preserve">${svgText}</g></svg>`;
    downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), 'svg');
}
async function downloadPng() {
    if (!ascii)
        return;
    try {
        const lines = ascii.split('\n');
        const canvas = document.createElement('canvas');
        const padding = 24;
        const lineHeight = settings.fontSize * settings.lineHeight;
        canvas.width = Math.ceil(settings.width * settings.fontSize * 0.62 + padding * 2);
        canvas.height = Math.ceil(lines.length * lineHeight + padding * 2);
        if (canvas.width * canvas.height > 40_000_000)
            throw new Error('The export would be too large.');
        const context = canvas.getContext('2d');
        if (!context)
            throw new Error('Canvas export is unavailable in this browser.');
        context.fillStyle = '#101511';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#e6f0db';
        context.font = `${settings.fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
        context.textBaseline = 'top';
        lines.forEach((line, index) => context.fillText(line, padding, padding + index * lineHeight));
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG encoding failed.')), 'image/png'));
        downloadBlob(blob, 'png');
        announce('PNG image downloaded.', 'done');
    }
    catch (error) {
        showError(error instanceof Error ? error.message : 'PNG export failed.');
    }
}
function openHelp() {
    const dialog = getElement('#shortcuts-dialog');
    if (!dialog.open)
        dialog.showModal();
}
function wireShortcuts() {
    document.addEventListener('keydown', event => {
        const target = event.target;
        const editing = !!target.closest('input, textarea, select, [contenteditable="true"]');
        const command = event.ctrlKey || event.metaKey;
        if (command && event.key.toLowerCase() === 'o') {
            event.preventDefault();
            filePicker.click();
        }
        else if (command && event.key.toLowerCase() === 'c' && !editing && window.getSelection()?.toString() === '') {
            event.preventDefault();
            void copyOutput();
        }
        else if (command && event.key.toLowerCase() === 'z' && !editing) {
            event.preventDefault();
            event.shiftKey ? restoreSettings(redoHistory, undoHistory) : restoreSettings(undoHistory, redoHistory);
        }
        else if (command && event.key.toLowerCase() === 's') {
            event.preventDefault();
            downloadText();
        }
        else if (!editing && !command && event.key.toLowerCase() === 'r') {
            resetSettings();
        }
        else if (!editing && event.key === '?') {
            openHelp();
        }
    });
}
function startApp() {
    wireControls();
    syncControls();
    updateHistoryButtons();
    setView('result');
    getElement('#image-metadata').hidden = true;
    getElement('#copy').disabled = true;
    window.addEventListener('beforeunload', () => {
        if (previewUrl)
            URL.revokeObjectURL(previewUrl);
        bitmap?.close();
        renderWorker?.terminate();
    });
}
startApp();
//# sourceMappingURL=app.js.map