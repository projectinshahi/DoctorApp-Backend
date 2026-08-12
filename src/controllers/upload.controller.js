const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/uploads/signature — issues a signed upload signature
// so Flutter can upload directly to Cloudinary without exposing the API secret
async function getUploadSignature(req, res) {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder = 'user-avatars';

    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );

    return res.status(200).json({
      signature,
      timestamp,
      folder,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (error) {
    console.error('Get upload signature error:', error);
    return res.status(500).json({
      error: { message: 'Something went wrong while generating the upload signature' },
    });
  }
}

module.exports = { getUploadSignature };