const BRAILLE_BASE = 0x2800;
function getTargetValue(invert, swapDotsAndSpaces) {
    const baseTargetValue = invert ? 255 : 0;
    return swapDotsAndSpaces ? (baseTargetValue === 0 ? 255 : 0) : baseTargetValue;
}
function getBrailleBits(pixels, width, x, y, targetValue) {
    const dotOffsets = [
        [1, 3],
        [0, 3],
        [1, 2],
        [1, 1],
        [1, 0],
        [0, 2],
        [0, 1],
        [0, 0],
    ];
    let bits = 0;
    for (let index = 0; index < dotOffsets.length; index++) {
        const [offsetX, offsetY] = dotOffsets[index];
        const pixelValue = pixels.data.at(width * 4 * (y + offsetY) + 4 * (x + offsetX));
        if (typeof pixelValue === 'number' && pixelValue === targetValue) {
            bits |= 1 << (7 - index);
        }
    }
    return bits;
}
function trimBrailleRows(rows) {
    const visibleRows = rows.filter(row => row.some(charCode => charCode !== BRAILLE_BASE));
    if (!visibleRows.length)
        return [''];
    const nonEmptyColumns = new Set();
    visibleRows.forEach(row => {
        row.forEach((charCode, columnIndex) => {
            if (charCode !== BRAILLE_BASE)
                nonEmptyColumns.add(columnIndex);
        });
    });
    const sortedColumns = Array.from(nonEmptyColumns).sort((a, b) => a - b);
    const firstColumn = sortedColumns.at(0) ?? 0;
    const lastColumn = sortedColumns.at(-1) ?? 0;
    const trimmedRows = visibleRows
        .map(row => row.slice(firstColumn, lastColumn + 1))
        .filter(row => row.some(charCode => charCode !== BRAILLE_BASE));
    return trimmedRows.map(row => String.fromCharCode(...row));
}
export function buildBrailleRows(pixels, width, height, asciiXDots, asciiYDots, options) {
    const targetValue = getTargetValue(options.invert, options.swapDotsAndSpaces);
    const rows = [];
    for (let y = 0; y < height; y += asciiYDots) {
        const row = [];
        for (let x = 0; x < width; x += asciiXDots) {
            const bits = getBrailleBits(pixels, width, x, y, targetValue);
            row.push(BRAILLE_BASE + bits);
        }
        rows.push(row);
    }
    if (!options.compactWhitespace) {
        return rows.map(row => String.fromCharCode(...row));
    }
    return trimBrailleRows(rows);
}
//# sourceMappingURL=braille-render.js.map
