export default class OrderedDitherer {
    matrixSize;
    constructor(matrixSize = 8) {
        this.matrixSize = matrixSize;
    }
    dither(input, threshold) {
        const output = new ImageData(input.width, input.height);
        const matrix = this.bayerMatrix();
        const maxValue = this.matrixSize * this.matrixSize;
        const bias = 0.5;
        const boundedThreshold = Number.isFinite(threshold) ? Math.max(0, Math.min(255, threshold)) : 127;
        const luminance = new Float32Array(input.width * input.height);
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const offset = input.width * 4 * y + 4 * x;
                const alpha = input.data[offset + 3] / 255;
                const red = input.data[offset] * alpha + 255 * (1 - alpha);
                const green = input.data[offset + 1] * alpha + 255 * (1 - alpha);
                const blue = input.data[offset + 2] * alpha + 255 * (1 - alpha);
                luminance[y * input.width + x] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
            }
        }
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const pixelIndex = y * input.width + x;
                const greyPixel = luminance[pixelIndex];
                const matrixValue = matrix[y % this.matrixSize][x % this.matrixSize];
                const normalized = (matrixValue + bias) / maxValue;
                const localLift = this.localContrastBoost(luminance, input.width, x, y);
                const adjustedThreshold = boundedThreshold * (0.65 + normalized * 0.55) + localLift;
                const value = greyPixel > adjustedThreshold ? 255 : 0;
                output.data.set([value, value, value, 255], pixelIndex * 4);
            }
        }
        return output;
    }
    localContrastBoost(luminance, width, x, y) {
        const sampleRadius = 1;
        let sum = 0;
        let count = 0;
        for (let oy = -sampleRadius; oy <= sampleRadius; oy++) {
            for (let ox = -sampleRadius; ox <= sampleRadius; ox++) {
                const nx = x + ox;
                const ny = y + oy;
                if (nx < 0 || ny < 0 || nx >= width || ny >= luminance.length / width)
                    continue;
                sum += luminance[ny * width + nx];
                count++;
            }
        }
        const average = sum / count;
        const current = luminance[y * width + x];
        return (current - average) * 0.02;
    }
    bayerMatrix() {
        const size = this.matrixSize;
        if (size === 2) {
            return [
                [0, 2],
                [3, 1],
            ];
        }
        else if (size === 4) {
            return [
                [0, 8, 2, 10],
                [12, 4, 14, 6],
                [3, 11, 1, 9],
                [15, 7, 13, 5],
            ];
        }
        let matrix = [[0]];
        while (matrix.length < this.matrixSize) {
            const previousSize = matrix.length;
            const next = Array.from({ length: previousSize * 2 }, () => Array(previousSize * 2));
            for (let y = 0; y < previousSize; y++) {
                for (let x = 0; x < previousSize; x++) {
                    const value = matrix[y][x];
                    next[y][x] = 4 * value;
                    next[y][x + previousSize] = 4 * value + 2;
                    next[y + previousSize][x] = 4 * value + 3;
                    next[y + previousSize][x + previousSize] = 4 * value + 1;
                }
            }
            matrix = next;
        }
        return matrix;
    }
}
//# sourceMappingURL=ordered-ditherer.js.map