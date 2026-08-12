const cloudinary = require('../config/cloudinary'); // reuse the config from the profile-photo feature

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// POST /api/uploads/lesson-video  (multipart field name: "video")
async function uploadLessonVideo(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No video file received' } });
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: 'lesson_videos',
      resource_type: 'video',
    });

    return res.status(200).json({
      url: result.secure_url,
      publicId: result.public_id,
      durationSeconds: result.duration,
    });
  } catch (error) {
    console.error('Upload lesson video error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while uploading the video' } });
  }
}

// POST /api/uploads/lesson-note  (multipart field name: "note")
async function uploadLessonNote(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No PDF file received' } });
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: 'lesson_notes',
      resource_type: 'raw', // PDFs are stored as raw assets, not images
      format: 'pdf',
    });

    return res.status(200).json({ url: result.secure_url, publicId: result.public_id });
  } catch (error) {
    console.error('Upload lesson note error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while uploading the PDF' } });
  }
}

module.exports = { uploadLessonVideo, uploadLessonNote };