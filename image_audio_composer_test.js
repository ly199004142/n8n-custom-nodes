const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// Read input data from JSON file
function loadInputData(jsonFilePath) {
  try {
    const rawData = fs.readFileSync(jsonFilePath, 'utf8');
    const data = JSON.parse(rawData);

    // Transform data format: wrap in data object if not already wrapped
    if (data.scence_list && data.audio_list) {
      return { data: data };
    }
    return data;
  } catch (error) {
    console.error('Failed to load input data:', error.message);
    throw error;
  }
}

// Default input JSON file path
const inputJsonPath = path.join(__dirname, 'input_data.json');

/**
 * Get audio file duration in seconds
 */
async function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const duration = metadata.format.duration || 0;
      resolve(duration);
    });
  });
}

/**
 * Escape subtitle file path for FFmpeg subtitles filter
 */
function escapeSubtitlePath(filePath) {
  return filePath
    .replace(/\\/g, '\\\\\\\\')  // Backslash: \ -> \\\\
    .replace(/:/g, '\\:')        // Colon: : -> \:
    .replace(/'/g, "\\'");       // Single quote: ' -> \'
}

/**
 * Compose images and audio into video
 */
async function composeImageAudioToVideo(sceneList, audioList, subtitlePath, outputPath) {
  try {
    // 1. Validate all files exist
    console.log('Validating file existence...');
    for (const scene of sceneList) {
      if (!fs.existsSync(scene.image_filepath)) {
        throw new Error(`Image file not found: ${scene.image_filepath}`);
      }
    }
    for (const audio of audioList) {
      if (!fs.existsSync(audio.audio_filePath)) {
        throw new Error(`Audio file not found: ${audio.audio_filePath}`);
      }
    }

    // Validate subtitle file if provided
    if (subtitlePath && subtitlePath.trim().length > 0) {
      if (!fs.existsSync(subtitlePath)) {
        throw new Error(`Subtitle file not found: ${subtitlePath}`);
      }
      console.log(`Subtitle file: ${subtitlePath}`);
    }

    console.log('All files validated');

    // 2. Calculate total duration (milliseconds to seconds)
    const totalDuration = sceneList.reduce((sum, scene) => sum + scene.scene_duration, 0) / 1000;
    console.log(`Total video duration: ${totalDuration.toFixed(2)} seconds`);

    // 3. Get all audio duration info
    console.log('Getting audio duration info...');
    const audioInfos = [];
    for (const audio of audioList) {
      const duration = await getAudioDuration(audio.audio_filePath);
      audioInfos.push({
        ...audio,
        duration: duration
      });
      console.log(`Audio: ${path.basename(audio.audio_filePath)}, Duration: ${duration.toFixed(2)}s, Start: ${(audio.audio_starttime / 1000).toFixed(2)}s`);
    }

    // 4. Build FFmpeg command
    const command = ffmpeg();
    const filterParts = [];
    const targetSampleRate = 44100;

    // 4.1 Add all image inputs
    for (let i = 0; i < sceneList.length; i++) {
      command.input(sceneList[i].image_filepath);
    }

    // 4.2 Add all audio inputs
    const audioStartIndex = sceneList.length;
    for (let i = 0; i < audioList.length; i++) {
      command.input(audioList[i].audio_filePath);
    }

    // 4.3 Build video filters - set duration for each image and scale
    const videoLabels = [];
    for (let i = 0; i < sceneList.length; i++) {
      const duration = sceneList[i].scene_duration / 1000;
      // Set image duration, scale to uniform size (1920x1080), set fps to 25
      // Use loop filter to repeat the image frame for the specified duration
      const filter = `[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,loop=loop=-1:size=1:start=0,trim=duration=${duration},setpts=PTS-STARTPTS[v${i}]`;
      filterParts.push(filter);
      videoLabels.push(`[v${i}]`);
    }

    // 4.4 Concat all image videos
    const concatFilter = `${videoLabels.join('')}concat=n=${sceneList.length}:v=1:a=0[video_concat]`;
    filterParts.push(concatFilter);

    // 4.4.1 Add subtitle burning if subtitle file is provided
    let videoOutputLabel = '[video_concat]';
    if (subtitlePath && subtitlePath.trim().length > 0) {
      const escapedSubPath = escapeSubtitlePath(subtitlePath);
      const subtitleFilter = `[video_concat]subtitles='${escapedSubPath}'[outv]`;
      filterParts.push(subtitleFilter);
      videoOutputLabel = '[outv]';
    } else {
      // No subtitle, just rename the label
      filterParts.push('[video_concat]copy[outv]');
      videoOutputLabel = '[outv]';
    }

    // 4.5 Build audio filters
    const audioLabels = [];
    for (let i = 0; i < audioInfos.length; i++) {
      const audioInfo = audioInfos[i];
      const startTime = audioInfo.audio_starttime / 1000;
      const duration = audioInfo.duration;
      const inputIndex = audioStartIndex + i;

      // Calculate effective duration (cannot exceed video total duration)
      const maxDuration = totalDuration - startTime;
      const effectiveDuration = Math.min(duration, maxDuration);

      if (effectiveDuration <= 0) {
        console.log(`Audio ${i} start time exceeds video duration, skipping`);
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

    // 4.6 Mix all audio
    if (audioLabels.length === 0) {
      // No audio, generate silence
      filterParts.push(`anullsrc=channel_layout=stereo:sample_rate=${targetSampleRate}:duration=${totalDuration}[outa]`);
    } else if (audioLabels.length === 1) {
      // Only one audio, use directly
      filterParts.push(`${audioLabels[0]}anull[outa]`);
    } else {
      // Multiple audio, mix them
      // Since audio tracks don't overlap (each has specific start time), we use amix without normalization
      // amix with normalize=0 still averages the inputs, reducing volume by 1/n
      // We compensate by boosting volume after mixing
      const mixInputs = audioLabels.join('');
      // Boost volume to compensate for amix averaging
      // Use dB-based volume adjustment for more precise control
      // Testing shows we need about +4dB to restore original volume
      filterParts.push(`${mixInputs}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0[mixed];[mixed]volume=4dB[outa]`);
    }

    // 4.7 Combine full filter_complex
    const filterComplex = filterParts.join(';');
    console.log('\nFFmpeg Filter Complex:');
    console.log(filterComplex);

    // 5. Execute FFmpeg command
    console.log('\nStarting video composition...');
    await new Promise((resolve, reject) => {
      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map', '[outv]',
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
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('\nFFmpeg command:');
          console.log(commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`Processing: ${progress.percent.toFixed(1)}%`);
          }
        })
        .on('stderr', (stderrLine) => {
          // Only show important info
          if (stderrLine.includes('frame=') || stderrLine.includes('error') || stderrLine.includes('Error')) {
            console.log('FFmpeg:', stderrLine);
          }
        })
        .on('end', () => {
          console.log('\nVideo composition completed!');
          console.log(`Output file: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          console.error('\nFFmpeg error:', err.message);
          reject(err);
        })
        .run();
    });

    return {
      success: true,
      outputPath: outputPath,
      totalDuration: totalDuration,
      sceneCount: sceneList.length,
      audioCount: audioList.length,
      hasSubtitle: !!(subtitlePath && subtitlePath.trim().length > 0)
    };

  } catch (error) {
    console.error('Composition failed:', error.message);
    throw error;
  }
}

// Main function
async function main() {
  // Load input data from JSON file
  console.log('=== Loading Input Data ===');
  console.log(`Reading from: ${inputJsonPath}\n`);

  const inputData = loadInputData(inputJsonPath);
  const sceneList = inputData.data.scence_list;
  const audioList = inputData.data.audio_list;
  const subtitlePath = inputData.data.subtitle_filename || '';
  const outputPath = '/Users/liuyang/Downloads/my-test/output.mp4';

  console.log('=== Image + Audio to Video Composition ===');
  console.log(`Scene count: ${sceneList.length}`);
  console.log(`Audio count: ${audioList.length}`);
  console.log(`Subtitle: ${subtitlePath || 'None'}`);
  console.log(`Output path: ${outputPath}\n`);

  try {
    const result = await composeImageAudioToVideo(sceneList, audioList, subtitlePath, outputPath);
    console.log('\n=== Composition Result ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('\nExecution failed:', error);
    process.exit(1);
  }
}

// Execute
main();
