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

exports.listJournalCategories = async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT id, slug, name, is_active AS "isActive"
       FROM journal_categories
       ORDER BY id DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json({ success: true, data: categories });
  } catch (error) {
    console.error(error);
    if (error.message.includes('relation "journal_categories" does not exist')) {
        res.json({ success: true, data: [] }); // return empty if table doesn't exist yet
    } else {
        res.status(500).json({ success: false, message: 'Failed to fetch categories' });
    }
  }
};

exports.addJournalCategory = async (req, res) => {
  try {
    const { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    const slug = slugify(name);

    const [existing] = await sequelize.query(
      `SELECT id FROM journal_categories WHERE slug = :slug`,
      {
        replacements: { slug },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Category with this name/slug already exists',
      });
    }

    const result = await sequelize.query(
      `INSERT INTO journal_categories (slug, name, is_active)
       VALUES (:slug, :name, :is_active)
       RETURNING *`,
      {
        replacements: {
          slug,
          name,
          is_active: status ?? true
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
    res.status(500).json({ success: false, message: 'Failed to add category' });
  }
};

exports.editJournalCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, status } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Category name is required' });
    }

    if (typeof status !== 'boolean') {
      status = true;
    }

    const slug = slugify(name);

    const [existing] = await sequelize.query(
      `SELECT id FROM journal_categories 
       WHERE slug = :slug AND id != :id`,
      {
        replacements: { slug, id },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Category with this name already exists',
      });
    }

    const [result] = await sequelize.query(
      `UPDATE journal_categories
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
      return res.status(404).json({ success: false, message: 'Category not found' });
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
    res.status(500).json({ success: false, message: 'Failed to update category' });
  }
};

exports.deleteJournalCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedCount = await sequelize.query(
      `DELETE FROM journal_categories WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
      }
    );

    if (deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }

    res.json({ success: true, message: 'Category deleted successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: 'Failed to delete category' });
  }
};
