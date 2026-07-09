import { $, on, rgbaOffset } from './helpers.js';
import KernelDitherer from './kernel-ditherer.js';
import OrderedDitherer from './ordered-ditherer.js';
import { buildBrailleRows } from './braille-render.js';

const asciiXDots = 2;
const asciiYDots = 4;

const ditherers = {
    threshold: new KernelDitherer([0, 0], [], 1),
    floydSteinberg: new KernelDitherer([1, 0], [
        [0, 0, 7],
        [3, 5, 1],
    ], 16),
    stucki: new KernelDitherer([2, 0], [
        [0, 0, 0, 8, 4],
        [2, 4, 8, 4, 2],
        [1, 2, 4, 2, 1],
    ], 42),
    atkinson: new KernelDitherer([1, 0], [
        [0, 0, 1, 1],
        [1, 1, 1, 0],
        [0, 1, 0, 0],
    ], 8),
    ordered: new OrderedDitherer(),
};

let dithererName = 'floydSteinberg';
let invert = false;
let swapDotsAndSpaces = false;
let compactWhitespace = true;
let mirror = false;
let threshold = 127;
let asciiWidth = 100;
let asciiHeight = 100;
let image;
let canvas = document.createElement('canvas');
let context = canvas.getContext('2d');
let ascii = '';
let pendingRender = false;

on(document, 'DOMContentLoaded', function () {
    on($('#filepicker'), 'change', async function () {
        if (!this.files || !this.files.length) return;

        image = document.createElement('img');
        image.src = URL.createObjectURL(this.files[0].slice(0));
        await new Promise(resolve => on(image, 'load', resolve));
        queueRender();
    });

    on($('#dither'), 'change', function () {
        const newValue = this.value;
        if (newValue === dithererName) return;
        dithererName = newValue;
        queueRender();
    });

    on($('#threshold'), 'change', function () {
        const newValue = parseInt(this.value, 10);
        if (newValue === threshold) return;
        threshold = newValue;
        queueRender();
    });

    on($('#width'), 'input', function () {
        const newValue = parseInt(this.value, 10);
        if (newValue === asciiWidth || newValue < 1) return;
        asciiWidth = newValue;
        queueRender();
    });

    on($('#invert'), 'change', function () {
        invert = this.checked;
        document.body.classList.toggle('invert', invert);
        queueRender();
    });

    on($('#swap-dots'), 'change', function () {
        swapDotsAndSpaces = this.checked;
        queueRender();
    });

    on($('#compact-whitespace'), 'change', function () {
        compactWhitespace = this.checked;
        queueRender();
    });

    on($('#mirror'), 'change', function () {
        mirror = this.checked;
        queueRender();
    });

    on($('#copy'), 'click', function () {
        navigator.clipboard.writeText(ascii);
        const oldText = this.textContent;
        this.textContent = 'Copied!';
        setTimeout(() => this.textContent = oldText, 1000);
    });

    on($('#reset'), 'click', function () {
        dithererName = 'floydSteinberg';
        invert = false;
        swapDotsAndSpaces = false;
        compactWhitespace = true;
        mirror = false;
        threshold = 127;
        asciiWidth = 100;

        $('#dither').value = dithererName;
        $('#threshold').value = threshold.toString();
        $('#width').value = asciiWidth.toString();
        $('#invert').checked = false;
        $('#swap-dots').checked = false;
        $('#compact-whitespace').checked = true;
        $('#mirror').checked = false;
        document.body.classList.toggle('invert', invert);
        queueRender();
    });

    on($('#download'), 'click', function () {
        const blob = new Blob([ascii], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'braille-ascii-art.txt';
        link.click();
        URL.revokeObjectURL(link.href);
    });

    on($('#font-size'), 'input', function () {
        document.documentElement.style.setProperty('--font-size', `${this.value}px`);
    });
});

function queueRender() {
    if (pendingRender) return;
    pendingRender = true;
    window.requestAnimationFrame(() => {
        pendingRender = false;
        render();
    });
}

async function render() {
    if (!image) return;

    asciiHeight = Math.ceil(asciiWidth * asciiXDots * (image.height / image.width) / asciiYDots);
    document.documentElement.style.setProperty('--width', asciiWidth.toString());
    document.documentElement.style.setProperty('--height', asciiHeight.toString());

    canvas.width = asciiWidth * asciiXDots;
    canvas.height = asciiHeight * asciiYDots;

    context.globalCompositeOperation = 'source-over';
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.globalCompositeOperation = 'luminosity';
    context.save();
    if (mirror) {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.restore();

    const ditherer = ditherers[dithererName];
    const greyPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const ditheredPixels = ditherer.dither(greyPixels, threshold);
    const asciiLines = buildBrailleRows(ditheredPixels, canvas.width, canvas.height, asciiXDots, asciiYDots, {
        invert,
        swapDotsAndSpaces,
        compactWhitespace,
    });

    ascii = asciiLines.join('\n');
    const visibleCharacterCount = ascii.replace(/\u2800/g, '').replace(/\n/g, '').length;
    $('#char-count').textContent = visibleCharacterCount.toLocaleString();

    const output = $('#output');
    output.style.display = 'block';
    output.innerHTML = asciiLines.map(line => line.split('').map(char => `<span>${char}</span>`).join('')).join('<br>');
}
//# sourceMappingURL=index.js.map