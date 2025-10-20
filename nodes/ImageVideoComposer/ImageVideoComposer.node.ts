import type {
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { execFFmpeg, execFFprobe } from '../utils/ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

// Scene info interface
interface SceneInfo {
	image_filepath: string;
	scene_duration: number; // milliseconds
}

// Audio info interface
interface AudioInfo {
	audio_filePath: string;
	audio_starttime: number; // milliseconds
	duration?: number; // actual audio duration (seconds)
}

/**
 * Escape subtitle file path for FFmpeg subtitles filter
 * FFmpeg filter paths need special escaping: \\, :, ' characters
 */
function escapeSubtitlePath(filePath: string): string {
	return filePath
		.replace(/\\/g, '\\\\\\\\')  // Backslash: \ -> \\\\
		.replace(/:/g, '\\:')        // Colon: : -> \:
		.replace(/'/g, "\\'");       // Single quote: ' -> \'
}

/**
 * Get audio file duration in seconds
 */
async function getAudioDuration(filePath: string): Promise<number> {
	const metadata = await execFFprobe(filePath);
	const duration = typeof metadata.format.duration === 'number'
		? metadata.format.duration
		: parseFloat(metadata.format.duration as string || '0');
	return duration;
}

/**
 * Detect subtitle file format
 */
function getSubtitleFormat(filePath: string, node: INode): string {
	const ext = path.extname(filePath).toLowerCase();
	const supportedFormats = ['.srt', '.ass', '.ssa', '.vtt'];

	if (!supportedFormats.includes(ext)) {
		throw new NodeOperationError(node, `Unsupported subtitle format: ${ext}, only supports ${supportedFormats.join(', ')}`);
	}

	return ext;
}

export class ImageVideoComposer implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Image Video Composer',
		name: 'imageVideoComposer',
		group: ['transform'],
		version: 1,
		description: 'Compose multiple images and audio into video with Ken Burns zoom effect and subtitle burning',
		defaults: {
			name: 'Image Video Composer',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: undefined,
		properties: [
			{
				displayName: 'Scene List Input Mode',
				name: 'sceneInputMode',
				type: 'options',
				options: [
					{
						name: 'From Previous Node',
						value: 'fromNode',
						description: 'Get scene list array from previous node output',
					},
					{
						name: 'Manual Input',
						value: 'manual',
						description: 'Manually configure scene list',
					},
				],
				default: 'fromNode',
				description: 'How to provide the scene list',
			},
			{
				displayName: 'Scene List Array',
				name: 'sceneListArray',
				type: 'string',
				displayOptions: {
					show: {
						sceneInputMode: ['fromNode'],
					},
				},
				default: '={{ $json.sceneList }}',
				description: 'Scene list from previous node. Expected format: [{"image_filepath": "/path/to/image.jpg", "scene_duration": 3000}].',
				required: true,
			},
			{
				displayName: 'Image Path Field Name',
				name: 'imagePathFieldName',
				type: 'string',
				displayOptions: {
					show: {
						sceneInputMode: ['fromNode'],
					},
				},
				default: 'image_filepath',
				description: 'Field name for image file path in the array (e.g., "image_filepath", "path", "imagePath")',
				required: true,
			},
			{
				displayName: 'Duration Field Name',
				name: 'durationFieldName',
				type: 'string',
				displayOptions: {
					show: {
						sceneInputMode: ['fromNode'],
					},
				},
				default: 'scene_duration',
				description: 'Field name for scene duration in the array (e.g., "scene_duration", "duration"). Unit: milliseconds.',
				required: true,
			},
			{
				displayName: 'Scene List',
				name: 'sceneList',
				type: 'fixedCollection',
				displayOptions: {
					show: {
						sceneInputMode: ['manual'],
					},
				},
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				description: 'Image scenes to compose',
				options: [
					{
						displayName: 'Scene',
						name: 'scene',
						values: [
							{
								displayName: 'Image File Path',
								name: 'imagePath',
								type: 'string',
								default: '',
								placeholder: '/path/to/image.jpg',
								description: 'Absolute path to the image file',
								required: true,
							},
							{
								displayName: 'Scene Duration (Milliseconds)',
								name: 'duration',
								type: 'number',
								default: 3000,
								description: 'Display duration for this image (milliseconds)',
								required: true,
							},
						],
					},
				],
			},
			{
				displayName: 'Enable Ken Burns Zoom Effect',
				name: 'enableKenBurns',
				type: 'boolean',
				default: true,
				description: 'Whether to apply Ken Burns zoom effect to images (slow zoom from 1.0x to 1.1x)',
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
				displayName: 'Audio List Array',
				name: 'audioListArray',
				type: 'string',
				displayOptions: {
					show: {
						audioInputMode: ['fromNode'],
					},
				},
				default: '={{ $json.audioList }}',
				description: 'Audio list from previous node. Expected format: [{"audio_filePath": "/path/to/audio.mp3", "audio_starttime": 0}].',
				required: true,
			},
			{
				displayName: 'Audio Path Field Name',
				name: 'audioPathFieldName',
				type: 'string',
				displayOptions: {
					show: {
						audioInputMode: ['fromNode'],
					},
				},
				default: 'audio_filePath',
				description: 'Field name for audio file path in the array (e.g., "audio_filePath", "path", "audioPath")',
				required: true,
			},
			{
				displayName: 'Audio Start Time Field Name',
				name: 'audioStartTimeFieldName',
				type: 'string',
				displayOptions: {
					show: {
						audioInputMode: ['fromNode'],
					},
				},
				default: 'audio_starttime',
				description: 'Field name for audio start time in the array (e.g., "audio_starttime", "startTime"). Unit: milliseconds.',
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
								displayName: 'Start Time (Milliseconds)',
								name: 'startTime',
								type: 'number',
								default: 0,
								description: 'Start time for this audio in the video (milliseconds)',
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
				const sceneInputMode = this.getNodeParameter('sceneInputMode', itemIndex, 'manual') as string;
				const enableKenBurns = this.getNodeParameter('enableKenBurns', itemIndex, true) as boolean;
				const audioInputMode = this.getNodeParameter('audioInputMode', itemIndex, 'manual') as string;

				// Get scene list
				let sceneList: SceneInfo[] = [];
				if (sceneInputMode === 'fromNode') {
					const sceneListArray = this.getNodeParameter('sceneListArray', itemIndex, []) as any;
					const imagePathFieldName = this.getNodeParameter('imagePathFieldName', itemIndex, 'image_filepath') as string;
					const durationFieldName = this.getNodeParameter('durationFieldName', itemIndex, 'scene_duration') as string;

					if (Array.isArray(sceneListArray)) {
						sceneList = sceneListArray.map((item: any) => ({
							image_filepath: item[imagePathFieldName] || '',
							scene_duration: typeof item[durationFieldName] === 'number' ? item[durationFieldName] : 0,
						}));
					}
				} else {
					const sceneListParam = this.getNodeParameter('sceneList', itemIndex, {}) as {
						scene?: Array<{ imagePath: string; duration: number }>;
					};
					sceneList = (sceneListParam.scene || []).map((item) => ({
						image_filepath: item.imagePath,
						scene_duration: item.duration,
					}));
				}

				// Get audio list
				let audioList: Array<{ audio_filePath: string; audio_starttime: number }> = [];
				if (audioInputMode === 'fromNode') {
					const audioListArray = this.getNodeParameter('audioListArray', itemIndex, []) as any;
					const audioPathFieldName = this.getNodeParameter('audioPathFieldName', itemIndex, 'audio_filePath') as string;
					const audioStartTimeFieldName = this.getNodeParameter('audioStartTimeFieldName', itemIndex, 'audio_starttime') as string;

					if (Array.isArray(audioListArray)) {
						audioList = audioListArray.map((item: any) => ({
							audio_filePath: item[audioPathFieldName] || '',
							audio_starttime: typeof item[audioStartTimeFieldName] === 'number' ? item[audioStartTimeFieldName] : 0,
						}));
					}
				} else {
					const audioFilesParam = this.getNodeParameter('audioFiles', itemIndex, {}) as {
						audioFile?: Array<{ path: string; startTime: number }>;
					};
					audioList = (audioFilesParam.audioFile || []).map((item) => ({
						audio_filePath: item.path,
						audio_starttime: item.startTime || 0,
					}));
				}

				const subtitlePath = this.getNodeParameter('subtitlePath', itemIndex, '') as string;
				const outputPath = this.getNodeParameter('outputPath', itemIndex, '') as string;

				// Step 2: Validate file existence
				if (sceneList.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'Scene list is empty, at least one image scene is required',
						{ itemIndex },
					);
				}

				for (const scene of sceneList) {
					if (!fs.existsSync(scene.image_filepath)) {
						throw new NodeOperationError(
							this.getNode(),
							`Image file does not exist: ${scene.image_filepath}`,
							{ itemIndex },
						);
					}
				}

				for (const audio of audioList) {
					if (!fs.existsSync(audio.audio_filePath)) {
						throw new NodeOperationError(
							this.getNode(),
							`Audio file does not exist: ${audio.audio_filePath}`,
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
					getSubtitleFormat(subtitlePath, this.getNode());
				}

				// Step 3: Calculate total duration (milliseconds to seconds)
				const totalDuration = sceneList.reduce((sum, scene) => sum + scene.scene_duration, 0) / 1000;

				// Step 4: Get all audio duration info
				const audioInfos: AudioInfo[] = [];
				for (const audio of audioList) {
					const duration = await getAudioDuration(audio.audio_filePath);
					audioInfos.push({
						...audio,
						duration,
					});
				}

				// Step 5: Build FFmpeg command
				const filterParts: string[] = [];
				const targetSampleRate = 44100;
				const inputFiles: string[] = [];

				// 5.1 Add all image inputs
				for (let i = 0; i < sceneList.length; i++) {
					inputFiles.push(sceneList[i].image_filepath);
				}

				// 5.2 Add all audio inputs
				const audioStartIndex = sceneList.length;
				for (let i = 0; i < audioList.length; i++) {
					inputFiles.push(audioList[i].audio_filePath);
				}

				// 5.3 Build video filters - set duration for each image and scaling effect
				const videoLabels: string[] = [];
				for (let i = 0; i < sceneList.length; i++) {
					const duration = sceneList[i].scene_duration / 1000;
					const fps = 25;
					const totalFrames = Math.ceil(duration * fps);

					let filter: string;
					if (enableKenBurns) {
						// Ken Burns effect: zoom from 1.0x to 1.1x (10% zoom)
						filter = `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},zoompan=z='1+0.1*on/${totalFrames}':d=${totalFrames}:x='iw/2-(1920/2)':y='ih/2-(1080/2)':s=1920x1080,trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`;
					} else {
						// No zoom effect: only scale and pad
						filter = `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`;
					}

					filterParts.push(filter);
					videoLabels.push(`[v${i}]`);
				}

				// 5.4 Concat all image videos
				const concatFilter = `${videoLabels.join('')}concat=n=${sceneList.length}:v=1:a=0[video_concat]`;
				filterParts.push(concatFilter);

				// 5.4.1 Add subtitle burning (if subtitle file is provided)
				let videoOutputLabel = '[video_concat]';
				if (subtitlePath && subtitlePath.trim().length > 0) {
					const escapedSubPath = escapeSubtitlePath(subtitlePath);
					// Add subtitle with UTF-8 encoding to avoid garbled text
					// charenc specifies subtitle file encoding as UTF-8
					const subtitleFilter = `[video_concat]subtitles='${escapedSubPath}':charenc=UTF-8[outv]`;
					filterParts.push(subtitleFilter);
					videoOutputLabel = '[outv]';
				} else {
					// No subtitle, just rename the label
					filterParts.push('[video_concat]copy[outv]');
					videoOutputLabel = '[outv]';
				}

				// 5.5 Build audio filters
				const audioLabels: string[] = [];
				for (let i = 0; i < audioInfos.length; i++) {
					const audioInfo = audioInfos[i];
					const startTime = audioInfo.audio_starttime / 1000;
					const duration = audioInfo.duration!;
					const inputIndex = audioStartIndex + i;

					// Calculate effective duration (cannot exceed video total duration)
					const maxDuration = totalDuration - startTime;
					const effectiveDuration = Math.min(duration, maxDuration);

					if (effectiveDuration <= 0) {
						continue;
					}

					// Build audio processing chain: format -> trim -> reset pts -> delay -> pad silence
					let audioFilter = `[${inputIndex}:a]`;

					// Unify format and sample rate
					audioFilter += `aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo,`;

					// Trim audio length
					audioFilter += `atrim=0:${effectiveDuration},`;

					// Reset timestamps
					audioFilter += `asetpts=PTS-STARTPTS,`;

					// Add delay if needed
					if (startTime > 0) {
						const delayMs = Math.round(startTime * 1000);
						audioFilter += `adelay=${delayMs}|${delayMs}:all=1,`;
					}

					// Pad silence to video total duration
					const padDuration = totalDuration - effectiveDuration - startTime;
					if (padDuration > 0) {
						audioFilter += `apad=pad_dur=${padDuration.toFixed(3)}`;
					} else {
						// Remove trailing comma
						audioFilter = audioFilter.slice(0, -1);
					}

					audioFilter += `[a${i}]`;
					filterParts.push(audioFilter);
					audioLabels.push(`[a${i}]`);
				}

				// 5.6 Mix all audio
				if (audioLabels.length === 0) {
					// No audio, generate silence
					filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=${targetSampleRate}:duration=${totalDuration}[outa]`);
				} else if (audioLabels.length === 1) {
					// Only one audio, use directly
					filterParts.push(`${audioLabels[0]}anull[outa]`);
				} else {
					// Multiple audio, mix them
					const mixInputs = audioLabels.join('');
					filterParts.push(`${mixInputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0[mixed];[mixed]volume=4dB[outa]`);
				}

				// 5.7 Combine full filter_complex
				const filterComplex = filterParts.join(';');

				// Step 6: Execute FFmpeg command
				const ffmpegArgs: string[] = [];

				// Add input files
				for (const inputFile of inputFiles) {
					ffmpegArgs.push('-i', inputFile);
				}

				// Add filter complex
				ffmpegArgs.push('-filter_complex', filterComplex);

				// Add output options
				ffmpegArgs.push(
					'-map', videoOutputLabel,
					'-map', '[outa]',
					'-c:v', 'libx264',
					'-preset', 'medium',
					'-crf', '23',
					'-pix_fmt', 'yuv420p',
					'-c:a', 'aac',
					'-b:a', '192k',
					'-ar', String(targetSampleRate),
					'-ac', '2',
					'-movflags', '+faststart',
				);

				// Output file
				ffmpegArgs.push(outputPath);

				// Execute ffmpeg
				await execFFmpeg({
					args: ffmpegArgs,
					onStderr: (line) => {
						if (line.includes('frame=') || line.includes('error') || line.includes('Error')) {
							console.log('FFmpeg:', line);
						}
					},
				});

				console.log('Video composition completed!');

				// Step 7: Return result
				returnData.push({
					json: {
						success: true,
						outputPath,
						totalDuration,
						sceneCount: sceneList.length,
						audioCount: audioList.length,
						hasSubtitle: !!(subtitlePath && subtitlePath.trim().length > 0),
						kenBurnsEnabled: enableKenBurns,
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
