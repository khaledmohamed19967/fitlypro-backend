/**
 * Initial system health reference options.
 * Aligned with FitlyPro client health UI (allergies, dietary preferences, body areas).
 * Body areas = affected regions only — not diagnoses or injury types.
 */

export const HEALTH_REFERENCE_SEED_OPTIONS = Object.freeze([
    // --- Allergies ---
    { category: 'allergy', code: 'peanuts', label: 'Peanuts', sortOrder: 10 },
    { category: 'allergy', code: 'tree_nuts', label: 'Tree nuts', sortOrder: 20 },
    { category: 'allergy', code: 'milk', label: 'Milk', sortOrder: 30 },
    { category: 'allergy', code: 'eggs', label: 'Eggs', sortOrder: 40 },
    { category: 'allergy', code: 'wheat', label: 'Wheat / gluten', sortOrder: 50 },
    { category: 'allergy', code: 'soy', label: 'Soy', sortOrder: 60 },
    { category: 'allergy', code: 'fish', label: 'Fish', sortOrder: 70 },
    { category: 'allergy', code: 'shellfish', label: 'Shellfish', sortOrder: 80 },
    { category: 'allergy', code: 'sesame', label: 'Sesame', sortOrder: 90 },

    // --- Dietary restrictions ---
    { category: 'dietary_restriction', code: 'halal', label: 'Halal', sortOrder: 10 },
    { category: 'dietary_restriction', code: 'kosher', label: 'Kosher', sortOrder: 20 },
    { category: 'dietary_restriction', code: 'vegetarian', label: 'Vegetarian', sortOrder: 30 },
    { category: 'dietary_restriction', code: 'vegan', label: 'Vegan', sortOrder: 40 },
    { category: 'dietary_restriction', code: 'gluten_free', label: 'Gluten-free', sortOrder: 50 },
    { category: 'dietary_restriction', code: 'dairy_free', label: 'Dairy-free', sortOrder: 60 },
    { category: 'dietary_restriction', code: 'pescatarian', label: 'Pescatarian', sortOrder: 70 },
    { category: 'dietary_restriction', code: 'low_sodium', label: 'Low sodium', sortOrder: 80 },

    // --- Body areas (injury / limitation regions) ---
    { category: 'body_area', code: 'lower_back', label: 'Lower back', sortOrder: 10 },
    { category: 'body_area', code: 'upper_back', label: 'Upper back', sortOrder: 20 },
    { category: 'body_area', code: 'neck', label: 'Neck', sortOrder: 30 },
    { category: 'body_area', code: 'left_shoulder', label: 'Left shoulder', sortOrder: 40 },
    { category: 'body_area', code: 'right_shoulder', label: 'Right shoulder', sortOrder: 50 },
    { category: 'body_area', code: 'left_knee', label: 'Left knee', sortOrder: 60 },
    { category: 'body_area', code: 'right_knee', label: 'Right knee', sortOrder: 70 },
    { category: 'body_area', code: 'left_hip', label: 'Left hip', sortOrder: 80 },
    { category: 'body_area', code: 'right_hip', label: 'Right hip', sortOrder: 90 },
    { category: 'body_area', code: 'left_ankle', label: 'Left ankle', sortOrder: 100 },
    { category: 'body_area', code: 'right_ankle', label: 'Right ankle', sortOrder: 110 },
    { category: 'body_area', code: 'left_wrist', label: 'Left wrist', sortOrder: 120 },
    { category: 'body_area', code: 'right_wrist', label: 'Right wrist', sortOrder: 130 },
    { category: 'body_area', code: 'left_elbow', label: 'Left elbow', sortOrder: 140 },
    { category: 'body_area', code: 'right_elbow', label: 'Right elbow', sortOrder: 150 },
    { category: 'body_area', code: 'abdomen', label: 'Abdomen', sortOrder: 160 },
    { category: 'body_area', code: 'chest', label: 'Chest', sortOrder: 170 },
]);
