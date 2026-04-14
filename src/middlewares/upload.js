import multer from 'multer';

// Use memory storage for now to handle simple form-data fields
// We can switch to diskStorage or cloud storage when file upload is actually needed
const storage = multer.memoryStorage();

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
});

export default upload;
