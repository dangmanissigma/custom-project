export default class OrderedDitherer implements Ditherer {
    private readonly matrixSize;
    constructor(matrixSize?: number);
    dither(input: ImageData, threshold: number): ImageData;
    private localContrastBoost;
    private bayerMatrix;
}
