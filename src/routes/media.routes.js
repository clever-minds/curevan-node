const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload.middleware");
const media = require("../controllers/media/mediaController");
const authMiddleware = require("../middlewares/authMiddleware");

/* LIST */
router.get("/list",authMiddleware, media.listMedia);

/* UPLOAD (MULTIPLE) */
router.post(
  "/upload",authMiddleware,
  upload.array("files[]"),
  media.uploadMedia
);

/* DELETE */
router.delete(
  "/delete/:type/:filename",authMiddleware,
  media.deleteMedia
);

module.exports = router;
