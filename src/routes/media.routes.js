const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload.middleware");
const media = require("../controllers/media/mediaController");
const authMiddleware = require("../middlewares/authMiddleware");

const { requireRole } = require("../middlewares/requireRole");
/* LIST */
router.get("/list",authMiddleware, requireRole("admin.ecom", "admin.therapy", "therapist"), media.listMedia);

/* UPLOAD (MULTIPLE) */
router.post(
  "/upload",authMiddleware, requireRole("admin.ecom", "admin.therapy", "therapist"),
  upload.any(),
  media.uploadMedia
);

/* DELETE */
router.delete(
  "/delete/:id",authMiddleware, requireRole("admin.ecom", "admin.therapy", "therapist"),
  media.deleteMedia
);

router.get('/url/:id', media.getMediaUrlById);

module.exports = router;

