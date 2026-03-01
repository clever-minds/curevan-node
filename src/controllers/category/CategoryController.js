const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');
// ✅ CATEGORY LIST
exports.listCategories = async (req, res) => {
  try {
    const categories = await sequelize.query(
      `SELECT id, slug, name, description, image,is_active AS "isActive"

       FROM categories
       ORDER BY id DESC`,
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
    const { name, description, image_url, is_active } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Category name is required' });
    }

    const slug = slugify(name); // 👈 YAHAN USE

    const result = await sequelize.query(
      `INSERT INTO categories (slug, name, description, image, is_active)
       VALUES (:slug, :name, :description, :image, :is_active)
       RETURNING *`,
      {
        replacements: {
          slug,
          name,
          description: description || null,
          image: image_url || null,
          is_active: is_active ?? true
        },
        type: QueryTypes.INSERT
      }
    );

    res.status(201).json(result[0][0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to add category' });
  }
};




// ✅ EDIT CATEGORY
exports.editCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let { name, description, image, is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      is_active = true;
    }

    /* 🔍 Step 1: Check duplicate name (except current id) */
    const [existing] = await sequelize.query(
      `SELECT id FROM categories 
       WHERE LOWER(name) = LOWER(:name) AND id != :id`,
      {
        replacements: { name, id },
        type: QueryTypes.SELECT,
      }
    );

    if (existing) {
      return res.status(409).json({
        message: 'Category with this name already exists',
      });
    }

    /* 🔄 Step 2: Update */
    const [result] = await sequelize.query(
      `UPDATE categories
       SET name = :name,
           description = :description,
           image = :image,
           is_active = :is_active
       WHERE id = :id`,
      {
        replacements: {
          id,
          name,
          description,
          image,
          is_active,
        },
        type: QueryTypes.UPDATE,
      }
    );

    if (!result) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ success: true });
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
      `SELECT id, slug, name, description, image,is_active AS "isActive"

       FROM categories
       ORDER BY id DESC`,
      { type: QueryTypes.SELECT }
    );

    return res.success(categories, "Categories fetched successfully");
  } catch (error) {
    console.error(error);
    return res.error("Failed to fetch categories");

  }
};