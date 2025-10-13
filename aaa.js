// Get SRT subtitle text from previous node
const subtitle_text = $json.subtitle_text || "";

// Generate dynamic filename with timestamp and random number
const now = new Date();
const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}-${String(now.getMilliseconds()).padStart(3, '0')}`;
const random = Math.floor(Math.random() * 1000);
const fileName = `subtitle_${timestamp}_${random}.srt`;

// Create binary data from UTF-8 text
const buffer = Buffer.from(subtitle_text, 'utf-8');

return {
  json: {
    fileName: fileName
  },
  binary: {
    data: {
      data: buffer.toString('base64'),
      mimeType: 'application/x-subrip',
      fileName: fileName
    }
  }
};
