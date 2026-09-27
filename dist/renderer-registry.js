import { buildBrailleRows } from './braille-render.js';
import { buildGrayscaleRows, buildHalfBlockRows } from './grayscale-render.js';
import KernelDitherer from './kernel-ditherer.js';
import OrderedDitherer from './ordered-ditherer.js';
const ditherers = {
    threshold: new KernelDitherer([0, 0], [], 1),
    floydSteinberg: new KernelDitherer([1, 0], [[0, 0, 7], [3, 5, 1]], 16),
    stucki: new KernelDitherer([2, 0], [[0, 0, 0, 8, 4], [2, 4, 8, 4, 2], [1, 2, 4, 2, 1]], 42),
    atkinson: new KernelDitherer([1, 0], [[0, 0, 1, 1], [1, 1, 1, 0], [0, 1, 0, 0]], 8),
    ordered2: new OrderedDitherer(2),
    ordered4: new OrderedDitherer(4),
    ordered8: new OrderedDitherer(8),
    burkes: new KernelDitherer([2, 0], [[0, 0, 0, 8, 4], [2, 4, 8, 4, 2]], 32),
    sierraLite: new KernelDitherer([1, 0], [[0, 0, 2], [1, 1, 0]], 4),
};
const getCharacters = (options) => options.reversePalette ? Array.from(options.characters).reverse().join('') : options.characters;
const asciiRenderer = (pixels, width, height, options) => buildGrayscaleRows(pixels, width, height, getCharacters(options), options.invert, options.compactWhitespace);
const brailleRenderer = (pixels, width, height, options) => {
    const dithered = ditherers[options.ditherer].dither(pixels, options.threshold);
    return buildBrailleRows(dithered, width, height, 2, 4, options);
};
const halfBlockRenderer = (pixels, width, height, options) => buildHalfBlockRows(pixels, width, height, options.invert, options.compactWhitespace);
const shadeBlockRenderer = (pixels, width, height, options) => buildGrayscaleRows(pixels, width, height, ' ░▒▓█', options.invert, options.compactWhitespace);
const renderers = {
    ascii: asciiRenderer,
    braille: brailleRenderer,
    halfBlock: halfBlockRenderer,
    shadeBlocks: shadeBlockRenderer,
};
export function renderPixels(mode, pixels, width, height, settings) {
    return renderers[mode](pixels, width, height, settings);
}
//# sourceMappingURL=renderer-registry.js.map