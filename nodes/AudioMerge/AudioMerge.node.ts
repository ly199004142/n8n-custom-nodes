import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { execFFmpeg } from '../utils/ffmpeg';
import * as fs from 'fs';
import * as path from 'path';

export class AudioMerge implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Audio Merge',
		name: 'audioMerge',
		group: ['transform'],
		version: 1,
		description: 'Concatenate multiple audio files in sequence',
		defaults: {
			name: 'Audio Merge',
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
						description: 'Get audio file paths from previous node output',
					},
					{
						name: 'Manual Input',
						value: 'manual',
						description: 'Manually enter audio file paths',
					},
				],
				default: 'fromNode',
				description: 'How to provide the audio file paths',
			},
			{
				displayName: 'Audio File Path',
				name: 'audioFilePath',
				type: 'string',
				displayOptions: {
					show: {
						inputMode: ['fromNode'],
					},
				},
				default: '={{ $json.path }}',
				description: 'Audio file path from previous node (drag the field here)',
				required: true,
			},
			{
				displayName: 'Audio File Paths',
				name: 'audioPaths',
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
				placeholder: '/path/to/audio1.mp3\n/path/to/audio2.mp3\n/path/to/audio3.mp3',
				description: 'Absolute paths to audio files, one per line, in the order to concatenate',
				required: true,
			},
			{
				displayName: 'Output File Path',
				name: 'outputPath',
				type: 'string',
				default: '',
				placeholder: '/path/to/output.mp3',
				description: 'Absolute path for the output concatenated audio file',
				required: true,
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get input mode - only check once since it's the same for all items
		const inputMode = this.getNodeParameter('inputMode', 0, 'fromNode') as string;

		let audioFiles: string[] = [];

		// Handle different input modes
		if (inputMode === 'fromNode') {
			// Collect all file paths from input items using the parameter expression
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const filePath = this.getNodeParameter('audioFilePath', itemIndex, '') as string;

				if (filePath && typeof filePath === 'string' && filePath.trim().length > 0) {
					audioFiles.push(filePath.trim());
				}
			}

			if (audioFiles.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'No audio file paths found from previous node',
					{ itemIndex: 0 },
				);
			}

			// Get output path (only once since we're processing all items together)
			const outputPath = this.getNodeParameter('outputPath', 0, '') as string;

			try {
				// Validate that all audio files exist
				for (const audioFile of audioFiles) {
					if (!fs.existsSync(audioFile)) {
						throw new NodeOperationError(
							this.getNode(),
							`Audio file does not exist: ${audioFile}`,
							{ itemIndex: 0 },
						);
					}
				}

				// Create temporary concat file list
				const tempDir = path.dirname(outputPath);
				const fileListPath = path.join(tempDir, `concat-list-${Date.now()}.txt`);
				const fileListContent = audioFiles.map((file) => `file '${file}'`).join('\n');

				fs.writeFileSync(fileListPath, fileListContent);

				// Concatenate audio files using ffmpeg
				try {
					await execFFmpeg({
						args: [
							'-f', 'concat',
							'-safe', '0',
							'-i', fileListPath,
							'-c:a', 'libmp3lame',
							'-b:a', '128k',
							outputPath,
						],
						onStderr: (line) => {
							// Log progress information
							console.log('FFmpeg:', line);
						},
					});
				} finally {
					// Clean up temporary file
					if (fs.existsSync(fileListPath)) {
						fs.unlinkSync(fileListPath);
					}
				}

				// Return success result
				returnData.push({
					json: {
						success: true,
						outputPath,
						audioFilesCount: audioFiles.length,
						audioFiles,
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
					const audioPaths = this.getNodeParameter('audioPaths', itemIndex, '') as string;
					const outputPath = this.getNodeParameter('outputPath', itemIndex, '') as string;

					// Split audio paths by newline and filter empty lines
					audioFiles = audioPaths
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);

					if (audioFiles.length === 0) {
						throw new NodeOperationError(
							this.getNode(),
							'No audio file paths provided',
							{ itemIndex },
						);
					}

					// Validate that all audio files exist
					for (const audioFile of audioFiles) {
						if (!fs.existsSync(audioFile)) {
							throw new NodeOperationError(
								this.getNode(),
								`Audio file does not exist: ${audioFile}`,
								{ itemIndex },
							);
						}
					}

					// Create temporary concat file list
					const tempDir = path.dirname(outputPath);
					const fileListPath = path.join(tempDir, `concat-list-${Date.now()}.txt`);
					const fileListContent = audioFiles.map((file) => `file '${file}'`).join('\n');

					fs.writeFileSync(fileListPath, fileListContent);

					// Concatenate audio files using ffmpeg
					try {
						await execFFmpeg({
							args: [
								'-f', 'concat',
								'-safe', '0',
								'-i', fileListPath,
								'-c:a', 'libmp3lame',
								'-b:a', '128k',
								outputPath,
							],
							onStderr: (line) => {
								// Log progress information
								console.log('FFmpeg:', line);
							},
						});
					} finally {
						// Clean up temporary file
						if (fs.existsSync(fileListPath)) {
							fs.unlinkSync(fileListPath);
						}
					}

					// Return success result
					returnData.push({
						json: {
							success: true,
							outputPath,
							audioFilesCount: audioFiles.length,
							audioFiles,
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
