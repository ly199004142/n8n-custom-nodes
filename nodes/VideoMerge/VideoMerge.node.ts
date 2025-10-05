import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';

export class VideoMerge implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Video Merge',
		name: 'videoMerge',
		group: ['transform'],
		version: 1,
		description: 'Concatenate multiple video files in sequence',
		defaults: {
			name: 'Video Merge',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: undefined,
		properties: [
			{
				displayName: 'Input Mode',
				name: 'inputMode',
				type: 'options',
				options: [
					{
						name: 'From Previous Node',
						value: 'fromNode',
						description: 'Get video file paths from previous node output',
					},
					{
						name: 'Manual Input',
						value: 'manual',
						description: 'Manually enter video file paths',
					},
				],
				default: 'fromNode',
				description: 'How to provide the video file paths',
			},
			{
				displayName: 'Video File Path',
				name: 'videoFilePath',
				type: 'string',
				displayOptions: {
					show: {
						inputMode: ['fromNode'],
					},
				},
				default: '={{ $json.path }}',
				description: 'Video file path from previous node (drag the field here)',
				required: true,
			},
			{
				displayName: 'Video File Paths',
				name: 'videoPaths',
				type: 'string',
				typeOptions: {
					rows: 5,
				},
				displayOptions: {
					show: {
						inputMode: ['manual'],
					},
				},
				default: '',
				placeholder: '/path/to/video1.mp4\n/path/to/video2.mp4\n/path/to/video3.mp4',
				description: 'Absolute paths to video files, one per line, in the order to concatenate',
				required: true,
			},
			{
				displayName: 'Output File Path',
				name: 'outputPath',
				type: 'string',
				default: '',
				placeholder: '/path/to/output.mp4',
				description: 'Absolute path for the output concatenated video file',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get input mode - only check once since it's the same for all items
		const inputMode = this.getNodeParameter('inputMode', 0, 'fromNode') as string;

		let videoFiles: string[] = [];

		// Handle different input modes
		if (inputMode === 'fromNode') {
			// Collect all file paths from input items using the parameter expression
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const filePath = this.getNodeParameter('videoFilePath', itemIndex, '') as string;

				if (filePath && typeof filePath === 'string' && filePath.trim().length > 0) {
					videoFiles.push(filePath.trim());
				}
			}

			if (videoFiles.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'No video file paths found from previous node',
					{ itemIndex: 0 },
				);
			}

			// Get output path (only once since we're processing all items together)
			const outputPath = this.getNodeParameter('outputPath', 0, '') as string;

			try {
				// Validate that all video files exist
				for (const videoFile of videoFiles) {
					if (!fs.existsSync(videoFile)) {
						throw new NodeOperationError(
							this.getNode(),
							`Video file does not exist: ${videoFile}`,
							{ itemIndex: 0 },
						);
					}
				}

				// Concatenate video files using fluent-ffmpeg with filter_complex
				await new Promise<void>((resolve, reject) => {
					const command = ffmpeg();

					// Add all video files as inputs
					videoFiles.forEach((file) => {
						command.input(file);
					});

					// Build filter_complex string: [0:v][0:a][1:v][1:a]...concat=n=N:v=1:a=1[outv][outa]
					const filterComplex =
						videoFiles.map((_, i) => `[${i}:v][${i}:a]`).join('') +
						`concat=n=${videoFiles.length}:v=1:a=1[outv][outa]`;

					command
						.complexFilter(filterComplex)
						.outputOptions(['-map', '[outv]', '-map', '[outa]'])
						.videoCodec('libx264')
						.audioCodec('aac')
						.outputOptions(['-preset', 'medium', '-crf', '23'])
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

				// Return success result
				returnData.push({
					json: {
						success: true,
						outputPath,
						videoFilesCount: videoFiles.length,
						videoFiles,
					},
					pairedItem: 0,
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error.message },
						pairedItem: 0,
					});
				} else {
					if (error.context) {
						error.context.itemIndex = 0;
						throw error;
					}
					throw new NodeOperationError(this.getNode(), error, { itemIndex: 0 });
				}
			}
		} else {
			// Manual input mode - process each item separately
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				try {
					const videoPaths = this.getNodeParameter('videoPaths', itemIndex, '') as string;
					const outputPath = this.getNodeParameter('outputPath', itemIndex, '') as string;

					// Split video paths by newline and filter empty lines
					videoFiles = videoPaths
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);

					if (videoFiles.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'No video file paths provided',
							{ itemIndex },
						);
					}

					// Validate that all video files exist
					for (const videoFile of videoFiles) {
						if (!fs.existsSync(videoFile)) {
							throw new NodeOperationError(
								this.getNode(),
								`Video file does not exist: ${videoFile}`,
								{ itemIndex },
							);
						}
					}

					// Concatenate video files using fluent-ffmpeg with filter_complex
					await new Promise<void>((resolve, reject) => {
						const command = ffmpeg();

						// Add all video files as inputs
						videoFiles.forEach((file) => {
							command.input(file);
						});

						// Build filter_complex string: [0:v][0:a][1:v][1:a]...concat=n=N:v=1:a=1[outv][outa]
						const filterComplex =
							videoFiles.map((_, i) => `[${i}:v][${i}:a]`).join('') +
							`concat=n=${videoFiles.length}:v=1:a=1[outv][outa]`;

						command
							.complexFilter(filterComplex)
							.outputOptions(['-map', '[outv]', '-map', '[outa]'])
							.videoCodec('libx264')
							.audioCodec('aac')
							.outputOptions(['-preset', 'medium', '-crf', '23'])
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

					// Return success result
					returnData.push({
						json: {
							success: true,
							outputPath,
							videoFilesCount: videoFiles.length,
							videoFiles,
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
		}

		return [returnData];
	}
}
