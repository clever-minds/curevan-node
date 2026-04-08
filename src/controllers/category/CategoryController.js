const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
// ✅ CATEGORY LIST
exports.listCategories = async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT c.id, c.slug, c.name, c.description, (CASE WHEN c.image ~ '^[0-9]+$' THEN c.image ELSE NULL END) AS "image_id", c.is_active AS "isActive",
              COALESCE(m.file_path, c.image) AS "image"
       FROM categories c
       LEFT JOIN media m ON m.id = (CASE WHEN c.image ~ '^[0-9]+$' THEN CAST(c.image AS INTEGER) ELSE NULL END)
       ORDER BY c.id DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json(categories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch categories' });
  }
};
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

// ✅ ADD CATEGORY
exports.addCategory = async (req, res) => {
  try {
    const { name, description, image_id, status } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const slug = slugify(name);

    /* 🔍 Check duplicate slug */
    const [existing] = await sequelize.query(
      `SELECT id FROM categories WHERE slug = :slug`,
      {
        replacements: { slug },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        message: 'Category with this name/slug already exists',
      });
    }

    const result = await sequelize.query(
      `INSERT INTO categories (slug, name, description, image, is_active)
       VALUES (:slug, :name, :description, :image, :is_active)
       RETURNING *`,
      {
        replacements: {
          slug,
          name,
          description: description || null,
          image: image_id || null,
          is_active: status ?? true
        },
        type: QueryTypes.INSERT
      }
    );

    const row = result[0][0];
    res.status(201).json({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      image_id: row.image,
      status: row.is_active
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to add category' });
  }
};




// ✅ EDIT CATEGORY
exports.editCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, description, image_id, status } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    if (typeof status !== 'boolean') {
      status = true;
    }

    const slug = slugify(name);

    /* 🔍 Step 1: Check duplicate slug (except current id) */
    const [existing] = await sequelize.query(
      `SELECT id FROM categories 
       WHERE slug = :slug AND id != :id`,
      {
        replacements: { slug, id },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        message: 'Category with this name already exists',
      });
    }

    const [result] = await sequelize.query(
      `UPDATE categories
       SET name = :name,
           slug = :slug,
           description = :description,
           image = :image,
           is_active = :is_active
       WHERE id = :id
       RETURNING *`,
      {
        replacements: {
          id,
          name,
          slug,
          description,
          image: image_id,
          is_active: status,
        },
        type: QueryTypes.UPDATE,
      }
    );

    if (!result || result.length === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const row = result[0];
    res.json({
      success: true,
      data: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        image_id: row.image,
        status: row.is_active
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update category' });
  }
};




// ✅ DELETE CATEGORY
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedCount = await sequelize.query(
      `DELETE FROM categories WHERE id = :id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE,
      }
    );

    // 🔥 Postgres DELETE returns affected rows count
    if (deletedCount === 0) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to delete category' });
  }
};



exports.getAllCategories = async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT c.id, c.slug, c.name, c.description, (CASE WHEN c.image ~ '^[0-9]+$' THEN c.image ELSE NULL END) AS "image_id", c.is_active AS "isActive",
              COALESCE(m.file_path, c.image) AS "image"
       FROM categories c
       LEFT JOIN media m ON m.id = (CASE WHEN c.image ~ '^[0-9]+$' THEN CAST(c.image AS INTEGER) ELSE NULL END)
       ORDER BY c.id DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.success(categories, "Categories fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch categories");

  }
};