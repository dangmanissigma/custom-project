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

export const CHARACTER_SETS: Record<Exclude<CharacterSet, 'custom'>, string> = {
	classic: ' .:-=+*#%@',
	standard: ' .:-=+*#%@',
	detailed: " .'-_,~:;=!*?+%#@",
	dense: ' .,:;i1tfLCG08@',
	minimal: ' .:-#@',
	punctuation: ' .,:;!?-_+=*/\\|()[]{}#@',
	blocks: ' ░▒▓█',
	retro: " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
	cyber: ' .-+*%@#$X01',
	matrix: '  .:|/\\1lI0O#@',
	terminal: ' .,:;+=xX$#@',
};

export const DEFAULT_SETTINGS: AppSettings = {
	mode: 'ascii',
	characterSet: 'detailed',
	characters: CHARACTER_SETS.detailed,
	reversePalette: false,
	width: 80,
	aspectRatio: 0.5,
	ditherer: 'floydSteinberg',
	threshold: 127,
	brightness: 0,
	contrast: 0,
	gamma: 1,
	exposure: 0,
	saturation: 100,
	sharpness: 0,
	blur: 0,
	blackPoint: 0,
	whitePoint: 255,
	invert: false,
	swapDotsAndSpaces: false,
	compactWhitespace: true,
	mirror: false,
	fontSize: 10,
	lineHeight: 1.1,
	letterSpacing: 0,
	theme: 'system',
};

export const MAX_WIDTH = 220;
export const MAX_OUTPUT_CELLS = 40000;

const renderModes: RenderMode[] = [ 'ascii', 'braille', 'halfBlock', 'shadeBlocks' ];
const characterSetNames: CharacterSet[] = [ 'classic', 'standard', 'detailed', 'dense', 'minimal', 'punctuation', 'blocks', 'retro', 'cyber', 'matrix', 'terminal', 'custom' ];
const dithererNames: DithererName[] = [ 'threshold', 'floydSteinberg', 'stucki', 'atkinson', 'ordered2', 'ordered4', 'ordered8', 'burkes', 'sierraLite' ];
const themeModes: ThemeMode[] = [ 'system', 'light', 'dark' ];

function boundedNumber( value: unknown, fallback: number, minimum: number, maximum: number ) {
	const number = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( number ) ? Math.max( minimum, Math.min( maximum, number ) ) : fallback;
}

export function validateSettings( value: Partial<AppSettings> ): AppSettings {
	const mode = renderModes.includes( value.mode as RenderMode ) ? value.mode as RenderMode : DEFAULT_SETTINGS.mode;
	const characterSet = characterSetNames.includes( value.characterSet as CharacterSet ) ? value.characterSet as CharacterSet : DEFAULT_SETTINGS.characterSet;
	const ditherer = dithererNames.includes( value.ditherer as DithererName ) ? value.ditherer as DithererName : DEFAULT_SETTINGS.ditherer;
	const theme = themeModes.includes( value.theme as ThemeMode ) ? value.theme as ThemeMode : DEFAULT_SETTINGS.theme;
	const characters = typeof value.characters === 'string' && value.characters.length > 0
		? Array.from( value.characters ).slice( 0, 128 ).join( '' )
		: DEFAULT_SETTINGS.characters;

	return {
		mode,
		characterSet,
		characters,
		reversePalette: value.reversePalette === true,
		width: Math.round( boundedNumber( value.width, DEFAULT_SETTINGS.width, 8, MAX_WIDTH ) ),
		aspectRatio: boundedNumber( value.aspectRatio, DEFAULT_SETTINGS.aspectRatio, 0.35, 1 ),
		ditherer,
		threshold: Math.round( boundedNumber( value.threshold, DEFAULT_SETTINGS.threshold, 0, 255 ) ),
		brightness: Math.round( boundedNumber( value.brightness, 0, -100, 100 ) ),
		contrast: Math.round( boundedNumber( value.contrast, 0, -100, 100 ) ),
		gamma: boundedNumber( value.gamma, DEFAULT_SETTINGS.gamma, 0.2, 3 ),
		exposure: boundedNumber( value.exposure, 0, -2, 2 ),
		saturation: boundedNumber( value.saturation, 100, 0, 200 ),
		sharpness: boundedNumber( value.sharpness, 0, 0, 100 ),
		blur: boundedNumber( value.blur, 0, 0, 5 ),
		blackPoint: boundedNumber( value.blackPoint, 0, 0, 100 ),
		whitePoint: boundedNumber( value.whitePoint, 255, 155, 255 ),
		invert: value.invert === true,
		swapDotsAndSpaces: value.swapDotsAndSpaces === true,
		compactWhitespace: value.compactWhitespace !== false,
		mirror: value.mirror === true,
		fontSize: Math.round( boundedNumber( value.fontSize, DEFAULT_SETTINGS.fontSize, 6, 32 ) ),
		lineHeight: boundedNumber( value.lineHeight, DEFAULT_SETTINGS.lineHeight, 0.75, 2 ),
		letterSpacing: boundedNumber( value.letterSpacing, DEFAULT_SETTINGS.letterSpacing, -0.1, 0.2 ),
		theme,
	};
}

export interface RenderDimensions {
	columns: number;
	rows: number;
	pixelWidth: number;
	pixelHeight: number;
	limited: boolean;
}

export function calculateRenderDimensions( imageWidth: number, imageHeight: number, settings: AppSettings ): RenderDimensions {
	if ( !Number.isFinite( imageWidth ) || !Number.isFinite( imageHeight ) || imageWidth <= 0 || imageHeight <= 0 ) {
		throw new RangeError( 'Image dimensions must be positive finite numbers.' );
	}
	const columns = Math.round( boundedNumber( settings.width, DEFAULT_SETTINGS.width, 8, MAX_WIDTH ) );
	const rowAspect = boundedNumber( settings.aspectRatio, DEFAULT_SETTINGS.aspectRatio, 0.35, 1 );
	const rowsPerCharacter = settings.mode === 'braille' ? 4 : settings.mode === 'halfBlock' ? 2 : 1;
	const columnsPerCharacter = settings.mode === 'braille' ? 2 : 1;
	const naturalRows = Math.max( 1, Math.ceil( columns * imageHeight / imageWidth * rowAspect ) );
	const rows = Math.min( naturalRows, Math.max( 1, Math.floor( MAX_OUTPUT_CELLS / columns ) ) );

	return {
		columns,
		rows,
		pixelWidth: columns * columnsPerCharacter,
		pixelHeight: rows * rowsPerCharacter,
		limited: rows < naturalRows,
	};
}