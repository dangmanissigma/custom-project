export interface BrailleRenderOptions {
    invert: boolean;
    swapDotsAndSpaces: boolean;
    compactWhitespace: boolean;
}
export declare function buildBrailleRows(pixels: ImageData, width: number, height: number, asciiXDots: number, asciiYDots: number, options: BrailleRenderOptions): string[];
