import multer from "multer";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg", // some clients label .jpg files this way; the real type is checked from the bytes
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

const MAX_SIZE = 10 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only jpg, jpeg, png, webp, gif, pdf allowed."));
    }
  },
});
