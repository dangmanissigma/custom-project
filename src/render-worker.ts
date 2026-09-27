import { renderPixels } from './renderer-registry.js';
import type { AppSettings, RenderMode } from './settings.js';

interface RenderRequest {
	jobId: number;
	mode: RenderMode;
	width: number;
	height: number;
	pixels: ArrayBuffer;
	settings: Pick<AppSettings, 'invert' | 'swapDotsAndSpaces' | 'compactWhitespace' | 'characters' | 'reversePalette' | 'ditherer' | 'threshold'>;
}

const workerScope = self as unknown as {
	onmessage: ( event: MessageEvent<RenderRequest> ) => void;
	postMessage: ( message: { jobId: number; rows: string[] } ) => void;
};

workerScope.onmessage = ( event ) => {
	const request = event.data;
	const pixels = new ImageData( new Uint8ClampedArray( request.pixels ), request.width, request.height );
	const rows = renderPixels( request.mode, pixels, request.width, request.height, request.settings );
	workerScope.postMessage( { jobId: request.jobId, rows } );
};