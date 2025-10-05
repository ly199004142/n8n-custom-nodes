const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

/**
 * 转义字幕文件路径，用于 FFmpeg subtitles 滤镜
 * FFmpeg 滤镜路径需要特殊转义: \, :, ' 等字符
 * @param {string} filePath - 字幕文件路径
 * @returns {string} 转义后的路径
 */
function escapeSubtitlePath(filePath) {
	return filePath
		.replace(/\\/g, '\\\\\\\\')  // 反斜杠: \ -> \\\\
		.replace(/:/g, '\\:')        // 冒号: : -> \:
		.replace(/'/g, "\\'");       // 单引号: ' -> \'
}

/**
 * 检测字幕文件格式
 * @param {string} filePath - 字幕文件路径
 * @returns {string} 字幕格式 (.srt, .ass, .ssa, .vtt)
 * @throws {Error} 如果格式不支持
 */
function getSubtitleFormat(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	const supportedFormats = ['.srt', '.ass', '.ssa', '.vtt'];

	if (!supportedFormats.includes(ext)) {
		throw new Error(`不支持的字幕格式: ${ext}，仅支持 ${supportedFormats.join(', ')}`);
	}

	return ext;
}

/**
 * 获取媒体文件的流信息(支持视频和音频)
 * @param {string} filePath - 媒体文件路径
 * @param {string} type - 媒体类型: 'video' 或 'audio'
 * @returns {Promise<Object>} 媒体流信息对象
 */
async function getMediaStreamInfo(filePath, type = 'video') {
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

			// 计算准确的时长
			const duration = Math.max(
				parseFloat(metadata.format.duration) || 0,
				parseFloat(videoStream?.duration) || 0,
				parseFloat(audioStream?.duration) || 0
			);

			resolve({
				filePath,
				type,
				hasVideo,
				hasAudio,
				duration,
				videoStream: videoStream ? {
					width: videoStream.width,
					height: videoStream.height,
					codec: videoStream.codec_name,
				} : null,
				audioStream: audioStream ? {
					codec: audioStream.codec_name,
					sampleRate: audioStream.sample_rate || 44100,
					channels: audioStream.channels || 2,
					channelLayout: audioStream.channel_layout || 'stereo',
				} : null,
			});
		});
	});
}

/**
 * 视频与音频合成（支持字幕烧录）
 * @param {Object} config - 配置对象
 * @param {string} config.videoPath - 视频文件路径
 * @param {Array<Object>} config.audioFiles - 音频文件数组,每个元素包含 {path, startTime}
 * @param {string} [config.subtitlePath] - 字幕文件路径（可选）
 * @param {boolean} config.muteOriginalAudio - 是否静音原视频音频,默认 false
 * @param {string} config.outputPath - 输出文件路径
 * @returns {Promise<void>}
 */
