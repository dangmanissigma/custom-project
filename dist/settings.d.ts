export type RenderMode = 'ascii' | 'braille' | 'halfBlock' | 'shadeBlocks';
export type CharacterSet = 'classic' | 'standard' | 'detailed' | 'dense' | 'minimal' | 'punctuation' | 'blocks' | 'retro' | 'cyber' | 'matrix' | 'terminal' | 'custom';
export type DithererName = 'threshold' | 'floydSteinberg' | 'stucki' | 'atkinson' | 'ordered2' | 'ordered4' | 'ordered8' | 'burkes' | 'sierraLite';
export type ThemeMode = 'system' | 'light' | 'dark';
export interface AppSettings {
    mode: RenderMode;
    characterSet: CharacterSet;
    characters: string;
    reversePalette: boolean;
    width: number;
    aspectRatio: number;
    ditherer: DithererName;
    threshold: number;
    brightness: number;
    contrast: number;
    gamma: number;
    exposure: number;
    saturation: number;
    sharpness: number;
    blur: number;
    blackPoint: number;
    whitePoint: number;
    invert: boolean;
    swapDotsAndSpaces: boolean;
    compactWhitespace: boolean;
    mirror: boolean;
    fontSize: number;
    lineHeight: number;
    letterSpacing: number;
    theme: ThemeMode;
}
export declare const CHARACTER_SETS: Record<Exclude<CharacterSet, 'custom'>, string>;
export declare const DEFAULT_SETTINGS: AppSettings;
export declare const MAX_WIDTH = 220;
export declare const MAX_OUTPUT_CELLS = 40000;
export declare function validateSettings(value: Partial<AppSettings>): AppSettings;
export interface RenderDimensions {
    columns: number;
    rows: number;
    pixelWidth: number;
    pixelHeight: number;
    limited: boolean;
}
export declare function calculateRenderDimensions(imageWidth: number, imageHeight: number, settings: AppSettings): RenderDimensions;
