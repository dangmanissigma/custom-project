import type { AppSettings, DithererName, RenderMode } from './settings.js';
export interface RenderOptions {
    invert: boolean;
    swapDotsAndSpaces: boolean;
    compactWhitespace: boolean;
    characters: string;
    reversePalette: boolean;
    ditherer: DithererName;
    threshold: number;
}
export declare function renderPixels(mode: RenderMode, pixels: ImageData, width: number, height: number, settings: Pick<AppSettings, 'invert' | 'swapDotsAndSpaces' | 'compactWhitespace' | 'characters' | 'reversePalette' | 'ditherer' | 'threshold'>): string[];
