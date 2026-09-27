import { calculateRenderDimensions, type AppSettings } from './settings.js';

export interface PreparedImage {
	pixels: ImageData;
	columns: number;
	rows: number;
	limited: boolean;
}

export function prepareImage( image: CanvasImageSource, imageWidth: number, imageHeight: number, settings: AppSettings ): PreparedImage {
	const dimensions = calculateRenderDimensions( imageWidth, imageHeight, settings );
	const canvas = document.createElement( 'canvas' );
	canvas.width = dimensions.pixelWidth;
	canvas.height = dimensions.pixelHeight;
	const context = canvas.getContext( '2d', { willReadFrequently: true } );
	if ( !context ) throw new Error( 'This browser could not create an image-processing canvas.' );

	context.fillStyle = '#fff';
	context.fillRect( 0, 0, canvas.width, canvas.height );
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.filter = `saturate(${settings.saturation}%) blur(${settings.blur}px)`;
	if ( settings.mirror ) {
		context.translate( canvas.width, 0 );
		context.scale( -1, 1 );
	}
	context.drawImage( image, 0, 0, canvas.width, canvas.height );

	const pixels = context.getImageData( 0, 0, canvas.width, canvas.height );
	applyToneAdjustments( pixels, settings );
	return { pixels, columns: dimensions.columns, rows: dimensions.rows, limited: dimensions.limited };
}

export function applyToneAdjustments( pixels: ImageData, settings: Pick<AppSettings, 'brightness' | 'contrast' | 'gamma' | 'exposure' | 'blackPoint' | 'whitePoint' | 'sharpness'> ) {
	const contrast = settings.contrast;
	const contrastFactor = ( 259 * ( contrast + 255 ) ) / ( 255 * ( 259 - contrast ) );
	const brightness = settings.brightness * 2.55;
	const exposure = Math.pow( 2, settings.exposure );
	const blackPoint = settings.blackPoint;
	const whiteRange = Math.max( 1, settings.whitePoint - blackPoint );
	const inverseGamma = 1 / settings.gamma;
	const luminance = new Float32Array( pixels.width * pixels.height );

	for ( let pixel = 0; pixel < luminance.length; pixel++ ) {
		const offset = pixel * 4;
		const alpha = pixels.data[ offset + 3 ] / 255;
		const red = pixels.data[ offset ] * alpha + 255 * ( 1 - alpha );
		const green = pixels.data[ offset + 1 ] * alpha + 255 * ( 1 - alpha );
		const blue = pixels.data[ offset + 2 ] * alpha + 255 * ( 1 - alpha );
		const pixelLuminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
		const contrasted = Math.max( 0, Math.min( 255, contrastFactor * ( pixelLuminance * exposure - 128 ) + 128 + brightness ) );
		const stretched = Math.max( 0, Math.min( 255, ( contrasted - blackPoint ) / whiteRange * 255 ) );
		luminance[ pixel ] = 255 * Math.pow( stretched / 255, inverseGamma );
	}

	const sharpness = settings.sharpness / 100;
	for ( let y = 0; y < pixels.height; y++ ) {
		for ( let x = 0; x < pixels.width; x++ ) {
			const pixel = y * pixels.width + x;
			let adjusted = luminance[ pixel ];
			if ( sharpness > 0 ) {
				let neighborSum = 0;
				let neighborCount = 0;
				for ( const [ offsetX, offsetY ] of [ [ -1, 0 ], [ 1, 0 ], [ 0, -1 ], [ 0, 1 ] ] ) {
					const neighborX = x + offsetX;
					const neighborY = y + offsetY;
					if ( neighborX < 0 || neighborY < 0 || neighborX >= pixels.width || neighborY >= pixels.height ) continue;
					neighborSum += luminance[ neighborY * pixels.width + neighborX ];
					neighborCount++;
				}
				if ( neighborCount > 0 ) adjusted = Math.max( 0, Math.min( 255, adjusted + ( adjusted - neighborSum / neighborCount ) * sharpness ) );
			}
			const offset = pixel * 4;
			pixels.data[ offset ] = adjusted;
			pixels.data[ offset + 1 ] = adjusted;
			pixels.data[ offset + 2 ] = adjusted;
		pixels.data[ offset + 3 ] = 255;
		}
	}
}