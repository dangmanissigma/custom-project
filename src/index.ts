import { $, on, rgbaOffset } from './helpers.js';
import KernelDitherer from './kernel-ditherer.js';
import OrderedDitherer from './ordered-ditherer.js';
import { buildBrailleRows } from './braille-render.js';
import { buildGrayscaleRows, buildHalfBlockRows } from './grayscale-render.js';

// Braille symbol is 2x4 dots
const asciiXDots = 2,
	asciiYDots = 4;

type DithererName = 'threshold' | 'floydSteinberg' | 'stucki' | 'atkinson' | 'ordered';
type RenderMode = 'ascii' | 'braille' | 'halfBlock' | 'shadeBlocks';
type CharacterSet = 'classic' | 'detailed' | 'punctuation' | 'dense' | 'cyber' | 'custom';

const characterSets: Record<Exclude<CharacterSet, 'custom'>, string> = {
	classic: ' .:-=+*#%@',
	detailed: " .'-_,~:;=!*?+%#@",
	punctuation: ' .,:;!?-_+=*/\\|()[]{}#@',
	dense: ' .:-=+*#%@&',
	cyber: ' .-+*%@#$X01',
};

const ditherers: Record<DithererName, Ditherer> = {
	threshold: new KernelDitherer(
		[ 0, 0 ],
		[],
		1,
	),
	floydSteinberg: new KernelDitherer(
		[ 1, 0 ],
		[
			[ 0, 0, 7 ],
			[ 3, 5, 1 ],
		],
		16,
	),
	stucki: new KernelDitherer(
		[ 2, 0 ],
		[
			[ 0, 0, 0, 8, 4 ],
			[ 2, 4, 8, 4, 2 ],
			[ 1, 2, 4, 2, 1 ],
		],
		42,
	),
	atkinson: new KernelDitherer(
		[ 1, 0 ],
		[
			[ 0, 0, 1, 1 ],
			[ 1, 1, 1, 0 ],
			[ 0, 1, 0, 0 ],
		],
		8,
	),
	ordered: new OrderedDitherer(),
};

let renderMode: RenderMode = 'ascii',
	characterSet: CharacterSet = 'detailed',
	characters = characterSets.detailed,
	aspectRatio = 0.5,
	dithererName: DithererName = 'floydSteinberg',
	invert = false,
	swapDotsAndSpaces = false,
	compactWhitespace = true,
	mirror = false,
	threshold = 127,
	asciiWidth = 100,
	asciiHeight = 100;

let image: HTMLImageElement;
let canvas = document.createElement( 'canvas' );
let context = canvas.getContext( '2d' )!;
let ascii = '';
let renderFrame = 0;
let pendingRender = false;

on( document, 'DOMContentLoaded', function ( e ) {

	on( $<HTMLInputElement>( '#filepicker' ), 'change', async function () {
		if ( !this.files || !this.files.length ) return;

		image = document.createElement( 'img' );
		image.src = URL.createObjectURL( this.files[ 0 ].slice( 0 ) );
		await new Promise( resolve => on( image, 'load', resolve ) );

		render();
	} );

	on( $<HTMLSelectElement>( '#dither' ), 'change', function () {
		let newValue = this.value as DithererName;
		if ( newValue == dithererName ) return;
		dithererName = newValue;
		queueRender();
	} );

	on( $<HTMLSelectElement>( '#render-mode' ), 'change', function () {
		renderMode = this.value as RenderMode;
		updateModeControls();
		queueRender();
	} );

	on( $<HTMLSelectElement>( '#character-set' ), 'change', function () {
		characterSet = this.value as CharacterSet;
		if ( characterSet !== 'custom' ) {
			characters = characterSets[ characterSet ];
			$<HTMLInputElement>( '#characters' )!.value = characters;
		} else {
			characters = $<HTMLInputElement>( '#characters' )!.value;
		}
		queueRender();
	} );

	on( $<HTMLInputElement>( '#characters' ), 'input', function () {
		characters = this.value;
		$<HTMLSelectElement>( '#character-set' )!.value = 'custom';
		characterSet = 'custom';
		queueRender();
	} );

	on( $<HTMLInputElement>( '#aspect-ratio' ), 'input', function () {
		aspectRatio = parseFloat( this.value );
		queueRender();
	} );

	on( $<HTMLInputElement>( '#threshold' ), 'change', function () {
		let newValue = parseInt( this.value );
		if ( newValue == threshold ) return;
		threshold = newValue;
		queueRender();
	} );

	on( $<HTMLInputElement>( '#width' ), 'input', function () {
		let newValue = parseInt( this.value );
		if ( newValue == asciiWidth || newValue < 1 ) return;
		asciiWidth = newValue;
		queueRender();
	} );

	on( $<HTMLInputElement>( '#invert' ), 'change', function () {
		invert = this.checked;
		document.body.classList.toggle( 'invert', invert );
		queueRender();
	} );

	on( $<HTMLInputElement>( '#swap-dots' ), 'change', function () {
		swapDotsAndSpaces = this.checked;
		queueRender();
	} );

	on( $<HTMLInputElement>( '#compact-whitespace' ), 'change', function () {
		compactWhitespace = this.checked;
		queueRender();
	} );

	on( $<HTMLInputElement>( '#mirror' ), 'change', function () {
		mirror = this.checked;
		queueRender();
	} );

	on( $<HTMLButtonElement>( '#copy' ), 'click', function () {
		navigator.clipboard.writeText( ascii );
		const oldText = this.textContent;
		this.textContent = 'Copied!';
		setTimeout( () => this.textContent = oldText, 1000 );
	} );

	on( $<HTMLButtonElement>( '#reset' ), 'click', function () {
		renderMode = 'ascii';
		characterSet = 'detailed';
		characters = characterSets.detailed;
		aspectRatio = 0.5;
		dithererName = 'floydSteinberg';
		invert = false;
		swapDotsAndSpaces = false;
		compactWhitespace = true;
		mirror = false;
		threshold = 127;
		asciiWidth = 100;

		$<HTMLSelectElement>( '#render-mode' )!.value = renderMode;
		$<HTMLSelectElement>( '#character-set' )!.value = characterSet;
		$<HTMLInputElement>( '#characters' )!.value = characters;
		$<HTMLInputElement>( '#aspect-ratio' )!.value = aspectRatio.toString();
		$<HTMLSelectElement>( '#dither' )!.value = dithererName;
		$<HTMLInputElement>( '#threshold' )!.value = threshold.toString();
		$<HTMLInputElement>( '#width' )!.value = asciiWidth.toString();
		$<HTMLInputElement>( '#invert' )!.checked = false;
		$<HTMLInputElement>( '#swap-dots' )!.checked = false;
		$<HTMLInputElement>( '#compact-whitespace' )!.checked = true;
		$<HTMLInputElement>( '#mirror' )!.checked = false;
		document.body.classList.toggle( 'invert', invert );
		updateModeControls();
		queueRender();
	} );

	on( $<HTMLButtonElement>( '#download' ), 'click', function () {
		const blob = new Blob( [ ascii ], { type: 'text/plain;charset=utf-8' } );
		const link = document.createElement( 'a' );
		link.href = URL.createObjectURL( blob );
		link.download = 'image-ascii-art.txt';
		link.click();
		URL.revokeObjectURL( link.href );
	} );

	on( $<HTMLInputElement>( '#font-size' ), 'input', function () {
		document.documentElement.style.setProperty( '--font-size', `${this.value}px` );
	} );

	updateModeControls();

} );

