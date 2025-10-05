const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// Audio file paths
const audio1 = '/Users/liuyang/Downloads/merged-audio-1758790343807.mp3';
const audio2 = '/Users/liuyang/Downloads/merged-audio-1758783725830.mp3';
const audio3 = '/Users/liuyang/Downloads/merged-audio-1758783027711.mp3';
const outputPath = '/Users/liuyang/Downloads/concatenated-audio.mp3';

// Create a temporary file list for concat demuxer
const fileListPath = path.join(__dirname, 'concat-list.txt');
const fileListContent = `file '${audio1}'\nfile '${audio2}'\nfile '${audio3}'`;

fs.writeFileSync(fileListPath, fileListContent);

// Concatenate audio files using concat demuxer
ffmpeg()
  .input(fileListPath)
  .inputOptions(['-f', 'concat', '-safe', '0'])
  .audioCodec('copy')  // Copy audio codec without re-encoding
  .output(outputPath)
  .on('start', (commandLine) => {
    console.log('Starting concatenation, command: ' + commandLine);
  })
  .on('progress', (progress) => {
    console.log('Processing: ' + (progress.percent || 0) + '% done');
  })
  .on('end', () => {
    console.log('Concatenation completed! Output file: ' + outputPath);
    // Clean up temporary file
    fs.unlinkSync(fileListPath);
  })
  .on('error', (err) => {
    console.error('Concatenation failed: ' + err.message);
    // Clean up temporary file on error
    if (fs.existsSync(fileListPath)) {
      fs.unlinkSync(fileListPath);
    }
  })
  .run();
