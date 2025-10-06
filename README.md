# n8n-nodes-media-composition

This is an n8n community node package that provides comprehensive audio and video composition capabilities for your n8n workflows.

n8n-nodes-media-composition includes three powerful nodes for media processing: audio merging, video merging, and advanced video composition with multi-track audio and subtitle support.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Compatibility](#compatibility)
[Prerequisites](#prerequisites)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

This package provides three nodes:

### Audio Merge

Concatenate multiple audio files in sequence into a single audio file.

**Features:**
- Sequential audio file concatenation
- Support for two input modes (from previous node or manual input)
- MP3 output format with 128k bitrate

**Input Modes:**
1. **From Previous Node** - Get audio file paths from the previous node's output
2. **Manual Input** - Manually enter audio file paths (one per line)

**Parameters:**
- **Input Mode** - Select input mode (from previous node or manual input)
- **Audio File Path** - (From Previous Node mode) Audio file path field mapping
- **Audio File Paths** - (Manual Input mode) Audio file path list, one per line
- **Output File Path** - Absolute path for the output file

### Video Merge

Concatenate multiple video files in sequence with intelligent format normalization.

**Features:**
- Automatic resolution and frame rate alignment
- Smart aspect ratio detection (landscape/portrait)
- Intelligent audio channel conversion (mono to stereo)
- Silent audio track generation for videos without audio

**Input Modes:**
1. **From Previous Node** - Get video file paths from the previous node's output
2. **Manual Input** - Manually enter video file paths (one per line)

**Parameters:**
- **Input Mode** - Select input mode (from previous node or manual input)
- **Video File Path** - (From Previous Node mode) Video file path field mapping
- **Video File Paths** - (Manual Input mode) Video file path list, one per line
- **Output File Path** - Absolute path for the output file

### Video Composer

Compose videos with multiple audio tracks and optional subtitle burning.

**Features:**
- Overlay multiple audio tracks at specific timestamps
- Burn subtitles directly into video (.srt, .ass, .ssa, .vtt formats)
- Option to mute original video audio
- Precise audio timing and synchronization
- Support for both array input and manual configuration

**Audio Input Modes:**
1. **From Previous Node** - Get audio files array from previous node output (format: `[{"path": "/path/to/audio.mp3", "time": 0}]`)
2. **Manual Input** - Manually configure audio files with paths and start times

**Parameters:**
- **Video File Path** - Path to the input video file
- **Audio Input Mode** - Select how to provide audio files
- **Audio Files Array** - (From Previous Node mode) Audio files array with customizable field names
- **Path Field Name** - Field name for audio file path in the array
- **Time Field Name** - Field name for start time in the array
- **Audio Files** - (Manual Input mode) Configure multiple audio files with paths and start times
- **Subtitle File Path** - Optional subtitle file to burn into video
- **Mute Original Audio** - Whether to mute the original video audio
- **Output File Path** - Absolute path for the output file

## Compatibility

- Minimum n8n version: 0.190.0
- Tested with: 1.x
- Node.js version requirement: >= 20.15

## Prerequisites

**Important**: You must have FFmpeg installed on your system before using this node.

### Installing FFmpeg

#### macOS
```bash
brew install ffmpeg
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install ffmpeg
```

#### Windows
Download and install from [FFmpeg official website](https://ffmpeg.org/download.html), or use a package manager:
```bash
choco install ffmpeg
```

#### Verify Installation
```bash
ffmpeg -version
```

## Usage

### Audio Merge Examples

#### Example 1: Merge Audio from Previous Node

1. Use a File node or other node that outputs data containing audio file paths
2. Connect to the Audio Merge node
3. Select "From Previous Node" input mode
4. Drag the path field to the "Audio File Path" parameter (default is `{{ $json.path }}`)
5. Set the output file path
6. Execute the workflow

#### Example 2: Manual Audio Merge

1. Add an Audio Merge node
2. Select "Manual Input" input mode
3. Enter audio file paths in "Audio File Paths", one per line:
   ```
   /path/to/audio1.mp3
   /path/to/audio2.mp3
   /path/to/audio3.mp3
   ```
4. Set the output file path
5. Execute the workflow

**Output:**
```json
{
  "success": true,
  "outputPath": "/path/to/output.mp3",
  "audioFilesCount": 3,
  "audioFiles": ["/path/to/audio1.mp3", "/path/to/audio2.mp3", "/path/to/audio3.mp3"]
}
```

### Video Merge Examples

#### Example 1: Merge Videos from Previous Node

1. Use a File node or other node that outputs video file paths
2. Connect to the Video Merge node
3. Select "From Previous Node" input mode
4. Map the path field (default is `{{ $json.path }}`)
5. Set the output file path
6. Execute the workflow

**Output:**
```json
{
  "success": true,
  "outputPath": "/path/to/output.mp4",
  "videoFilesCount": 3,
  "videoFiles": ["/path/to/video1.mp4", "/path/to/video2.mp4", "/path/to/video3.mp4"],
  "targetResolution": "1920x1080",
  "targetFps": "30.00",
  "targetSampleRate": 44100
}
```

### Video Composer Examples

#### Example 1: Add Multiple Audio Tracks

1. Add a Video Composer node
2. Set the video file path
3. Select "Manual Input" for audio input mode
4. Add audio files with their start times:
   - Audio 1: `/path/to/narration.mp3`, Start Time: 0
   - Audio 2: `/path/to/background-music.mp3`, Start Time: 5
5. Set the output file path
6. Execute the workflow

#### Example 2: Add Subtitles and Mute Original Audio

1. Add a Video Composer node
2. Set the video file path
3. Set the subtitle file path (e.g., `/path/to/subtitles.srt`)
4. Check "Mute Original Audio"
5. Configure audio files as needed
6. Set the output file path
7. Execute the workflow

#### Example 3: Use Audio Array from Previous Node

1. Use a Code node or other node that outputs an audio files array:
   ```json
   {
     "audioFiles": [
       {"path": "/path/to/audio1.mp3", "time": 0},
       {"path": "/path/to/audio2.mp3", "time": 10}
     ]
   }
   ```
2. Connect to Video Composer node
3. Select "From Previous Node" audio input mode
4. Set Path Field Name to "path" and Time Field Name to "time"
5. Set video file path and output file path
6. Execute the workflow

**Output:**
```json
{
  "success": true,
  "outputPath": "/path/to/output.mp4",
  "videoPath": "/path/to/video.mp4",
  "audioFilesCount": 2,
  "hasSubtitle": true,
  "muteOriginalAudio": false,
  "videoDuration": 120.5
}
```

### Important Notes

- All file paths must be absolute paths
- The output directory must exist and have write permissions
- Files will be processed in the specified order
- FFmpeg must be installed and accessible in your system PATH
- Subtitle burning will re-encode the video (slower processing)
- Video Merge automatically normalizes different resolutions and frame rates
- Video Composer supports precise audio timing down to milliseconds

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [FFmpeg official documentation](https://ffmpeg.org/documentation.html)
- [n8n workflow automation documentation](https://docs.n8n.io/)
