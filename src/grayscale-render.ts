import { rgbaOffset } from './helpers.js';

function trimRows( rows: string[] ) {
	const trimmedRows = rows
		.map( row => row.replace( /^\s+|\s+$/g, '' ) )
		.filter( row => row.length > 0 );
	return trimmedRows.length ? trimmedRows : [ '' ];
}

function getLuminance( pixels: ImageData, width: number, x: number, y: number, invert: boolean ) {
	const offset = rgbaOffset( x, y, width );
	const value = 0.2126 * pixels.data[ offset ] + 0.7152 * pixels.data[ offset + 1 ] + 0.0722 * pixels.data[ offset + 2 ];
	return invert ? 255 - value : value;
}

export function buildGrayscaleRows( pixels: ImageData, width: number, height: number, characters: string, invert: boolean, compactWhitespace: boolean ) {
	const palette = Array.from( characters );
	if ( !palette.length ) return [ '' ];

	const rows: string[] = [];
	for ( let y = 0; y < height; y++ ) {
		let row = '';
		for ( let x = 0; x < width; x++ ) {
			const luminance = getLuminance( pixels, width, x, y, invert );
			const paletteIndex = Math.round( ( 255 - luminance ) / 255 * ( palette.length - 1 ) );
			row += palette[ paletteIndex ];
		}
		rows.push( row );
	}

	return compactWhitespace ? trimRows( rows ) : rows;
}

export function buildHalfBlockRows( pixels: ImageData, width: number, height: number, invert: boolean, compactWhitespace: boolean ) {
	const rows: string[] = [];
	for ( let y = 0; y < height; y += 2 ) {
		let row = '';
		for ( let x = 0; x < width; x++ ) {
			const top = getLuminance( pixels, width, x, y, invert ) >= 128;
			const bottom = y + 1 < height && getLuminance( pixels, width, x, y + 1, invert ) >= 128;
			row += top ? ( bottom ? '█' : '▀' ) : ( bottom ? '▄' : ' ' );
		}
		rows.push( row );
	}

	return compactWhitespace ? trimRows( rows ) : rows;
}