async function mergeVideoWithAudios(config) {
	const {
		videoPath,
		audioFiles = [],
		subtitlePath = null,
		muteOriginalAudio = false,
		outputPath,
	} = config;

	console.log('========== 视频音频合成任务开始 ==========\n');

	// ========== 1. 验证文件存在性 ==========
	console.log('步骤 1: 验证文件...');

	if (!fs.existsSync(videoPath)) {
		throw new Error(`视频文件不存在: ${videoPath}`);
	}
	console.log(`✓ 找到视频文件: ${videoPath}`);

	for (const audioFile of audioFiles) {
		if (!fs.existsSync(audioFile.path)) {
			throw new Error(`音频文件不存在: ${audioFile.path}`);
		}
		console.log(`✓ 找到音频文件: ${audioFile.path}`);
	}

	// 验证字幕文件
	let subtitleFormat = null;
	if (subtitlePath) {
		if (!fs.existsSync(subtitlePath)) {
			throw new Error(`字幕文件不存在: ${subtitlePath}`);
		}
		subtitleFormat = getSubtitleFormat(subtitlePath);
		console.log(`✓ 找到字幕文件: ${subtitlePath} (格式: ${subtitleFormat})`);
		console.log(`  ⚠️  注意: 启用字幕烧录后，视频将重新编码，处理时间会显著增加`);
	}

	console.log('');

	// ========== 2. 检测视频和音频的元数据 ==========
	console.log('步骤 2: 检测媒体流信息...\n');

	// 获取视频信息
	const videoInfo = await getMediaStreamInfo(videoPath, 'video');
	console.log(`视频文件: ${videoPath}`);
	console.log(`  - 时长: ${videoInfo.duration.toFixed(2)}s`);
	console.log(`  - 有视频流: ${videoInfo.hasVideo ? '✓' : '✗'}`);
	console.log(`  - 有音频流: ${videoInfo.hasAudio ? '✓' : '✗'}`);
	if (videoInfo.videoStream) {
		console.log(`  - 视频: ${videoInfo.videoStream.width}x${videoInfo.videoStream.height} ${videoInfo.videoStream.codec}`);
	}
	if (videoInfo.hasAudio) {
		console.log(`  - 原音频: ${videoInfo.audioStream.codec} ${videoInfo.audioStream.sampleRate}Hz ${videoInfo.audioStream.channels}ch`);
	}
	console.log('');

	if (!videoInfo.hasVideo) {
		throw new Error('输入文件缺少视频流!');
	}

	// 获取所有音频信息
	const audioInfos = [];
	for (let i = 0; i < audioFiles.length; i++) {
		const audioFile = audioFiles[i];
		const audioInfo = await getMediaStreamInfo(audioFile.path, 'audio');
		audioInfos.push({
			...audioInfo,
			startTime: audioFile.startTime || 0,
		});

		console.log(`音频文件 ${i + 1}: ${audioFile.path}`);
		console.log(`  - 时长: ${audioInfo.duration.toFixed(2)}s`);
		console.log(`  - 开始位置: ${audioFile.startTime || 0}s`);
		if (audioInfo.hasAudio) {
			console.log(`  - 音频: ${audioInfo.audioStream.codec} ${audioInfo.audioStream.sampleRate}Hz ${audioInfo.audioStream.channels}ch`);
		} else {
			console.log(`  - 警告: 该文件没有音频流!`);
		}
		console.log('');
	}

	// ========== 3. 构建 FFmpeg Filter Complex ==========
	console.log('步骤 3: 构建 FFmpeg 滤镜链...\n');

	const targetSampleRate = 44100; // 统一采样率
	const videoDuration = videoInfo.duration;

	const command = ffmpeg();
	const filterParts = [];
	const audioFilterParts = []; // 音频滤镜部分
	const audioInputLabels = []; // 存储所有需要混音的音频流标签

	// 添加视频输入(索引 0)
	command.input(videoPath);

	// ========== 3.1 构建视频滤镜（字幕烧录） ==========
	let videoOutputLabel = '0:v'; // 默认直接使用原视频流

	if (subtitlePath) {
		// 有字幕: 使用 subtitles 滤镜烧录字幕
		const escapedSubPath = escapeSubtitlePath(subtitlePath);
		const videoFilter = `[0:v]subtitles='${escapedSubPath}'[outv]`;
		filterParts.push(videoFilter);
		videoOutputLabel = '[outv]';
		console.log('✓ 已添加字幕烧录滤镜');
	} else {
		console.log('无字幕文件，视频流将直接复制（无重新编码）');
	}
	console.log('');

	// ========== 3.2 构建音频滤镜 ==========

	// 处理原视频音频
	if (!muteOriginalAudio && videoInfo.hasAudio) {
		// 不静音模式: 将原视频音频也加入混音
		const channels = videoInfo.audioStream.channels;
		if (channels === 1) {
			// 单声道转立体声
			audioFilterParts.push(`[0:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[orig_audio]`);
		} else {
			// 双声道或多声道统一为立体声
			audioFilterParts.push(`[0:a]aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo[orig_audio]`);
		}
		audioInputLabels.push('[orig_audio]');
		console.log('保留原视频音频并加入混音');
	} else if (muteOriginalAudio) {
		console.log('已配置静音原视频音频');
	} else if (!videoInfo.hasAudio) {
		console.log('视频本身无音频流');
	}

	// 处理每个要叠加的音频文件
	let actualInputIndex = 1; // 跟踪实际添加的输入索引(0是视频,从1开始是音频)

	for (let i = 0; i < audioInfos.length; i++) {
		const audioInfo = audioInfos[i];

		if (!audioInfo.hasAudio) {
			console.log(`音频 ${i + 1}: 跳过(无音频流)`);
			continue;
		}

		const startTime = audioInfo.startTime;
		const audioDuration = audioInfo.duration;

		// 计算该音频的有效时长(不能超出视频)
		const maxDuration = videoDuration - startTime;
		const effectiveDuration = Math.min(audioDuration, maxDuration);

		if (effectiveDuration <= 0) {
			console.log(`音频 ${i + 1}: 跳过(起始时间 ${startTime}s 超出视频时长 ${videoDuration.toFixed(2)}s)`);
			continue;
		}

		// 添加音频输入
		command.input(audioInfo.filePath);
		const inputIndex = actualInputIndex++; // 使用实际的输入索引并递增

		console.log(`音频 ${i + 1}: 起始=${startTime}s, 原时长=${audioDuration.toFixed(2)}s, 有效时长=${effectiveDuration.toFixed(2)}s`);

		// 构建该音频的滤镜链
		let audioFilter = `[${inputIndex}:a]`;
		const channels = audioInfo.audioStream.channels;

		// 步骤 1: 统一格式(采样率 + 声道布局)
		if (channels === 1) {
			// 单声道转立体声
			audioFilter += `aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=mono,pan=stereo|c0=c0|c1=c0,`;
		} else {
			// 双声道或多声道统一为立体声
			audioFilter += `aresample=${targetSampleRate},aformat=sample_rates=${targetSampleRate}:channel_layouts=stereo,`;
		}

		// 步骤 2: 截断超出视频长度的部分
		audioFilter += `atrim=0:${effectiveDuration},`;

		// 步骤 3: 设置 PTS(确保时间戳正确)
		audioFilter += `asetpts=PTS-STARTPTS,`;

		// 步骤 4: 添加延迟(如果 startTime > 0)
		if (startTime > 0) {
			// adelay 单位是毫秒,并且需要为每个声道分别设置
			// 格式: adelay=delays=左声道延迟|右声道延迟:all=1
			const delayMs = Math.round(startTime * 1000);
			audioFilter += `adelay=${delayMs}|${delayMs}:all=1,`;
		}

		// 步骤 5: 填充静音至视频时长(使用 pad_dur 参数更稳定)
		const padDuration = videoDuration - effectiveDuration - startTime;
		if (padDuration > 0) {
			audioFilter += `apad=pad_dur=${padDuration.toFixed(3)}`;
		} else {
			// 不需要填充,去掉末尾逗号
			audioFilter = audioFilter.slice(0, -1);
		}

		audioFilter += `[a${i}]`;
		audioFilterParts.push(audioFilter);
		audioInputLabels.push(`[a${i}]`);
	}

	// ========== 3.3 混音处理 ==========
	if (audioInputLabels.length === 0) {
		// 没有任何音频,生成静音
		console.log('\n没有音频输入,生成静音轨道');
		audioFilterParts.push(`anullsrc=channel_layout=stereo:sample_rate=${targetSampleRate}:duration=${videoDuration}[outa]`);
	} else if (audioInputLabels.length === 1) {
		// 只有一个音频流,直接使用(使用 anull 滤镜作为空操作,或直接重命名标签)
		console.log(`\n使用单个音频流: ${audioInputLabels[0]}`);
		audioFilterParts.push(`${audioInputLabels[0]}anull[outa]`);
	} else {
		// 多个音频流,使用 amix 混音
		console.log(`\n混合 ${audioInputLabels.length} 个音频流`);
		const mixInputs = audioInputLabels.join('');
		// amix 参数:
		// - inputs: 输入流数量
		// - duration: longest 表示以最长的流为准(已通过 apad 统一为视频时长)
		// - dropout_transition: 当某个输入结束时的过渡时间(秒)
		audioFilterParts.push(`${mixInputs}amix=inputs=${audioInputLabels.length}:duration=longest:dropout_transition=0[outa]`);
	}

	// ========== 3.4 合并视频和音频滤镜 ==========
	// 将音频滤镜添加到总滤镜链
	filterParts.push(...audioFilterParts);

	const filterComplex = filterParts.join(';');
	console.log('\nFilter Complex:');
	console.log(filterComplex);
	console.log('');

	// ========== 4. 执行 FFmpeg 命令 ==========
	console.log('步骤 4: 开始合成...\n');

	return new Promise((resolve, reject) => {
		// 构建输出选项
		const outputOptions = [
			'-map', videoOutputLabel,          // 映射视频流（可能是 0:v 或 [outv]）
			'-map', '[outa]',                  // 映射处理后的音频流
		];

		// 根据是否有字幕决定视频编码方式
		if (subtitlePath) {
			// 有字幕: 必须重新编码视频
			console.log('视频编码方式: libx264（重新编码，以烧录字幕）');
			outputOptions.push(
				'-c:v', 'libx264',             // H.264 视频编码
				'-preset', 'medium',           // 编码速度（ultrafast/superfast/veryfast/faster/fast/medium/slow/slower/veryslow）
				'-crf', '23',                  // 视频质量（18-28，越小质量越好，文件越大）
				'-pix_fmt', 'yuv420p',         // 像素格式（兼容性最好）
			);
		} else {
			// 无字幕: 直接复制视频流
			console.log('视频编码方式: copy（直接复制，无重新编码）');
			outputOptions.push('-c:v', 'copy');
		}

		// 音频编码参数
		outputOptions.push(
			'-c:a', 'aac',                     // 音频编码为 AAC
			'-b:a', '192k',                    // AAC 音频码率
			'-ar', String(targetSampleRate),   // 音频采样率
			'-ac', '2',                        // 立体声
			'-movflags', '+faststart',         // 优化网络播放
		);

		console.log('');

		command
			.complexFilter(filterComplex)
			.outputOptions(outputOptions)
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
					stderrLine.includes('warning')
				) {
					console.log('FFmpeg:', stderrLine);
				}
			})
			.on('end', () => {
				console.log('\n✓ 视频音频合成成功!');
				console.log(`输出文件: ${outputPath}`);

				// 显示输出文件信息
				if (fs.existsSync(outputPath)) {
					const stats = fs.statSync(outputPath);
					console.log(`文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
				}
				console.log('\n========== 任务完成 ==========');
				resolve();
			})
			.on('error', (err) => {
				console.error('\n========== 错误信息 ==========');
				console.error('错误:', err.message);
				console.error('==============================\n');
				reject(err);
			})
			.run();
	});
}

// ========== 测试用例 ==========
async function main() {
	// 配置: 在这里设置你的视频、音频、字幕文件路径
	const config = {
		// 视频文件路径
		videoPath: '/Users/liuyang/Downloads/test_media/example_bgvideo.mp4',

		// 音频文件数组(可以多个)
		audioFiles: [
			{
				path: '/Users/liuyang/Downloads/test_media/audio1.mp3',
				startTime: 0,  // 从视频开始处叠加
			},
			{
				path: '/Users/liuyang/Downloads/test_media/audio2.mp3',
				startTime: 68,  // 从视频第 68 秒处开始叠加
			},
		],

		// 字幕文件路径（可选）
		// 支持格式: .srt, .ass, .ssa, .vtt
		// 注意: 启用字幕后，视频将重新编码，处理时间会显著增加（从几秒变为几分钟）
		subtitlePath: null,  // 示例: '/Users/liuyang/Downloads/test_media/subtitle.srt'

		// 是否静音原视频音频
		// true: 只听到叠加的音频
		// false: 原视频音频和叠加音频混合播放
		muteOriginalAudio: true,

		// 输出文件路径
		outputPath: '/Users/liuyang/Downloads/test_media/mtest.mp4',
	};

	try {
		await mergeVideoWithAudios(config);
	} catch (err) {
		console.error('发生错误:', err);
		process.exit(1);
	}
}

// 运行测试
main();
