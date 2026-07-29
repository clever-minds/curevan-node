const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../config/db');

// ✅ LIST ALL SUB-CATEGORIES
exports.listSubCategories = async (req, res) => {
  try {
    const subCategories = await sequelize.query(
      `SELECT sc.id, sc.category_id, c.name as category_name, sc.name, sc.is_active, sc.created_at
       FROM sub_categories sc
       JOIN categories c ON sc.category_id = c.id
       ORDER BY sc.id DESC`,
      { type: QueryTypes.SELECT }
    );

    res.json(subCategories);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch sub-categories' });
  }
};

// ✅ GET SUB-CATEGORIES BY CATEGORY ID
exports.getSubCategoriesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;

    if (!categoryId) {
        return res.status(400).json({ message: 'Category ID is required' });
    }

    const subCategories = await sequelize.query(
      `SELECT sc.id, sc.category_id, sc.name, sc.is_active, sc.created_at
       FROM sub_categories sc
       WHERE sc.category_id = :categoryId AND sc.is_active = true
       ORDER BY sc.name ASC`,
      { 
        replacements: { categoryId },
        type: QueryTypes.SELECT 
      }
    );

    res.json({ success: true, data: subCategories });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to fetch sub-categories for this category' });
  }
};

// ✅ ADD SUB-CATEGORY
exports.addSubCategory = async (req, res) => {
  try {
    const { category_id, name, status } = req.body;

    if (!category_id || !name) {
      return res.status(400).json({ message: 'Category ID and Sub-Category name are required' });
    }

    const result = await sequelize.query(
      `INSERT INTO sub_categories (category_id, name, is_active)
       VALUES (:category_id, :name, :is_active)
       RETURNING *`,
      {
        replacements: {
          category_id,
          name,
          is_active: status ?? true
        },
        type: QueryTypes.INSERT
      }
    );

    res.status(201).json({ success: true, data: result[0][0] });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to add sub-category' });
  }
};

// ✅ EDIT SUB-CATEGORY
exports.editSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    let { category_id, name, status } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Sub-Category name is required' });
    }

    const result = await sequelize.query(
      `UPDATE sub_categories
       SET category_id = COALESCE(:category_id, category_id),
           name = :name,
           is_active = COALESCE(:is_active, is_active)
       WHERE id = :id
       RETURNING *`,
      {
        replacements: {
          id,
          category_id: category_id || null,
          name,
          is_active: status ?? null
        },
        type: QueryTypes.UPDATE
      }
    );

    if (result[0].length === 0) {
      return res.status(404).json({ message: 'Sub-Category not found' });
    }

    res.json({ success: true, data: result[0][0] });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to update sub-category' });
  }
};

// ✅ DELETE SUB-CATEGORY
exports.deleteSubCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await sequelize.query(
      `DELETE FROM sub_categories WHERE id = :id RETURNING id`,
      {
        replacements: { id },
        type: QueryTypes.DELETE
      }
    );

    if (!result.length) {
      return res.status(404).json({ message: 'Sub-Category not found' });
    }

    res.json({ success: true, message: 'Sub-Category deleted successfully' });

  } catch (error) {
    console.error(error);
    // If it's linked to products, it might fail due to foreign key constraints
    if (error.original && error.original.code === '23503') {
        return res.status(400).json({ message: 'Cannot delete sub-category because it is assigned to existing products.' });
    }
    res.status(500).json({ message: 'Failed to delete sub-category' });
  }
};
