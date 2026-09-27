import { renderPixels } from './renderer-registry.js';
const workerScope = self;
workerScope.onmessage = (event) => {
    const request = event.data;
    const pixels = new ImageData(new Uint8ClampedArray(request.pixels), request.width, request.height);
    const rows = renderPixels(request.mode, pixels, request.width, request.height, request.settings);
    workerScope.postMessage({ jobId: request.jobId, rows });
};
//# sourceMappingURL=render-worker.js.map