function queueRender() {
	if ( pendingRender ) return;
	pendingRender = true;
	renderFrame = window.requestAnimationFrame( () => {
		pendingRender = false;
		render();
	} );
}

function updateModeControls() {
	const isBraille = renderMode === 'braille';
	const isAscii = renderMode === 'ascii';
	$( '#dither-field' )!.toggleAttribute( 'hidden', !isBraille );
	$( '#threshold-field' )!.toggleAttribute( 'hidden', !isBraille );
	$( '#swap-dots-field' )!.toggleAttribute( 'hidden', !isBraille );
	$( '#character-set-field' )!.toggleAttribute( 'hidden', !isAscii );
	$( '#characters-field' )!.toggleAttribute( 'hidden', !isAscii );
}

async function render() {
	if ( !image ) return;

	asciiHeight = Math.ceil( asciiWidth * ( image.height / image.width ) * aspectRatio );
	document.documentElement.style.setProperty( '--width', asciiWidth.toString() );
	document.documentElement.style.setProperty( '--height', asciiHeight.toString() );

	canvas.width = renderMode === 'braille' ? asciiWidth * asciiXDots : asciiWidth;
	canvas.height = asciiHeight * ( renderMode === 'braille' ? asciiYDots : renderMode === 'halfBlock' ? 2 : 1 );

	context.globalCompositeOperation = 'source-over';
	context.fillStyle = 'white';
	context.fillRect( 0, 0, canvas.width, canvas.height );

	context.globalCompositeOperation = 'luminosity';
	context.save();
	if ( mirror ) {
		context.translate( canvas.width, 0 );
		context.scale( -1, 1 );
	}
	context.drawImage( image, 0, 0, canvas.width, canvas.height );
	context.restore();

	const greyPixels = context.getImageData( 0, 0, canvas.width, canvas.height );
	let asciiLines: string[];
	if ( renderMode === 'braille' ) {
		const ditheredPixels = ditherers[ dithererName ].dither( greyPixels, threshold );
		asciiLines = buildBrailleRows( ditheredPixels, canvas.width, canvas.height, asciiXDots, asciiYDots, {
			invert,
			swapDotsAndSpaces,
			compactWhitespace,
		} );
	} else if ( renderMode === 'halfBlock' ) {
		asciiLines = buildHalfBlockRows( greyPixels, canvas.width, canvas.height, invert, compactWhitespace );
	} else {
		const palette = renderMode === 'shadeBlocks' ? ' ░▒▓█' : characters;
		asciiLines = buildGrayscaleRows( greyPixels, canvas.width, canvas.height, palette, invert, compactWhitespace );
	}

	ascii = asciiLines.join( '\n' );

	const visibleCharacterCount = ascii.replace( /[\s\u2800]/g, '' ).length;
	$( '#char-count' )!.textContent = visibleCharacterCount.toLocaleString();

	const output = $( '#output' )!;
	output.style.display = 'block';
	const content = document.createDocumentFragment();
	asciiLines.forEach( ( line, rowIndex ) => {
		for ( const character of line ) {
			const span = document.createElement( 'span' );
			span.textContent = character;
			content.append( span );
		}
		if ( rowIndex < asciiLines.length - 1 ) content.append( document.createElement( 'br' ) );
	} );
	output.replaceChildren( content );
}
