import { spawn } from 'child_process';

/**
 * FFmpeg execution options
 */
export interface FFmpegOptions {
	/** FFmpeg command arguments */
	args: string[];
	/** Callback for stderr output (for progress logging) */
	onStderr?: (line: string) => void;
	/** Callback for stdout output */
	onStdout?: (line: string) => void;
}

/**
 * FFprobe metadata format interface
 */
export interface FFprobeFormat {
	duration?: string | number;
	[key: string]: any;
}

/**
 * FFprobe stream interface
 */
export interface FFprobeStream {
	codec_type?: string;
	codec_name?: string;
	width?: number;
	height?: number;
	duration?: string | number;
	sample_rate?: string | number;
	channels?: number;
	channel_layout?: string;
	r_frame_rate?: string;
	[key: string]: any;
}

/**
 * FFprobe metadata interface
 */
export interface FFprobeMetadata {
	format: FFprobeFormat;
	streams: FFprobeStream[];
}

/**
 * Execute ffmpeg command
 * @param options FFmpeg execution options
 * @returns Promise that resolves when ffmpeg completes
 */
export async function execFFmpeg(options: FFmpegOptions): Promise<void> {
	return new Promise((resolve, reject) => {
		const ffmpegProcess = spawn('ffmpeg', options.args);

		let stderrOutput = '';

		ffmpegProcess.stdout.on('data', (data: Buffer) => {
			const output = data.toString();
			if (options.onStdout) {
				options.onStdout(output);
			}
		});

		ffmpegProcess.stderr.on('data', (data: Buffer) => {
			const line = data.toString();
			stderrOutput += line;

			if (options.onStderr) {
				options.onStderr(line);
			}
		});

		ffmpegProcess.on('error', (error: Error) => {
			reject(new Error(`Failed to start ffmpeg: ${error.message}`));
		});

		ffmpegProcess.on('close', (code: number | null) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`FFmpeg exited with code ${code}. stderr: ${stderrOutput}`));
			}
		});
	});
}

/**
 * Execute ffprobe command to get media metadata
 * @param filePath Path to the media file
 * @returns Promise resolving to FFprobe metadata
 */
export async function execFFprobe(filePath: string): Promise<FFprobeMetadata> {
	return new Promise((resolve, reject) => {
		const args = [
			'-v', 'quiet',
			'-print_format', 'json',
			'-show_format',
			'-show_streams',
			filePath,
		];

		const ffprobeProcess = spawn('ffprobe', args);

		let stdoutData = '';
		let stderrData = '';

		ffprobeProcess.stdout.on('data', (data: Buffer) => {
			stdoutData += data.toString();
		});

		ffprobeProcess.stderr.on('data', (data: Buffer) => {
			stderrData += data.toString();
		});

		ffprobeProcess.on('error', (error: Error) => {
			reject(new Error(`Failed to start ffprobe: ${error.message}`));
		});

		ffprobeProcess.on('close', (code: number | null) => {
			if (code === 0) {
				try {
					const metadata = JSON.parse(stdoutData) as FFprobeMetadata;
					resolve(metadata);
				} catch (error) {
					reject(new Error(`Failed to parse ffprobe output: ${error instanceof Error ? error.message : 'Unknown error'}`));
				}
			} else {
				reject(new Error(`FFprobe exited with code ${code}. stderr: ${stderrData}`));
			}
		});
	});
}
