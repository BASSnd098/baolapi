const express = require('express');
const router = express.Router();
const { protect, admin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { uploadImage, deleteImage } = require('../controllers/uploadController');

// Protected routes (admin only for image management)
router.use(protect, admin);

router.post('/image', upload.single('image'), uploadImage);
router.delete('/image', deleteImage);

module.exports = router;