


// const cloudinary = require('../config/cloudinary');

// function uploadBuffer(buffer, options) {
//   return new Promise((resolve, reject) => {
//     const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
//       if (error) return reject(error);
//       resolve(result);
//     });
//     stream.end(buffer);
//   });
// }

// // Maps a mimetype to a clean file-type label + Cloudinary format hint
// function resolveNoteFileType(mimetype) {
//   switch (mimetype) {
//     case 'application/pdf':
//       return { fileType: 'pdf', format: 'pdf' };
//     case 'application/msword':
//       return { fileType: 'doc', format: 'doc' };
//     case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
//       return { fileType: 'docx', format: 'docx' };
//     default:
//       return { fileType: 'unknown', format: undefined };
//   }
// }

// // POST /api/uploads/lesson-video  (multipart field name: "video")
// async function uploadLessonVideo(req, res) {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: { message: 'No video file received' } });
//     }

//     const result = await uploadBuffer(req.file.buffer, {
//       folder: 'lesson_videos',
//       resource_type: 'video',
//     });

//     return res.status(200).json({
//       url: result.secure_url,
//       publicId: result.public_id,
//       durationSeconds: result.duration,
//     });
//   } catch (error) {
//     console.error('Upload lesson video error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while uploading the video' } });
//   }
// }

// // POST /api/uploads/lesson-note  (multipart field name: "note")
// // Now accepts PDF, DOC, or DOCX
// async function uploadLessonNote(req, res) {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: { message: 'No note file received' } });
//     }

//     const { fileType, format } = resolveNoteFileType(req.file.mimetype);

//     const result = await uploadBuffer(req.file.buffer, {
//       folder: 'lesson_notes',
//       resource_type: 'raw', // PDFs/Word docs are stored as raw assets, not images
//       format,
//     });

//     return res.status(200).json({
//       url: result.secure_url,
//       publicId: result.public_id,
//       fileType,
//     });
//   } catch (error) {
//     console.error('Upload lesson note error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while uploading the note' } });
//   }
// }

// // DELETE /api/uploads/lesson-video  (JSON body: { "publicId": "..." })
// // Removes a single video from Cloudinary independently of the lesson record.
// // The caller (frontend) is responsible for then updating the lesson to
// // clear its videoUrl/videoPublicId fields via PUT /api/lessons/:id
// // (removeVideo: true), same as your existing updateLesson flow.
// async function deleteLessonVideo(req, res) {
//   try {
//     const { publicId } = req.body;

//     if (!publicId) {
//       return res.status(400).json({ error: { message: 'publicId is required' } });
//     }

//     const result = await cloudinary.uploader.destroy(publicId, {
//       resource_type: 'video',
//     });

//     // Cloudinary returns { result: 'ok' } on success, or
//     // { result: 'not found' } if the asset didn't exist - both are
//     // treated as success here, since either way the asset is now gone.
//     if (result.result !== 'ok' && result.result !== 'not found') {
//       return res.status(500).json({
//         error: { message: `Cloudinary failed to delete video: ${result.result}` },
//       });
//     }

//     return res.status(200).json({ deleted: true, publicId });
//   } catch (error) {
//     console.error('Delete lesson video error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while deleting the video' } });
//   }
// }

// // DELETE /api/uploads/lesson-note  (JSON body: { "publicId": "..." })
// // Removes a single note (PDF/DOC/DOCX) from Cloudinary independently of
// // the lesson record. Notes are stored as resource_type "raw", so the
// // destroy call must match that, or Cloudinary won't find the asset.
// async function deleteLessonNote(req, res) {
//   try {
//     const { publicId } = req.body;

//     if (!publicId) {
//       return res.status(400).json({ error: { message: 'publicId is required' } });
//     }

//     const result = await cloudinary.uploader.destroy(publicId, {
//       resource_type: 'raw',
//     });

//     if (result.result !== 'ok' && result.result !== 'not found') {
//       return res.status(500).json({
//         error: { message: `Cloudinary failed to delete note: ${result.result}` },
//       });
//     }

//     return res.status(200).json({ deleted: true, publicId });
//   } catch (error) {
//     console.error('Delete lesson note error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while deleting the note' } });
//   }
// }

// // DELETE /api/uploads/lesson-thumbnail  (JSON body: { "publicId": "..." })
// // Included for completeness, matching your upload flow's thumbnail field.
// async function deleteLessonThumbnail(req, res) {
//   try {
//     const { publicId } = req.body;

//     if (!publicId) {
//       return res.status(400).json({ error: { message: 'publicId is required' } });
//     }

//     const result = await cloudinary.uploader.destroy(publicId, {
//       resource_type: 'image',
//     });

//     if (result.result !== 'ok' && result.result !== 'not found') {
//       return res.status(500).json({
//         error: { message: `Cloudinary failed to delete thumbnail: ${result.result}` },
//       });
//     }

//     return res.status(200).json({ deleted: true, publicId });
//   } catch (error) {
//     console.error('Delete lesson thumbnail error:', error);
//     return res.status(500).json({ error: { message: 'Something went wrong while deleting the thumbnail' } });
//   }
// }

// module.exports = {
//   uploadLessonVideo,
//   uploadLessonNote,
//   deleteLessonVideo,
//   deleteLessonNote,
//   deleteLessonThumbnail,
// };


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

module.exports = {
  uploadLessonVideo,
  uploadLessonNote,
  uploadLessonThumbnail,
  deleteLessonVideo,
  deleteLessonNote,
  deleteLessonThumbnail,
};