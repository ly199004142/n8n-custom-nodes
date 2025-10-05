const ffmpeg = require('fluent-ffmpeg');

// Video and audio file paths
const videoPath = '/Users/liuyang/Downloads/example_bgvideo.mp4';
const audioPath = '/Users/liuyang/Downloads/merged-audio-1758790343807.mp3';
const outputPath = '/Users/liuyang/Downloads/output-merged.mp4';

// Merge video and audio using fluent-ffmpeg
ffmpeg()
  .input(videoPath)
  .input(audioPath)
  .videoCodec('copy')  // Preserve original video codec
  .audioCodec('aac')   // Use aac audio codec
  .outputOptions([
    '-map 0:v:0',      // Map video from first input
    '-map 1:a:0',      // Map audio from second input
    '-shortest'        // Finish encoding when shortest input ends
  ])
  .output(outputPath)
  .on('start', (commandLine) => {
    console.log('Starting merge, command: ' + commandLine);
  })
  .on('progress', (progress) => {
    console.log('Processing: ' + progress.percent + '% done');
  })
  .on('end', () => {
    console.log('Merge completed! Output file: ' + outputPath);
  })
  .on('error', (err) => {
    console.error('Merge failed: ' + err.message);
  })
  .run();
