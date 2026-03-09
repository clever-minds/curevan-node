const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../config/db");

exports.addAuditLog = async (req, res) => {
  try {
    const {
      actorId,
      action,
      entityType,
      entityId,
      details = null,
    } = req.body;

    if (!actorId || !action || !entityType || !entityId) {
      return res.status(400).json({
        message: "actorId, action, entityType, entityId are required",
      });
    }

    await sequelize.query(
      `
      INSERT INTO audit_logs
      (actor_id, action, entity_type, entity_id, details)
      VALUES
      (:actorId, :action, :entityType, :entityId, :details)
      `,
      {
        replacements: {
          actorId: String(actorId),
          action,
          entityType,
          entityId: String(entityId),
          details: details ? JSON.stringify(details) : null,
        },
        type: QueryTypes.INSERT,
      }
    );

    res.status(201).json({
      message: "Audit log added successfully",
    });

  } catch (error) {
    console.error("addAuditLog error:", error);
    res.status(500).json({
      message: "Server error",
    });
  }
};



exports.addPayoutItem = async (req, res) => {
  try {
    const {
      type,
      sourceId,
      therapistId,
      patientId,
      serviceTypeId,
      grossAmount,
      platformFeePct,
      platformFeeAmount,
      gstOnPlatformFee = null,
      preTdsPayable = null,
      tdsDeducted = null,
      netAmount,
      currency = "INR",
      state,
      weekStart,
      membershipPlanSnapshot,
    } = req.body;

    // Required fields check
    if (
      type == null ||
      sourceId == null ||
      therapistId == null ||
      patientId == null ||
      grossAmount == null ||
      platformFeePct == null ||
      platformFeeAmount == null ||
      netAmount == null ||
      state == null ||
      weekStart == null ||
      membershipPlanSnapshot == null
    ) {
      return res.status(400).json({
        message: "Required fields are missing",
      });
    }

    const [result] = await sequelize.query(
      `
      INSERT INTO payout_items
      (
        type,
        source_id,
        therapist_id,
        patient_id,
        service_type_id,
        gross_amount,
        platform_fee_pct,
        platform_fee_amount,
        gst_on_platform_fee,
        pre_tds_payable,
        tds_deducted,
        net_amount,
        currency,
        state,
        week_start,
        created_at,
        membership_plan_snapshot
      )
      VALUES
      (
        :type,
        :sourceId,
        :therapistId,
        :patientId,
        :serviceTypeId,
        :grossAmount,
        :platformFeePct,
        :platformFeeAmount,
        :gstOnPlatformFee,
        :preTdsPayable,
        :tdsDeducted,
        :netAmount,
        :currency,
        :state,
        :weekStart,
        CURRENT_TIMESTAMP,
        :membershipPlanSnapshot
      )
      RETURNING id
      `,
      {
        replacements: {
          type,
          sourceId: Number(sourceId),
          therapistId: Number(therapistId),
          patientId: Number(patientId),
          serviceTypeId: serviceTypeId || null, // string directly pass
          grossAmount: Number(grossAmount),
          platformFeePct: Number(platformFeePct),
          platformFeeAmount: Number(platformFeeAmount),
          gstOnPlatformFee: gstOnPlatformFee != null ? Number(gstOnPlatformFee) : null,
          preTdsPayable: preTdsPayable != null ? Number(preTdsPayable) : null,
          tdsDeducted: tdsDeducted != null ? Number(tdsDeducted) : null,
          netAmount: Number(netAmount),
          currency,
          state,
          weekStart,
          membershipPlanSnapshot,
        },
        type: QueryTypes.INSERT,
      }
    );

    res.status(201).json({
      message: "Payout item created successfully",
      id: result[0].id,
    });
  } catch (error) {
    console.error("addPayoutItem error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Get a payout item by sourceId
 */
exports.getPayoutItemBySourceId = async (req, res) => {
  try {
    const { sourceId } = req.params;
    if (!sourceId) return res.status(400).json({ message: "sourceId required" });

    const [item] = await sequelize.query(
      `SELECT * FROM payout_items WHERE source_id = :sourceId`,
      {
        replacements: { sourceId: Number(sourceId) },
        type: QueryTypes.SELECT,
      }
    );

    if (!item) return res.status(404).json({ message: "Payout item not found" });
    res.json(item);
  } catch (error) {
    console.error("getPayoutItemBySourceId error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * List all payout items (optional filter by therapistId)
 */
exports.listPayoutItems = async (req, res) => {
  try {
    const { therapistId } = req.query;

let query = `SELECT payout_items.gross_amount AS "grossAmount",payout_items.therapist_id AS "therapistId",payout_items.platform_fee_amount AS "platformFeeAmount",
    u.name AS "therapistName",tp.pan_number AS "therapistPan",payout_items.source_id AS "sourceId",payout_items.gst_on_platform_fee AS "gstOnPlatformFee",
    payout_items.tds_deducted AS "tdsDeducted",payout_items.net_amount AS "netAmount",payout_items.state AS "state"
    FROM payout_items LEFT JOIN users u ON payout_items.therapist_id = u.id
    LEFT JOIN therapist_profiles tp ON payout_items.therapist_id = tp.user_id
`;
    const replacements = {};

    if (therapistId) {
      query += ` WHERE therapist_id = :therapistId`;
      replacements.therapistId = Number(therapistId);
    }

    const items = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

    res.json(items);
  } catch (error) {
    console.error("listPayoutItems error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * Update payout state
 */
exports.updatePayoutState = async (req, res) => {
  try {
    const { id } = req.params;
    const { state } = req.body;

    if (!id || !state)
      return res.status(400).json({ message: "id and state are required" });

    await sequelize.query(
      `UPDATE payout_items SET state = :state WHERE id = :id`,
      {
        replacements: { id: Number(id), state },
        type: QueryTypes.UPDATE,
      }
    );

    res.json({ message: "Payout state updated successfully" });
  } catch (error) {
    console.error("updatePayoutState error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ✅ Add new journal entry
// Add a new journal (authorId/name from logged-in user)
// exports.addJournal = async (req, res) => {
//   try {
//     const {
//       title,
//       slug,
//       excerpt,
//       content,
//       featuredImage,
//       aiHint,
//       status = "draft",
//       tags = [],
//       metaDescription,
//       videoUrl, // ✅ NEW FIELD
//       createdAt = new Date(),
//       publishedAt = null,
//       updatedAt = new Date(),
//     } = req.body;

//     const authorId = req.user?.id;

//     if (!title || !slug || !authorId) {
//       return res
//         .status(400)
//         .json({ message: "title, slug, and author info required" });
//     }

//     // Fetch author name
//     const [user] = await sequelize.query(
//       `SELECT name FROM users WHERE id = :authorId`,
//       {
//         replacements: { authorId },
//         type: QueryTypes.SELECT,
//       }
//     );

//     const authorName = user?.name || "Unknown Author";

//     const replacements = {
//       title,
//       slug,
//       excerpt: excerpt ?? null,
//       content: content ?? null,
//       featuredImage: featuredImage ?? null,
//       aiHint: aiHint ?? null,
//       videoUrl: videoUrl ?? null, // ✅ ADD
//       authorId,
//       authorName,
//       status,
//       tags: tags.length ? tags : null,
//       metaDescription: metaDescription ?? null,
//       createdAt,
//       publishedAt,
//       updatedAt,
//     };

//     const [result] = await sequelize.query(
//       `
//       INSERT INTO journal
//       (
//         title, slug, excerpt, content, featured_image, ai_hint,
//         youtube_video_url, -- ✅ NEW FIELD
//         author_id, author_name, status, tags, meta_description,
//         total_views, unique_views, created_at, published_at, updated_at
//       )
//       VALUES
//       (
//         :title, :slug, :excerpt, :content, :featuredImage, :aiHint,
//         :videoUrl, -- ✅ NEW FIELD
//         :authorId, :authorName, :status, :tags, :metaDescription,
//         0, 0, :createdAt, :publishedAt, :updatedAt
//       )
//       RETURNING id
//       `,
//       { replacements, type: QueryTypes.INSERT }
//     );

//     res.status(201).json({
//       message: "Journal entry added successfully",
//       id: result[0].id,
//     });

//   } catch (error) {
//     console.error("addJournal error:", error);
//     res.status(500).json({ message: "Server error" });
//   }
// };

exports.addKnowledgeBase = async (req, res) => {
  try {
    const {
      title,
      slug,
      excerpt,
      content,
      featuredImage,
      aiHint,
      contentType = "post",
      status = "draft",
      tags = [],
      metaDescription,
      videoUrl,
      difficulty,
      durationMin,
      sopVersion,
      createdAt = new Date(),
      publishedAt = null,
      updatedAt = new Date(),
    } = req.body;

    const authorId = req.user?.id;

    if (!title || !slug || !authorId) {
      return res
        .status(400)
        .json({ message: "title, slug, and author info required" });
    }

    const [user] = await sequelize.query(
      `SELECT name FROM users WHERE id = :authorId`,
      {
        replacements: { authorId },
        type: QueryTypes.SELECT,
      }
    );

    const authorName = user?.name || "Unknown Author";

    const replacements = {
      title,
      slug,
      excerpt: excerpt ?? null,
      content: content ?? null,
      featuredImage: featuredImage ?? null,
      aiHint: aiHint ?? null,
      videoUrl: videoUrl ?? null,
      contentType,
      authorId,
      authorName,
      status,
      tags: tags?.length ? `{${tags.join(",")}}` : null,
      metaDescription: metaDescription ?? null,
      difficulty: difficulty ?? null,
      durationMin: durationMin ?? null,
      sopVersion: sopVersion ?? null,
      createdAt,
      publishedAt,
      updatedAt,
    };

    const [result] = await sequelize.query(
      `
      INSERT INTO knowledge_base
      (
        title, slug, excerpt, content, featured_image, ai_hint,
        youtube_video_url,
        content_type,
        author_id, author_name, status, tags, meta_description,
        difficulty, duration_min, sop_version,
        total_views, unique_views, created_at, published_at, updated_at
      )
      VALUES
      (
        :title, :slug, :excerpt, :content, :featuredImage, :aiHint,
        :videoUrl,
        :contentType,
        :authorId, :authorName, :status, :tags, :metaDescription,
        :difficulty, :durationMin, :sopVersion,
        0, 0, :createdAt, :publishedAt, :updatedAt
      )
      RETURNING id
      `,
      { replacements, type: QueryTypes.INSERT }
    );

    const typeLabel = contentType === "post" ? "journal" : contentType;
    return res.success(null, `${typeLabel} aDDED successfully`);  
  } catch (error) {
    return res.error("Failed to update Knowledge Base");
  }
};


exports.listKnowledgeBase = async (req, res) => {
  try {
    const authorId = req.user?.id;
    const userRole = req.user?.role;
    const { contentType } = req.query;

    let query = `
      SELECT 
        *,
        tags AS categories,
        duration_min AS "durationMin",
        sop_version AS "sopVersion"
      FROM knowledge_base
      WHERE 1=1
    `;

    const replacements = {};

    if (contentType) {
      query += ` AND content_type = :contentType`;
      replacements.contentType = contentType;
    }

    if (userRole !== "admin") {
      query += ` AND author_id = :authorId`;
      replacements.authorId = authorId;
    }

    query += ` ORDER BY created_at DESC`;

    const items = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT,
    });

   const typeLabel = contentType === "post" ? "journal" : contentType;
    return res.success(items, `${typeLabel} fetched successfully`);  
  } catch (error) {
    return res.error("Failed to fetch");
  }
};


exports.getKnowledgeBaseById = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const authorId = req.user?.id;

    if (isNaN(id) || !authorId) {
      return res.status(400).json({ message: "Invalid ID or author" });
    }

    const journals = await sequelize.query(
      `
      SELECT 
        kb.title,
        kb.slug,
        kb.tags AS categories,
        kb.excerpt,
        kb.content,
        kb.ai_hint AS "aiHint",
        kb.tags,
        kb.meta_description AS "metaDescription",
        kb.youtube_video_url AS "videoUrl",
        kb.status,
        kb.difficulty,
        kb.duration_min AS "durationMin",
        kb.sop_version AS "sopVersion",
        kb.created_at AS "createdAt",
        kb.published_at AS "publishedAt",
        m.file_path AS "featuredImage",
        kb.featured_image AS "featuredImageId"
      FROM knowledge_base kb
      LEFT JOIN media m 
        ON m.id = kb.featured_image
      WHERE kb.id = :id
      ${req.user.role !== 'admin' ? 'AND kb.author_id::int = :authorId' : ''}
      LIMIT 1
      `,
      {
        replacements: { id, authorId: Number(authorId) },
        type: QueryTypes.SELECT,
      }
    );

    if (!journals || journals.length === 0) {
       return res.error("No Data Found", 404);
    }

    return res.success(journals[0], `fetched successfully`);  


  } catch (error) {
    console.error("getKnowledgeBaseById error:", error);
       return res.error("Failed to fetch ", 500);

  }
};


exports.updateKnowledgeBase = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      slug,
      excerpt,
      content,
      featuredImage,
      aiHint,
      status,
      tags = [],
      metaDescription,
      videoUrl,
      difficulty,
      durationMin,
      sopVersion,
      publishedAt = null,
      updatedAt = new Date(),
      contentType = "post",
    } = req.body;

    if (!id) {
      return res.status(400).json({ message: "Journal ID required" });
    }

    const formattedTags = tags.length ? `{${tags.join(",")}}` : null;

    const replacements = {
      id,
      title,
      slug,
      excerpt: excerpt ?? null,
      content: content ?? null,
      featuredImage: featuredImage ?? null,
      aiHint: aiHint ?? null,
      videoUrl: videoUrl ?? null,
      status,
      tags: formattedTags,
      metaDescription: metaDescription ?? null,
      difficulty: difficulty ?? null,
      durationMin: durationMin ?? null,
      sopVersion: sopVersion ?? null,
      publishedAt,
      updatedAt,
    };

    await sequelize.query(
      `
      UPDATE knowledge_base
      SET
        title = :title,
        slug = :slug,
        excerpt = :excerpt,
        content = :content,
        featured_image = :featuredImage,
        ai_hint = :aiHint,
        youtube_video_url = :videoUrl,
        status = :status,
        tags = :tags,
        meta_description = :metaDescription,
        difficulty = :difficulty,
        duration_min = :durationMin,
        sop_version = :sopVersion,
        published_at = :publishedAt,
        updated_at = :updatedAt
      WHERE id = :id
      `,
      { replacements, type: QueryTypes.UPDATE }
    );
    const typeLabel = contentType === "post" ? "journal" : contentType;
    return res.success(null, `${typeLabel} updated successfully`);  
  } catch (error) {
    return res.error("Failed to update Knowledge Base");
  }
};
exports.deleteKnowledgeBase = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ message: "Knowledge Base ID required" });
    }

    await sequelize.query(
      `DELETE FROM knowledge_base WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
      }
    );

    res.json({
      message: "Knowledge Base deleted successfully",
    });

  } catch (error) {
    console.error("deleteKnowledgeBase error:", error);
    res.status(500).json({ message: "Server error" });
  }
};