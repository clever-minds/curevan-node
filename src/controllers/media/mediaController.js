const fs = require("fs");
const path = require("path");
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
/* =========================
   LIST MEDIA
========================= */
exports.listMedia = async (req, res) => {
  try {
    const userId = req.user?.id || req.query.user_id;

    if (!userId) {
      return res.status(400).json({ message: "User ID required" });
    }

    const result = await sequelize.query(
      `SELECT * FROM media WHERE user_id = :userId ORDER BY created_at DESC`,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    res.json(result); 
  } catch (error) {
    console.error("listMedia error:", error);
    res.status(500).json({ message: "Server error" });
  }
};



/* =========================
   UPLOAD MEDIA (MULTIPLE)
========================= */
exports.uploadMedia = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = req.user.id;

    if (!req.files || !req.files.length) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    const insertedMedia = [];

    for (const file of req.files) {
      const mediaType = file.mimetype.startsWith("video")
        ? "video"
        : "image";

      const filePath = `/${file.path.replace(/\\/g, "/")}`;

      const result = await sequelize.query(
        `
        INSERT INTO media (user_id, filename, file_path, media_type)
        VALUES (:userId, :filename, :filePath, :mediaType)
        RETURNING *
        `,
        {
          replacements: {
            userId,
            filename: file.filename,
            filePath,
            mediaType
          },
          type: QueryTypes.INSERT
        }
      );

      // Sequelize INSERT returns [rows, metadata]
      insertedMedia.push(result[0][0]);
    }

    res.json({
      message: "Media uploaded & saved in DB",
      data: insertedMedia
    });

  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ message: "Server error" });
  }
};


/* =========================
   DELETE MEDIA
========================= */
exports.deleteMedia = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await sequelize.query(
      `SELECT * FROM media WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: "Media not found" });
    }

    const media = result.rows[0];
    const filePath = path.join(process.cwd(), media.file_path);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await sequelize.query(`DELETE FROM media WHERE id = $1`, [id]);

    res.json({ message: "Media deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

