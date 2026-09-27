import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildBrailleRows } from '../dist/braille-render.js';
import { buildGrayscaleRows, buildHalfBlockRows } from '../dist/grayscale-render.js';
import { applyToneAdjustments } from '../dist/image-pipeline.js';
import KernelDitherer from '../dist/kernel-ditherer.js';
import OrderedDitherer from '../dist/ordered-ditherer.js';
import { renderPixels } from '../dist/renderer-registry.js';
import { calculateRenderDimensions, DEFAULT_SETTINGS, validateSettings } from '../dist/settings.js';

class ImageDataMock {
	constructor( dataOrWidth, widthOrHeight, height ) {
		if ( typeof dataOrWidth === 'number' ) {
			this.width = dataOrWidth;
			this.height = widthOrHeight;
			this.data = new Uint8ClampedArray( this.width * this.height * 4 );
		} else {
			this.data = dataOrWidth;
			this.width = widthOrHeight;
			this.height = height;
		}
	}
}

globalThis.ImageData = ImageDataMock;

function makeImage( width, height, values ) {
	const data = new Uint8ClampedArray( width * height * 4 );
	for ( let pixel = 0; pixel < width * height; pixel++ ) {
		const value = values[ pixel ] ?? 255;
		data.set( [ value, value, value, 255 ], pixel * 4 );
	}
	return { width, height, data };
}

test( 'grayscale palette maps dark to dense and light to blank', () => {
	const image = makeImage( 3, 1, [ 0, 127, 255 ] );
	assert.deepEqual( buildGrayscaleRows( image, 3, 1, ' .#', false, false ), [ '#. ' ] );
	assert.deepEqual( buildGrayscaleRows( image, 3, 1, ' .#', true, false ), [ ' .#' ] );
} );

test( 'grayscale trimming keeps the tight occupied bounds and empty palettes are safe', () => {
	const image = makeImage( 3, 2, [ 255, 255, 255, 255, 0, 255 ] );
	assert.deepEqual( buildGrayscaleRows( image, 3, 2, ' @', false, true ), [ '@' ] );
	assert.deepEqual( buildGrayscaleRows( image, 3, 2, '', false, false ), [ '' ] );
	const transparent = { width: 1, height: 1, data: new Uint8ClampedArray( [ 0, 0, 0, 0 ] ) };
	assert.deepEqual( buildGrayscaleRows( transparent, 1, 1, ' @', false, false ), [ ' ' ] );
} );

test( 'Braille mapping encodes dot 1 and a fully set cell', () => {
	const oneDot = makeImage( 2, 4, [ 255, 255, 255, 255, 255, 255, 255, 0 ] );
	assert.deepEqual( buildBrailleRows( oneDot, 2, 4, 2, 4, { invert: false, swapDotsAndSpaces: false, compactWhitespace: false } ), [ String.fromCharCode( 0x2880 ) ] );
	const black = makeImage( 2, 4, Array( 8 ).fill( 0 ) );
	assert.deepEqual( buildBrailleRows( black, 2, 4, 2, 4, { invert: false, swapDotsAndSpaces: false, compactWhitespace: false } ), [ String.fromCharCode( 0x28ff ) ] );
	const oddWidth = makeImage( 1, 2, [ 255, 0 ] );
	assert.deepEqual( buildBrailleRows( oddWidth, 1, 2, 2, 4, { invert: false, swapDotsAndSpaces: false, compactWhitespace: false } ), [ String.fromCharCode( 0x2802 ) ] );
} );

test( 'half blocks combine vertical pairs and retain an odd final row', () => {
	const image = makeImage( 1, 3, [ 255, 0, 255 ] );
	assert.deepEqual( buildHalfBlockRows( image, 1, 3, false, false ), [ '▄', ' ' ] );
	const inverted = buildHalfBlockRows( image, 1, 3, true, false );
	assert.deepEqual( inverted, [ '▀', '▀' ] );
} );

test( 'tone adjustments flatten transparency and preserve grayscale output', () => {
	const image = { ...makeImage( 2, 1, [ 0, 128 ] ), data: new Uint8ClampedArray( [ 0, 0, 0, 0, 128, 64, 32, 255 ] ) };
	applyToneAdjustments( image, { brightness: 0, contrast: 0, gamma: 1, exposure: 0, blackPoint: 0, whitePoint: 255, sharpness: 0 } );
	assert.deepEqual( Array.from( image.data ), [ 255, 255, 255, 255, 75, 75, 75, 255 ] );
	const onePixel = makeImage( 1, 1, [ 100 ] );
	applyToneAdjustments( onePixel, { brightness: 0, contrast: 0, gamma: 1, exposure: 0, blackPoint: 0, whitePoint: 255, sharpness: 100 } );
	assert.deepEqual( Array.from( onePixel.data ), [ 100, 100, 100, 255 ] );
} );

