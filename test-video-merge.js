const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');

// 安全解析 FFmpeg 帧率分数（如 "30/1" 或 "24000/1001"）
function parseFps(fpsString) {
	if (!fpsString) return 0;
	const parts = fpsString.split('/');
	if (parts.length === 2) {
		const numerator = parseFloat(parts[0]);
		const denominator = parseFloat(parts[1]);
		return denominator !== 0 ? numerator / denominator : 0;
	}
	return parseFloat(fpsString) || 0;
}

// 配置：在这里设置你的视频文件路径和输出路径
const videoFiles = [
	'/Users/liuyang/Downloads/example_bgvideo.mp4',
	'/Users/liuyang/Downloads/617.mp4',
];

const outputPath = '/Users/liuyang/Downloads/testabc.mp4';

// 验证文件存在
console.log('验证视频文件...');
for (const videoFile of videoFiles) {
	if (!fs.existsSync(videoFile)) {
		console.error(`错误: 视频文件不存在: ${videoFile}`);
		process.exit(1);
	}
	console.log(`✓ 找到文件: ${videoFile}`);
}

// 检测每个视频的流信息
async function getVideoStreamInfo(filePath) {
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
					parseFloat(metadata.format.duration) || 0,
					parseFloat(videoStream?.duration) || 0
				),
				videoStream: videoStream ? {
					width: videoStream.width,
					height: videoStream.height,
					codec: videoStream.codec_name,
					fps: parseFps(videoStream.r_frame_rate),
					aspectRatio: videoStream.width / videoStream.height,
				} : null,
				audioStream: audioStream ? {
					codec: audioStream.codec_name,
					sampleRate: audioStream.sample_rate,
					channels: audioStream.channels,
				} : null,
				streams: metadata.streams.map((s) => ({
					type: s.codec_type,
					codec: s.codec_name,
					duration: s.duration,
				})),
			});
		});
	});
}

// 主函数
async function main() {
	console.log('\n检测视频流信息...\n');

	// 检测所有视频的流信息
	const streamInfos = [];
	for (let i = 0; i < videoFiles.length; i++) {
		const info = await getVideoStreamInfo(videoFiles[i]);
		streamInfos.push(info);

		console.log(`视频 ${i}: ${info.filePath}`);
		console.log(`  - 有视频流: ${info.hasVideo ? '✓' : '✗'}`);
		console.log(`  - 有音频流: ${info.hasAudio ? '✓' : '✗'}`);
		console.log(`  - 时长: ${info.duration ? info.duration.toFixed(2) + 's' : '未知'}`);
		if (info.videoStream) {
			console.log(`  - 视频: ${info.videoStream.width}x${info.videoStream.height} ${info.videoStream.codec} ${info.videoStream.fps.toFixed(2)}fps`);
		}
		if (info.audioStream) {
			console.log(`  - 音频: ${info.audioStream.codec} ${info.audioStream.sampleRate}Hz ${info.audioStream.channels}ch`);
		}
		console.log('');
	}

	// 检查是否所有视频都有音视频流
	const allHaveAudio = streamInfos.every((info) => info.hasAudio);
	const allHaveVideo = streamInfos.every((info) => info.hasVideo);

	if (!allHaveVideo) {
		console.error('错误: 某些视频缺少视频流！');
		process.exit(1);
	}

	console.log('开始合并视频...\n');

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

	console.log(`目标视频参数: ${targetWidth}x${targetHeight} (${(targetWidth/targetHeight).toFixed(2)}:1) @ ${targetFps.toFixed(2)}fps`);
	console.log(`目标音频参数: ${targetSampleRate}Hz stereo\n`);

	const command = ffmpeg();

	// 添加所有视频文件作为输入
	videoFiles.forEach((file) => {
		command.input(file);
	});

	let filterComplex;
	const filterParts = [];

	if (allHaveAudio) {
		// 方案1: 所有视频都有音频，统一格式后 concat
		console.log('使用方案: 统一格式后连接（所有视频都有音频）');

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
		console.log('使用方案: 统一格式并为缺少音频的视频添加静音');

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

	console.log('Filter Complex:', filterComplex);
	console.log('');

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
		.on('start', (commandLine) => {
			console.log('========== FFmpeg 命令 ==========');
			console.log(commandLine);
			console.log('=================================\n');
		})
		.on('progress', (progress) => {
			if (progress.percent) {
				console.log(`处理中: ${progress.percent.toFixed(2)}% 完成`);
			}
		})
		.on('stderr', (stderrLine) => {
			// 只显示重要的 stderr 信息
			if (
				stderrLine.includes('error') ||
				stderrLine.includes('Error') ||
				stderrLine.includes('Invalid') ||
				stderrLine.includes('does not contain')
			) {
				console.log('FFmpeg stderr:', stderrLine);
			}
		})
		.on('end', () => {
			console.log('\n✓ 视频合并成功!');
			console.log(`输出文件: ${outputPath}`);

			// 显示输出文件信息
			if (fs.existsSync(outputPath)) {
				const stats = fs.statSync(outputPath);
				console.log(`文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
			}
		})
		.on('error', (err) => {
			console.error('\n========== 错误信息 ==========');
			console.error('错误:', err.message);
			console.error('==============================\n');
			process.exit(1);
		})
		.run();
}

main().catch((err) => {
	console.error('发生错误:', err);
	process.exit(1);
});
