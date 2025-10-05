import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import ffmpeg from 'fluent-ffmpeg';
import * as fs from 'fs';

// 视频流信息接口
interface VideoStreamInfo {
	filePath: string;
	hasVideo: boolean;
	hasAudio: boolean;
	duration: number;
	videoStream: {
		width: number;
		height: number;
		codec: string;
		fps: number;
		aspectRatio: number;
	} | null;
	audioStream: {
		codec: string;
		sampleRate: number;
		channels: number;
	} | null;
}

// 安全解析 FFmpeg 帧率分数（如 "30/1" 或 "24000/1001"）
function parseFps(fpsString: string | undefined): number {
	if (!fpsString) return 0;
	const parts = fpsString.split('/');
	if (parts.length === 2) {
		const numerator = parseFloat(parts[0]);
		const denominator = parseFloat(parts[1]);
		return denominator !== 0 ? numerator / denominator : 0;
	}
	return parseFloat(fpsString) || 0;
}

// 检测视频流信息
async function getVideoStreamInfo(filePath: string): Promise<VideoStreamInfo> {
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

			resolve({
				filePath,
				hasVideo,
				hasAudio,
				duration: Math.max(
					parseFloat(metadata.format.duration as string) || 0,
					parseFloat(videoStream?.duration as string) || 0
				),
				videoStream: videoStream ? {
					width: videoStream.width || 0,
					height: videoStream.height || 0,
					codec: videoStream.codec_name || '',
					fps: parseFps(videoStream.r_frame_rate),
					aspectRatio: (videoStream.width || 1) / (videoStream.height || 1),
				} : null,
				audioStream: audioStream ? {
					codec: audioStream.codec_name || '',
					sampleRate: parseInt(audioStream.sample_rate as string) || 0,
					channels: audioStream.channels || 0,
				} : null,
			});
		});
	});
}

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

				// 检测所有视频的流信息
				const streamInfos: VideoStreamInfo[] = [];
				for (const videoFile of videoFiles) {
					const info = await getVideoStreamInfo(videoFile);
					streamInfos.push(info);
				}

				// 检查是否所有视频都有视频流
				const allHaveVideo = streamInfos.every((info) => info.hasVideo);
				if (!allHaveVideo) {
					throw new NodeOperationError(
						this.getNode(),
						'某些视频缺少视频流！',
						{ itemIndex: 0 },
					);
				}

				// 检查是否所有视频都有音频流
				const allHaveAudio = streamInfos.every((info) => info.hasAudio);

				// 智能计算目标参数
				const maxFps = Math.max(...streamInfos.map(info => info.videoStream?.fps || 0));
				const targetSampleRate = 44100; // 统一音频采样率

				// 计算最合适的目标帧率（优先使用原始帧率，避免不必要的转换）
				let targetFps = maxFps;
				if (targetFps > 60) targetFps = 60; // 限制最大帧率
				if (targetFps < 24) targetFps = 24; // 保证最小帧率

				// 智能计算目标分辨率：找出最常见的宽高比，使用最大分辨率
				const aspectRatios = streamInfos.map(info => info.videoStream?.aspectRatio || 16/9);
				const avgAspectRatio = aspectRatios.reduce((a, b) => a + b, 0) / aspectRatios.length;

				// 判断是横屏还是竖屏
				const isLandscape = avgAspectRatio >= 1;

				// 找出最大分辨率
				const maxWidth = Math.max(...streamInfos.map(info => info.videoStream?.width || 0));
				const maxHeight = Math.max(...streamInfos.map(info => info.videoStream?.height || 0));

				// 根据宽高比调整目标分辨率，避免极端拉伸
				let targetWidth, targetHeight;
				if (isLandscape) {
					targetWidth = maxWidth;
					targetHeight = Math.round(maxWidth / avgAspectRatio);
					// 确保高度不超过最大高度
					if (targetHeight > maxHeight) {
						targetHeight = maxHeight;
						targetWidth = Math.round(maxHeight * avgAspectRatio);
					}
				} else {
					targetHeight = maxHeight;
					targetWidth = Math.round(maxHeight * avgAspectRatio);
					// 确保宽度不超过最大宽度
					if (targetWidth > maxWidth) {
						targetWidth = maxWidth;
						targetHeight = Math.round(maxWidth / avgAspectRatio);
					}
				}

				// 确保尺寸是偶数（H.264 要求）
				targetWidth = Math.round(targetWidth / 2) * 2;
				targetHeight = Math.round(targetHeight / 2) * 2;

				// 构建 FFmpeg 命令
				const command = ffmpeg();

				// 添加所有视频文件作为输入
				videoFiles.forEach((file) => {
					command.input(file);
				});

				let filterComplex: string;
				const filterParts: string[] = [];

				if (allHaveAudio) {
					// 方案1: 所有视频都有音频，统一格式后 concat
					for (let i = 0; i < videoFiles.length; i++) {
						// 统一视频格式：scale + pad + setsar + fps + format
						filterParts.push(`[${i}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p[v${i}]`);

						// 统一音频格式：根据原始声道数智能转换
						const channels = streamInfos[i].audioStream?.channels || 2;
						if (channels === 1) {
							// 单声道转立体声：复制到两个声道
							filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[a${i}]`);
						} else {
							// 双声道或多声道：统一到立体声
							filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo[a${i}]`);
						}
					}

					// Concatenate all streams (添加 unsafe=1 提高兼容性)
					const concatInputs = videoFiles.map((_, i) => `[v${i}][a${i}]`).join('');
					filterParts.push(`${concatInputs}concat=n=${videoFiles.length}:v=1:a=1:unsafe=1[outv][outa]`);

					filterComplex = filterParts.join(';');
				} else {
					// 方案2: 某些视频缺少音频，为缺失的添加静音
					for (let i = 0; i < videoFiles.length; i++) {
						// 统一视频格式
						filterParts.push(`[${i}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p[v${i}]`);

						if (streamInfos[i].hasAudio) {
							// 有音频，统一格式（智能声道转换）
							const channels = streamInfos[i].audioStream?.channels || 2;
							if (channels === 1) {
								filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[a${i}]`);
							} else {
								filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo[a${i}]`);
							}
						} else {
							// 无音频，生成静音（指定时长）
							const duration = streamInfos[i].duration || 1;
							filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=${targetSampleRate}:duration=${duration}[a${i}]`);
						}
					}

					// Concatenate all streams (添加 unsafe=1 提高兼容性)
					const concatInputs = videoFiles.map((_, i) => `[v${i}][a${i}]`).join('');
					filterParts.push(`${concatInputs}concat=n=${videoFiles.length}:v=1:a=1:unsafe=1[outv][outa]`);

					filterComplex = filterParts.join(';');
				}

				// Concatenate video files using fluent-ffmpeg with filter_complex
				await new Promise<void>((resolve, reject) => {
					command
						.complexFilter(filterComplex)
						.outputOptions(['-map', '[outv]', '-map', '[outa]'])
						.videoCodec('libx264')
						.audioCodec('aac')
						.outputOptions([
							'-preset', 'medium',
							'-crf', '23',
							'-pix_fmt', 'yuv420p',        // 确保像素格式兼容性
							'-movflags', '+faststart',     // 优化网络播放
							'-b:a', '192k',                // AAC 音频码率
							'-profile:v', 'high',          // H.264 profile
							'-level', '4.0'                // H.264 level
						])
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
						targetResolution: `${targetWidth}x${targetHeight}`,
						targetFps: targetFps.toFixed(2),
						targetSampleRate,
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

					// 检测所有视频的流信息
					const streamInfos: VideoStreamInfo[] = [];
					for (const videoFile of videoFiles) {
						const info = await getVideoStreamInfo(videoFile);
						streamInfos.push(info);
					}

					// 检查是否所有视频都有视频流
					const allHaveVideo = streamInfos.every((info) => info.hasVideo);
					if (!allHaveVideo) {
						throw new NodeOperationError(
							this.getNode(),
							'某些视频缺少视频流！',
							{ itemIndex },
						);
					}

					// 检查是否所有视频都有音频流
					const allHaveAudio = streamInfos.every((info) => info.hasAudio);

					// 智能计算目标参数
					const maxFps = Math.max(...streamInfos.map(info => info.videoStream?.fps || 0));
					const targetSampleRate = 44100;

					let targetFps = maxFps;
					if (targetFps > 60) targetFps = 60;
					if (targetFps < 24) targetFps = 24;

					const aspectRatios = streamInfos.map(info => info.videoStream?.aspectRatio || 16/9);
					const avgAspectRatio = aspectRatios.reduce((a, b) => a + b, 0) / aspectRatios.length;

					const isLandscape = avgAspectRatio >= 1;

					const maxWidth = Math.max(...streamInfos.map(info => info.videoStream?.width || 0));
					const maxHeight = Math.max(...streamInfos.map(info => info.videoStream?.height || 0));

					let targetWidth, targetHeight;
					if (isLandscape) {
						targetWidth = maxWidth;
						targetHeight = Math.round(maxWidth / avgAspectRatio);
						if (targetHeight > maxHeight) {
							targetHeight = maxHeight;
							targetWidth = Math.round(maxHeight * avgAspectRatio);
						}
					} else {
						targetHeight = maxHeight;
						targetWidth = Math.round(maxHeight * avgAspectRatio);
						if (targetWidth > maxWidth) {
							targetWidth = maxWidth;
							targetHeight = Math.round(maxWidth / avgAspectRatio);
						}
					}

					targetWidth = Math.round(targetWidth / 2) * 2;
					targetHeight = Math.round(targetHeight / 2) * 2;

					const command = ffmpeg();

					videoFiles.forEach((file) => {
						command.input(file);
					});

					let filterComplex: string;
					const filterParts: string[] = [];

					if (allHaveAudio) {
						for (let i = 0; i < videoFiles.length; i++) {
							filterParts.push(`[${i}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p[v${i}]`);

							const channels = streamInfos[i].audioStream?.channels || 2;
							if (channels === 1) {
								filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[a${i}]`);
							} else {
								filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo[a${i}]`);
							}
						}

						const concatInputs = videoFiles.map((_, i) => `[v${i}][a${i}]`).join('');
						filterParts.push(`${concatInputs}concat=n=${videoFiles.length}:v=1:a=1:unsafe=1[outv][outa]`);

						filterComplex = filterParts.join(';');
					} else {
						for (let i = 0; i < videoFiles.length; i++) {
							filterParts.push(`[${i}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${targetFps},format=yuv420p[v${i}]`);

							if (streamInfos[i].hasAudio) {
								const channels = streamInfos[i].audioStream?.channels || 2;
								if (channels === 1) {
									filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[a${i}]`);
								} else {
									filterParts.push(`[${i}:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo[a${i}]`);
								}
							} else {
								const duration = streamInfos[i].duration || 1;
								filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=${targetSampleRate}:duration=${duration}[a${i}]`);
							}
						}

						const concatInputs = videoFiles.map((_, i) => `[v${i}][a${i}]`).join('');
						filterParts.push(`${concatInputs}concat=n=${videoFiles.length}:v=1:a=1:unsafe=1[outv][outa]`);

						filterComplex = filterParts.join(';');
					}

					// Concatenate video files using fluent-ffmpeg with filter_complex
					await new Promise<void>((resolve, reject) => {
						command
							.complexFilter(filterComplex)
							.outputOptions(['-map', '[outv]', '-map', '[outa]'])
							.videoCodec('libx264')
							.audioCodec('aac')
							.outputOptions([
								'-preset', 'medium',
								'-crf', '23',
								'-pix_fmt', 'yuv420p',
								'-movflags', '+faststart',
								'-b:a', '192k',
								'-profile:v', 'high',
								'-level', '4.0'
							])
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
							targetResolution: `${targetWidth}x${targetHeight}`,
							targetFps: targetFps.toFixed(2),
							targetSampleRate,
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