test( 'error diffusion uses a private luminance buffer and respects threshold', () => {
	const image = makeImage( 2, 1, [ 100, 100 ] );
	const original = image.data.slice();
	const ditherer = new KernelDitherer( [ 1, 0 ], [ [ 0, 0, 7 ], [ 3, 5, 1 ] ], 16 );
	const result = ditherer.dither( image, 127 );
	assert.deepEqual( Array.from( result.data.filter( ( _, index ) => index % 4 === 0 ) ), [ 0, 255 ] );
	assert.deepEqual( image.data, original );
} );

test( 'ordered 2x2 dithering produces the expected Bayer pattern', () => {
	const image = makeImage( 2, 2, [ 128, 128, 128, 128 ] );
	const result = new OrderedDitherer( 2 ).dither( image, 127 );
	assert.deepEqual( [ result.data[ 0 ], result.data[ 4 ], result.data[ 8 ], result.data[ 12 ] ], [ 255, 255, 0, 255 ] );
	const transparent = { width: 1, height: 1, data: new Uint8ClampedArray( [ 0, 0, 0, 0 ] ) };
	assert.equal( new OrderedDitherer( 2 ).dither( transparent, Number.NaN ).data[ 0 ], 255 );
} );

test( 'renderer registry covers all modes and dithers without mutating input', () => {
	const image = makeImage( 5, 5, Array.from( { length: 25 }, ( _, index ) => index * 10 ) );
	const original = image.data.slice();
	for ( const mode of [ 'ascii', 'braille', 'halfBlock', 'shadeBlocks' ] ) {
		const rows = renderPixels( mode, image, 5, 5, DEFAULT_SETTINGS );
		assert.ok( rows.length > 0, `${mode} should produce output rows` );
	}
	for ( const ditherer of [ 'threshold', 'floydSteinberg', 'stucki', 'atkinson', 'ordered2', 'ordered4', 'ordered8', 'burkes', 'sierraLite' ] ) {
		const rows = renderPixels( 'braille', image, 5, 5, { ...DEFAULT_SETTINGS, ditherer } );
		assert.ok( rows.length > 0, `${ditherer} should produce Braille output` );
	}
	assert.deepEqual( image.data, original );
} );

test( 'settings validation clamps bounds and dimensions respect each render cell', () => {
	const settings = validateSettings( { ...DEFAULT_SETTINGS, width: 99999, gamma: 0, characters: '' } );
	assert.equal( settings.width, 220 );
	assert.equal( settings.gamma, 0.2 );
	assert.equal( settings.characters, DEFAULT_SETTINGS.characters );
	const braille = calculateRenderDimensions( 400, 200, { ...DEFAULT_SETTINGS, mode: 'braille', width: 80 } );
	assert.deepEqual( braille, { columns: 80, rows: 20, pixelWidth: 160, pixelHeight: 80, limited: false } );
	const halfBlock = calculateRenderDimensions( 400, 200, { ...DEFAULT_SETTINGS, mode: 'halfBlock', width: 80 } );
	assert.deepEqual( halfBlock, { columns: 80, rows: 20, pixelWidth: 80, pixelHeight: 40, limited: false } );
	assert.throws( () => calculateRenderDimensions( 0, 10, DEFAULT_SETTINGS ), RangeError );
	const bounded = calculateRenderDimensions( 1, 100000, { ...DEFAULT_SETTINGS, width: 200 } );
	assert.equal( bounded.columns * bounded.rows, 40000 );
	assert.equal( bounded.limited, true );
} );

test( 'every required app selector exists in the studio document', async () => {
	const app = await readFile( new URL( '../src/app.ts', import.meta.url ), 'utf8' );
	const html = await readFile( new URL( '../index.html', import.meta.url ), 'utf8' );
	const requiredIds = Array.from( app.matchAll( /getElement<[^>]+>\(\s*['"]#([\w-]+)['"]\s*\)/g ), match => match[ 1 ] );
	assert.ok( requiredIds.length > 0 );
	for ( const id of requiredIds ) assert.match( html, new RegExp( `id=["']${id}["']` ), `Missing #${id} in index.html` );
} );