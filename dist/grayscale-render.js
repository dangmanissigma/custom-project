import { rgbaOffset } from './helpers.js';
function trimRows(rows) {
    const trimmedRows = rows
        .map(row => row.replace(/^\s+|\s+$/g, ''))
        .filter(row => row.length > 0);
    return trimmedRows.length ? trimmedRows : [''];
}
function getLuminance(pixels, width, x, y, invert) {
    const offset = rgbaOffset(x, y, width);
    const alpha = pixels.data[offset + 3] / 255;
    const red = pixels.data[offset] * alpha + 255 * (1 - alpha);
    const green = pixels.data[offset + 1] * alpha + 255 * (1 - alpha);
    const blue = pixels.data[offset + 2] * alpha + 255 * (1 - alpha);
    const value = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return invert ? 255 - value : value;
}
export function buildGrayscaleRows(pixels, width, height, characters, invert, compactWhitespace) {
    const palette = Array.from(characters);
    if (!palette.length)
        return [''];
    const rows = [];
    for (let y = 0; y < height; y++) {
        let row = '';
        for (let x = 0; x < width; x++) {
            const luminance = getLuminance(pixels, width, x, y, invert);
            const paletteIndex = Math.round((255 - luminance) / 255 * (palette.length - 1));
            row += palette[paletteIndex];
        }
        rows.push(row);
    }
    return compactWhitespace ? trimRows(rows) : rows;
}
export function buildHalfBlockRows(pixels, width, height, invert, compactWhitespace) {
    const rows = [];
    for (let y = 0; y < height; y += 2) {
        let row = '';
        for (let x = 0; x < width; x++) {
            const top = getLuminance(pixels, width, x, y, invert) < 128;
            const bottom = y + 1 < height && getLuminance(pixels, width, x, y + 1, invert) < 128;
            row += top ? (bottom ? '█' : '▀') : (bottom ? '▄' : ' ');
        }
        rows.push(row);
    }
    return compactWhitespace ? trimRows(rows) : rows;
}
//# sourceMappingURL=grayscale-render.js.map