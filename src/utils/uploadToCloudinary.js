const cloudinary = require('../config/cloudinary');

const uploadPdfToCloudinary = (fileBuffer, folder = 'lesson-notes') => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder,
        format: 'pdf',
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
    stream.end(fileBuffer);
  });
};

const deletePdfFromCloudinary = (publicId) => {
  return cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
};

module.exports = { uploadPdfToCloudinary, deletePdfFromCloudinary };