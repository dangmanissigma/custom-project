export default class OrderedDitherer {
    constructor(matrixSize = 8) {
        this.matrixSize = matrixSize;
    }
    dither(input, threshold) {
        const output = new ImageData(input.width, input.height);
        const matrix = this.bayerMatrix();
        const maxValue = this.matrixSize * this.matrixSize;
        const bias = 0.5;
        for (let y = 0; y < input.height; y++) {
            for (let x = 0; x < input.width; x++) {
                const offset = input.width * 4 * y + 4 * x;
                const greyPixel = input.data.at(offset);
                const matrixValue = matrix[y % this.matrixSize][x % this.matrixSize];
                const normalized = (matrixValue + bias) / maxValue;
                const localLift = this.localContrastBoost(input, x, y, offset);
                const adjustedThreshold = threshold * (0.65 + normalized * 0.55) + localLift;
                const value = greyPixel > adjustedThreshold ? 255 : 0;
                output.data.set([value, value, value, 255], offset);
            }
        }
        return output;
    }
    localContrastBoost(input, x, y, offset) {
        const sampleRadius = 1;
        let sum = 0;
        let count = 0;
        for (let oy = -sampleRadius; oy <= sampleRadius; oy++) {
            for (let ox = -sampleRadius; ox <= sampleRadius; ox++) {
                const nx = x + ox;
                const ny = y + oy;
                if (nx < 0 || ny < 0 || nx >= input.width || ny >= input.height)
                    continue;
                const sampleOffset = input.width * 4 * ny + 4 * nx;
                sum += input.data.at(sampleOffset);
                count++;
            }
        }
        const average = sum / count;
        const current = input.data.at(offset);
        return (current - average) * 0.02;
    }
    bayerMatrix() {
        const size = this.matrixSize;
        if (size === 4) {
            return [
                [0, 8, 2, 10],
                [12, 4, 14, 6],
                [3, 11, 1, 9],
                [15, 7, 13, 5],
            ];
        }
        return [
            [0, 32, 8, 40, 2, 34, 10, 42],
            [48, 16, 56, 24, 50, 18, 58, 26],
            [12, 44, 4, 36, 14, 46, 6, 38],
            [60, 28, 52, 20, 62, 30, 54, 22],
            [3, 35, 11, 43, 1, 33, 9, 41],
            [51, 19, 59, 27, 49, 17, 57, 25],
            [15, 47, 7, 39, 13, 45, 5, 37],
            [63, 31, 55, 23, 61, 29, 53, 21],
        ];
    }
}
//# sourceMappingURL=ordered-ditherer.js.map
