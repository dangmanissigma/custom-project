import { type AppSettings } from './settings.js';
export interface PreparedImage {
    pixels: ImageData;
    columns: number;
    rows: number;
    limited: boolean;
}
export declare function prepareImage(image: CanvasImageSource, imageWidth: number, imageHeight: number, settings: AppSettings): PreparedImage;
export declare function applyToneAdjustments(pixels: ImageData, settings: Pick<AppSettings, 'brightness' | 'contrast' | 'gamma' | 'exposure' | 'blackPoint' | 'whitePoint' | 'sharpness'>): void;
