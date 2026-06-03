const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

exports.listJournalTags = async (req, res) => {
  try {
    const Tags = await sequelize.query(
      `SELECT id, slug, name, is_active AS "isActive", created_by AS "createdBy"
       FROM journal_tags
       ORDER BY id DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json({ success: true, data: Tags });
  } catch (error) {
    console.error(error);
    if (error.message.includes('relation "journal_Tags" does not exist')) {
        res.json({ success: true, data: [] }); // return empty if table doesn't exist yet
    } else {
        res.status(500).json({ success: false, message: 'Failed to fetch Tags' });
    }
  }
};

exports.addJournalTag = async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Tag name is required' });
    }

    const slug = slugify(name);

    const [existing] = await sequelize.query(
      `SELECT id FROM journal_tags WHERE slug = :slug`,
      {
        replacements: { slug },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Tag with this name/slug already exists',
      });
    }

    const result = await sequelize.query(
      `INSERT INTO journal_tags (slug, name, is_active, created_by)
       VALUES (:slug, :name, :is_active, :created_by)
       RETURNING *`,
      {
        replacements: {
          slug,
          name,
          is_active: status ?? true,
          created_by: req.user ? req.user.id : null
        },
        type: QueryTypes.INSERT
      }
    );

    const row = result[0][0];
    res.status(201).json({
      success: true,
      data: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        isActive: row.is_active
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to add Tag' });
  }
};

exports.editJournalTag = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Tag name is required' });
    }

    if (typeof status !== 'boolean') {
      status = true;
    }

    const slug = slugify(name);

    const [existing] = await sequelize.query(
      `SELECT id FROM journal_tags 
       WHERE slug = :slug AND id != :id`,
      {
        replacements: { slug, id },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Tag with this name already exists',
      });
    }

    const [result] = await sequelize.query(
      `UPDATE journal_tags
       SET name = :name,
           slug = :slug,
           is_active = :is_active
       WHERE id = :id
       RETURNING *`,
      {
        replacements: {
          id,
          name,
          slug,
          is_active: status,
        },
        type: QueryTypes.UPDATE,
      }
    );

    if (!result || result.length === 0) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    const row = result[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        isActive: row.is_active
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to update Tag' });
  }
};

exports.deleteJournalTag = async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership or superadmin role
    const [tag] = await sequelize.query(
      `SELECT created_by FROM journal_tags WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.SELECT,
      }
    );

    if (!tag) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    const isSuperAdmin = req.user.role === 'superadmin' || req.user.role === 'admin';
    const isOwner = tag.created_by === req.user.id;

    if (!isSuperAdmin && !isOwner) {
       return res.status(403).json({ success: false, message: 'You do not have permission to delete this tag' });
    }

    const deletedCount = await sequelize.query(
      `DELETE FROM journal_tags WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
      }
    );

    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Tag not found' });
    }

    res.json({ success: true, message: 'Tag deleted successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to delete Tag' });
  }
};
