import { rgbaOffset } from './helpers.js';

export default class KernelDitherer implements Ditherer {

	constructor(
		public origin: [ number, number ],
		public numerators: number[][],
		public denominator: number = 1,
	) { }

	weights(): [ number, number, number ][] {

		const weights: [ number, number, number ][] = [];
		const [ originX, originY ] = this.origin;

		for ( let y = 0; y < this.numerators.length; y++ ) {
			for ( let x = 0; x < this.numerators[ y ].length; x++ ) {
				weights.push( [
					x - originX,
					y - originY,
					this.numerators[ y ][ x ] / this.denominator,
				] );
			}
		}

		return weights;
	}

	dither( input: ImageData, threshold: number ) {
		const output = new ImageData( input.width, input.height );
		const weights = this.weights();
		const luminance = new Float32Array( input.width * input.height );
		const boundedThreshold = Math.max( 0, Math.min( 255, threshold ) );

		for ( let y = 0; y < input.height; y++ ) {
			for ( let x = 0; x < input.width; x++ ) {
				const offset = rgbaOffset( x, y, input.width );
				const alpha = input.data[ offset + 3 ] / 255;
				const red = input.data[ offset ] * alpha + 255 * ( 1 - alpha );
				const green = input.data[ offset + 1 ] * alpha + 255 * ( 1 - alpha );
				const blue = input.data[ offset + 2 ] * alpha + 255 * ( 1 - alpha );
				luminance[ y * input.width + x ] = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
			}
		}

		for ( let y = 0; y < input.height; y++ ) {
			for ( let x = 0; x < input.width; x++ ) {
				const offset = rgbaOffset( x, y, input.width );
				const pixelIndex = y * input.width + x;
				const greyPixel = luminance[ pixelIndex ];
				const value = greyPixel > boundedThreshold ? 255 : 0;
				output.data.set( [ value, value, value, 255 ], offset );

				const error = greyPixel - value;
				for ( const [ weightX, weightY, weight ] of weights ) {
					if ( weight === 0 ) continue;
					const neighborX = x + weightX;
					const neighborY = y + weightY;
					if ( neighborX < 0 || neighborY < 0 || neighborX >= input.width || neighborY >= input.height ) continue;
					const neighborIndex = neighborY * input.width + neighborX;
					luminance[ neighborIndex ] = Math.max( 0, Math.min( 255, luminance[ neighborIndex ] + error * weight ) );
				}
			}
		}

		return output;
	}

}
