import type {
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

// Media stream information interface (supports both video and audio)
interface MediaStreamInfo {
	filePath: string;
	type: string;
	hasVideo: boolean;
	hasAudio: boolean;
	duration: number;
	videoStream: {
		width: number;
		height: number;
		codec: string;
	} | null;
	audioStream: {
		codec: string;
		sampleRate: number;
		channels: number;
		channelLayout: string;
	} | null;
}

/**
 * Escape subtitle file path for FFmpeg subtitles filter
 * FFmpeg filter paths need special escaping for: \, :, ' characters
 */
function escapeSubtitlePath(filePath: string): string {
	return filePath
		.replace(/\\/g, '\\\\\\\\')  // Backslash: \ -> \\\\
		.replace(/:/g, '\\:')        // Colon: : -> \:
		.replace(/'/g, "\\'");       // Single quote: ' -> \'
}

/**
 * Detect subtitle file format
 * @param filePath - Subtitle file path
 * @returns Subtitle format (.srt, .ass, .ssa, .vtt)
 * @throws Error if format is not supported
 */
function getSubtitleFormat(filePath: string, node: INode): string {
	const ext = path.extname(filePath).toLowerCase();
	const supportedFormats = ['.srt', '.ass', '.ssa', '.vtt'];

	if (!supportedFormats.includes(ext)) {
		throw new NodeOperationError(node, `Unsupported subtitle format: ${ext}, only supports ${supportedFormats.join(', ')}`);
	}

	return ext;
}

/**
 * Get media file stream information (supports both video and audio)
 * @param filePath - Media file path
 * @param type - Media type: 'video' or 'audio'
 */
async function getMediaStreamInfo(filePath: string, type = 'video'): Promise<MediaStreamInfo> {
	return new Promise((resolve, reject) => {
		ffmpeg.ffprobe(filePath, (err, metadata) => {
			if (err) {
				reject(err);
				return;
			}

			const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
			const audioStream = metadata.streams.find((s) => s.codec_type === 'audio');
			const hasVideo = !!videoStream;
			const hasAudio = !!audioStream;

			// Calculate accurate duration
			const duration = Math.max(
				typeof metadata.format.duration === 'number' ? metadata.format.duration : parseFloat(metadata.format.duration || '0'),
				typeof videoStream?.duration === 'number' ? videoStream.duration : parseFloat(videoStream?.duration || '0'),
				typeof audioStream?.duration === 'number' ? audioStream.duration : parseFloat(audioStream?.duration || '0')
			);

			resolve({
				filePath,
				type,
				hasVideo,
				hasAudio,
				duration,
				videoStream: videoStream ? {
					width: videoStream.width || 0,
					height: videoStream.height || 0,
					codec: videoStream.codec_name || '',
				} : null,
				audioStream: audioStream ? {
					codec: audioStream.codec_name || '',
					sampleRate: typeof audioStream.sample_rate === 'number' ? audioStream.sample_rate : parseInt(audioStream.sample_rate || '44100'),
					channels: audioStream.channels || 2,
					channelLayout: audioStream.channel_layout || 'stereo',
				} : null,
			});
		});
	});
}

export class VideoComposer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Video Composer',
		name: 'videoComposer',
		group: ['transform'],
		version: 1,
		description: 'Compose video with multiple audio tracks and optional subtitles',
		defaults: {
			name: 'Video Composer',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: undefined,
		properties: [
			{
				displayName: 'Video File Path',
				name: 'videoPath',
				type: 'string',
				default: '',
				placeholder: '/path/to/video.mp4',
				description: 'Absolute path to the video file',
				required: true,
			},
			{
				displayName: 'Audio Input Mode',
				name: 'audioInputMode',
				type: 'options',
				options: [
					{
						name: 'From Previous Node',
						value: 'fromNode',
						description: 'Get audio files array from previous node output',
					},
					{
						name: 'Manual Input',
						value: 'manual',
						description: 'Manually configure audio files',
					},
				],
				default: 'fromNode',
				description: 'How to provide the audio files',
			},
			{
				displayName: 'Audio Files Array',
				name: 'audioFilesArray',
				type: 'string',
				displayOptions: {
					show: {
						audioInputMode: ['fromNode'],
					},
				},
				default: '={{ $json.audioFiles }}',
				description: 'Audio files array from previous node. Expected format: [{"path": "/path/to/audio.mp3", "time": 0}].',
				required: true,
			},
			{
				displayName: 'Path Field Name',
				name: 'pathFieldName',
				type: 'string',
				displayOptions: {
					show: {
						audioInputMode: ['fromNode'],
					},
				},
				default: 'path',
				description: 'Field name for audio file path in the array (e.g., "path", "path", "filePath")',
				required: true,
			},
			{
				displayName: 'Time Field Name',
				name: 'timeFieldName',
				type: 'string',
				displayOptions: {
					show: {
						audioInputMode: ['fromNode'],
					},
				},
				default: 'time',
				description: 'Field name for start time in the array (e.g., "time", "startTime")',
				required: true,
			},
			{
				displayName: 'Audio Files',
				name: 'audioFiles',
				type: 'fixedCollection',
				displayOptions: {
					show: {
						audioInputMode: ['manual'],
					},
				},
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'Audio files to overlay on the video',
				options: [
					{
						displayName: 'Audio File',
						name: 'audioFile',
						values: [
							{
								displayName: 'Audio File Path',
								name: 'path',
								type: 'string',
								default: '',
								placeholder: '/path/to/audio.mp3',
								description: 'Absolute path to the audio file',
								required: true,
							},
							{
								displayName: 'Start Time (Seconds)',
								name: 'startTime',
								type: 'number',
								default: 0,
								description: 'Time in seconds when this audio should start playing',
							},
						],
					},
				],
			},
			{
				displayName: 'Subtitle File Path',
				name: 'subtitlePath',
				type: 'string',
				default: '',
				placeholder: '/path/to/subtitle.srt',
				description: 'Optional. Supports .srt, .ass, .ssa, .vtt formats. Note: Enabling subtitles will re-encode the video.',
			},
			{
				displayName: 'Mute Original Audio',
				name: 'muteOriginalAudio',
				type: 'boolean',
				default: false,
				description: 'Whether to mute the original video audio',
			},
			{
				displayName: 'Output File Path',
				name: 'outputPath',
				type: 'string',
				default: '',
				placeholder: '/path/to/output.mp4',
				description: 'Absolute path for the output file',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Step 1: Get parameters
				const videoPath = this.getNodeParameter('videoPath', itemIndex, '') as string;
				const audioInputMode = this.getNodeParameter('audioInputMode', itemIndex, 'manual') as string;

				let audioFiles: Array<{ path: string; startTime: number }> = [];

				if (audioInputMode === 'fromNode') {
					// Get audio files from previous node
					const audioFilesArray = this.getNodeParameter('audioFilesArray', itemIndex, []) as any;
					const pathFieldName = this.getNodeParameter('pathFieldName', itemIndex, 'path') as string;
					const timeFieldName = this.getNodeParameter('timeFieldName', itemIndex, 'time') as string;

					// Parse the array
					if (Array.isArray(audioFilesArray)) {
						audioFiles = audioFilesArray.map((item: any) => ({
							path: item[pathFieldName] || '',
							startTime: typeof item[timeFieldName] === 'number' ? item[timeFieldName] : 0,
						}));
					}
				} else {
					// Manual input mode
					const audioFilesParam = this.getNodeParameter('audioFiles', itemIndex, {}) as {
						audioFile?: Array<{ path: string; startTime: number }>;
					};
					audioFiles = audioFilesParam.audioFile || [];
				}

				const subtitlePath = this.getNodeParameter('subtitlePath', itemIndex, '') as string;
				const muteOriginalAudio = this.getNodeParameter('muteOriginalAudio', itemIndex, false) as boolean;
				const outputPath = this.getNodeParameter('outputPath', itemIndex, '') as string;

				// Step 2: Validate file existence
				if (!fs.existsSync(videoPath)) {
					throw new NodeOperationError(
						this.getNode(),
						`Video file does not exist: ${videoPath}`,
						{ itemIndex },
					);
				}

				for (const audioFile of audioFiles) {
					if (!fs.existsSync(audioFile.path)) {
						throw new NodeOperationError(
							this.getNode(),
							`Audio file does not exist: ${audioFile.path}`,
							{ itemIndex },
						);
					}
				}

				// Validate subtitle file
				if (subtitlePath && subtitlePath.trim().length > 0) {
					if (!fs.existsSync(subtitlePath)) {
						throw new NodeOperationError(
							this.getNode(),
							`Subtitle file does not exist: ${subtitlePath}`,
							{ itemIndex },
						);
					}
					// Validate subtitle format
					getSubtitleFormat(subtitlePath, this.getNode());
				}

				// Step 3: Detect video and audio metadata
				const videoInfo = await getMediaStreamInfo(videoPath, 'video');

				if (!videoInfo.hasVideo) {
					throw new NodeOperationError(
						this.getNode(),
						'Input file is missing video stream!',
						{ itemIndex },
					);
				}

				// Get all audio information
				const audioInfos: Array<MediaStreamInfo & { startTime: number }> = [];
				for (const audioFile of audioFiles) {
					const audioInfo = await getMediaStreamInfo(audioFile.path, 'audio');
					audioInfos.push({
						...audioInfo,
						startTime: audioFile.startTime || 0,
					});
				}

				// Step 4: Build FFmpeg Filter Complex
				const targetSampleRate = 44100; // Unified sample rate
				const videoDuration = videoInfo.duration;

				const command = ffmpeg();
				const filterParts: string[] = [];
				const audioFilterParts: string[] = []; // Audio filter section
				const audioInputLabels: string[] = []; // Store all audio stream labels for mixing

				// Add video input (index 0)
				command.input(videoPath);

				// Step 4.1: Build video filter (subtitle burning)
				let videoOutputLabel = '0:v'; // Default: use original video stream directly

				if (subtitlePath && subtitlePath.trim().length > 0) {
					// Has subtitle: use subtitles filter to burn subtitles
					const escapedSubPath = escapeSubtitlePath(subtitlePath);
					const videoFilter = `[0:v]subtitles='${escapedSubPath}'[outv]`;
					filterParts.push(videoFilter);
					videoOutputLabel = '[outv]';
				}

				// Step 4.2: Build audio filters

				// Process original video audio
				if (!muteOriginalAudio && videoInfo.hasAudio) {
					// Non-mute mode: include original video audio in mixing
					const channels = videoInfo.audioStream?.channels || 2;
					if (channels === 1) {
						// Mono to stereo conversion
						audioFilterParts.push(`[0:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[orig_audio]`);
					} else {
						// Dual or multi-channel to stereo
						audioFilterParts.push(`[0:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo[orig_audio]`);
					}
					audioInputLabels.push('[orig_audio]');
				}

				// Process each audio file to overlay
				let actualInputIndex = 1; // Track actual input index (0 is video, starts from 1 for audio)

				for (let i = 0; i < audioInfos.length; i++) {
					const audioInfo = audioInfos[i];

					if (!audioInfo.hasAudio) {
						continue;
					}

					const startTime = audioInfo.startTime;
					const audioDuration = audioInfo.duration;

					// Calculate effective duration for this audio (cannot exceed video)
					const maxDuration = videoDuration - startTime;
					const effectiveDuration = Math.min(audioDuration, maxDuration);

					if (effectiveDuration <= 0) {
						continue;
					}

					// Add audio input
					command.input(audioInfo.filePath);
					const inputIndex = actualInputIndex++; // Use actual input index and increment

					// Build filter chain for this audio
					let audioFilter = `[${inputIndex}:a]`;
					const channels = audioInfo.audioStream?.channels || 2;

					// Step 1: Unify format (sample rate + channel layout)
					if (channels === 1) {
						// Mono to stereo conversion
						audioFilter += `aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0,`;
					} else {
						// Dual or multi-channel to stereo
						audioFilter += `aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo,`;
					}

					// Step 2: Trim audio beyond video length
					audioFilter += `atrim=0:${effectiveDuration},`;

					// Step 3: Set PTS (ensure correct timestamps)
					audioFilter += `asetpts=PTS-STARTPTS,`;

					// Step 4: Add delay (if startTime > 0)
					if (startTime > 0) {
						// adelay unit is milliseconds, need to set for each channel separately
						const delayMs = Math.round(startTime * 1000);
						audioFilter += `adelay=${delayMs}|${delayMs}:all=1,`;
					}

					// Step 5: Pad silence to video duration
					const padDuration = videoDuration - effectiveDuration - startTime;
					if (padDuration > 0) {
						audioFilter += `apad=pad_dur=${padDuration.toFixed(3)}`;
					} else {
						// No padding needed, remove trailing comma
						audioFilter = audioFilter.slice(0, -1);
					}

					audioFilter += `[a${i}]`;
					audioFilterParts.push(audioFilter);
					audioInputLabels.push(`[a${i}]`);
				}

				// Step 4.3: Audio mixing
				if (audioInputLabels.length === 0) {
					// No audio, generate silence
					audioFilterParts.push(`anullsrc=channel_layout=stereo:sample_rate=${targetSampleRate}:duration=${videoDuration}[outa]`);
				} else if (audioInputLabels.length === 1) {
					// Only one audio stream, use directly
					audioFilterParts.push(`${audioInputLabels[0]}anull[outa]`);
				} else {
					// Multiple audio streams, use amix for mixing
					const mixInputs = audioInputLabels.join('');
					audioFilterParts.push(`${mixInputs}amix=inputs=${audioInputLabels.length}:duration=longest:dropout_transition=0[outa]`);
				}

				// Step 4.4: Merge video and audio filters
				filterParts.push(...audioFilterParts);
				const filterComplex = filterParts.join(';');

				// Step 5: Execute FFmpeg command
				await new Promise<void>((resolve, reject) => {
					// Build output options
					const outputOptions = [
						'-map', videoOutputLabel,          // Map video stream
						'-map', '[outa]',                  // Map processed audio stream
					];

					// Decide video encoding method based on subtitle presence
					if (subtitlePath && subtitlePath.trim().length > 0) {
						// Has subtitle: must re-encode video
						outputOptions.push(
							'-c:v', 'libx264',             // H.264 video encoding
							'-preset', 'medium',           // Encoding speed
							'-crf', '23',                  // Video quality
							'-pix_fmt', 'yuv420p',         // Pixel format
						);
					} else {
						// No subtitle: copy video stream directly
						outputOptions.push('-c:v', 'copy');
					}

					// Audio encoding parameters
					outputOptions.push(
						'-c:a', 'aac',                     // Audio encode as AAC
						'-b:a', '192k',                    // AAC audio bitrate
						'-ar', String(targetSampleRate),   // Audio sample rate
						'-ac', '2',                        // Stereo
						'-movflags', '+faststart',         // Optimize for network playback
					);

					command
						.complexFilter(filterComplex)
						.outputOptions(outputOptions)
						.output(outputPath)
						.on('start', (commandLine: string) => {
							console.log('FFmpeg command:', commandLine);
						})
						.on('stderr', (stderrLine: string) => {
							console.log('FFmpeg stderr:', stderrLine);
						})
						.on('end', () => {
							resolve();
						})
						.on('error', (err: Error) => {
							console.error('FFmpeg error:', err.message);
							reject(err);
						})
						.run();
				});

				// Step 6: Return result
				returnData.push({
					json: {
						success: true,
						outputPath,
						videoPath,
						audioFilesCount: audioFiles.length,
						hasSubtitle: !!(subtitlePath && subtitlePath.trim().length > 0),
						muteOriginalAudio,
						videoDuration: videoInfo.duration,
					},
					pairedItem: itemIndex,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: itemIndex,
					});
				} else {
					if (error.context) {
						error.context.itemIndex = itemIndex;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}
			}
		}

		return [returnData];
	}
}
