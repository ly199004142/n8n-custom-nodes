# n8n-nodes-media-composition

This is an n8n community node. It lets you merge multiple audio files in your n8n workflows.

n8n-nodes-media-composition provides audio merging functionality to concatenate multiple audio files in sequence.

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

This node supports the following operation:

- **Audio Merge** - Concatenate multiple audio files in sequence into a single audio file

### Input Modes

The node supports two input modes:

1. **From Previous Node** - Get audio file paths from the previous node's output
2. **Manual Input** - Manually enter audio file paths (one per line)

### Parameters

- **Input Mode** - Select input mode (from previous node or manual input)
- **Audio File Path** - (From Previous Node mode) Audio file path field mapping
- **Audio File Paths** - (Manual Input mode) Audio file path list, one per line
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

### Example 1: Merge Audio from Previous Node

1. Use a File node or other node that outputs data containing audio file paths
2. Connect to the Audio Merge node
3. Select "From Previous Node" input mode
4. Drag the path field to the "Audio File Path" parameter (default is `{{ $json.path }}`)
5. Set the output file path
6. Execute the workflow

### Example 2: Merge with Manual Input

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

### Output Format

Upon successful execution, the node outputs:
```json
{
  "success": true,
  "outputPath": "/path/to/output.mp3",
  "audioFilesCount": 3,
  "audioFiles": [
    "/path/to/audio1.mp3",
    "/path/to/audio2.mp3",
    "/path/to/audio3.mp3"
  ]
}
```

### Important Notes

- All audio file paths must be absolute paths
- The output directory must exist and have write permissions
- Audio files will be concatenated in the specified order
- Output format is MP3 with 128k bitrate

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [FFmpeg official documentation](https://ffmpeg.org/documentation.html)
- [n8n workflow automation documentation](https://docs.n8n.io/)
