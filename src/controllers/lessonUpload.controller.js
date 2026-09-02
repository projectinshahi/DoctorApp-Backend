
const cloudinary = require('../config/cloudinary');

function uploadBuffer(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      resolve(result);
    });
    stream.end(buffer);
  });
}

// Maps a mimetype to a clean file-type label + Cloudinary format hint
function resolveNoteFileType(mimetype) {
  switch (mimetype) {
    case 'application/pdf':
      return { fileType: 'pdf', format: 'pdf' };
    case 'application/msword':
      return { fileType: 'doc', format: 'doc' };
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return { fileType: 'docx', format: 'docx' };
    default:
      return { fileType: 'unknown', format: undefined };
  }
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
      return res.status(400).json({ error: { message: 'No note file received' } });
    }

    const { fileType, format } = resolveNoteFileType(req.file.mimetype);

    const result = await uploadBuffer(req.file.buffer, {
      folder: 'lesson_notes',
      resource_type: 'raw', // PDFs/Word docs are stored as raw assets, not images
      format,
    });

    return res.status(200).json({
      url: result.secure_url,
      publicId: result.public_id,
      fileType,
    });
  } catch (error) {
    console.error('Upload lesson note error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while uploading the note' } });
  }
}

// NEW: POST /api/uploads/lesson-thumbnail  (multipart field name: "thumbnail")
async function uploadLessonThumbnail(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No thumbnail file received' } });
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: 'lesson_thumbnails',
      resource_type: 'image',
    });

    return res.status(200).json({
      url: result.secure_url,
      publicId: result.public_id,
    });
  } catch (error) {
    console.error('Upload lesson thumbnail error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while uploading the thumbnail' } });
  }
}

// DELETE /api/uploads/lesson-video  (JSON body: { "publicId": "..." })
async function deleteLessonVideo(req, res) {
  try {
    const { publicId } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: { message: 'publicId is required' } });
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'video',
    });

    if (result.result !== 'ok' && result.result !== 'not found') {
      return res.status(500).json({
        error: { message: `Cloudinary failed to delete video: ${result.result}` },
      });
    }

    return res.status(200).json({ deleted: true, publicId });
  } catch (error) {
    console.error('Delete lesson video error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the video' } });
  }
}

// DELETE /api/uploads/lesson-note  (JSON body: { "publicId": "..." })
async function deleteLessonNote(req, res) {
  try {
    const { publicId } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: { message: 'publicId is required' } });
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw',
    });

    if (result.result !== 'ok' && result.result !== 'not found') {
      return res.status(500).json({
        error: { message: `Cloudinary failed to delete note: ${result.result}` },
      });
    }

    return res.status(200).json({ deleted: true, publicId });
  } catch (error) {
    console.error('Delete lesson note error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the note' } });
  }
}

// DELETE /api/uploads/lesson-thumbnail  (JSON body: { "publicId": "..." })
async function deleteLessonThumbnail(req, res) {
  try {
    const { publicId } = req.body;

    if (!publicId) {
      return res.status(400).json({ error: { message: 'publicId is required' } });
    }

    const result = await cloudinary.uploader.destroy(publicId, {
      resource_type: 'image',
    });

    if (result.result !== 'ok' && result.result !== 'not found') {
      return res.status(500).json({
        error: { message: `Cloudinary failed to delete thumbnail: ${result.result}` },
      });
    }

    return res.status(200).json({ deleted: true, publicId });
  } catch (error) {
    console.error('Delete lesson thumbnail error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the thumbnail' } });
  }
}

// ── Question bank images ───────────────────────────────────────────────────
//
// A question's stem or an option can be a picture — an ECG, a histology slide,
// a radiograph. The question bank API accepts questionImageUrl and
// optionImageUrl as strings, but nothing produced those strings, so an admin
// had to host the file somewhere else and paste a link. This is the missing
// half.
//
// Not scoped to a question, deliberately: the upload happens while the
// question is still being written and has no id yet.

// SVG is allowed because diagrams and anatomical figures are drawn as vectors
// and rasterising them costs legibility on a zoomed phone.
//
// An SVG can carry script, so this is only safe because Cloudinary serves it
// from res.cloudinary.com — a different origin from the app, where an embedded
// script has nothing of ours to reach. Never inline these into an admin or
// student page; always render from the returned URL, and in Flutter through
// flutter_svg, which does not execute script at all.
const QUESTION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'];

// POST /api/uploads/question-image  (multipart field name: "image")
async function uploadQuestionImage(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'Attach a file in the "image" field' } });
    }
    if (!QUESTION_IMAGE_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: { message: `Unsupported file type ${req.file.mimetype} — use JPEG, PNG, WebP, or SVG` },
      });
    }

    const result = await uploadBuffer(req.file.buffer, {
      folder: 'question_images',
      resource_type: 'image',
    });

    return res.status(200).json({
      // Paste this straight into questionImageUrl or an option's
      // optionImageUrl. It is stable; Cloudinary serves it unchanged forever.
      url: result.secure_url,
      // Keep it if you want to be able to delete the file later. Without it
      // the asset is unreachable, not just unreferenced.
      publicId: result.public_id,
      originalFilename: req.file.originalname,
      bytes: result.bytes ?? req.file.size,
      format: result.format ?? null,
    });
  } catch (error) {
    console.error('Upload question image error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while uploading the image' } });
  }
}

// DELETE /api/uploads/question-image   { publicId }
async function deleteQuestionImage(req, res) {
  try {
    const { publicId } = req.body ?? {};
    if (!publicId) {
      return res.status(400).json({ error: { message: 'publicId is required' } });
    }

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });

    // "not found" counts as success: the goal is that the file is gone, and a
    // second delete of the same asset should not be an error the admin has to
    // interpret.
    if (result.result !== 'ok' && result.result !== 'not found') {
      return res.status(500).json({
        error: { message: `Cloudinary failed to delete the image: ${result.result}` },
      });
    }

    return res.status(200).json({ deleted: true, publicId });
  } catch (error) {
    console.error('Delete question image error:', error);
    return res.status(500).json({ error: { message: 'Something went wrong while deleting the image' } });
  }
}


module.exports = {
  uploadQuestionImage, deleteQuestionImage,
  uploadLessonVideo,
  uploadLessonNote,
  uploadLessonThumbnail,
  deleteLessonVideo,
  deleteLessonNote,
  deleteLessonThumbnail,
};