/**
 * System health reference options.
 * Allergy and body-area labels are presentation-ready for Client Details.
 * Dietary restriction labels are left as product preference names.
 */

export const HEALTH_REFERENCE_SEED_OPTIONS = Object.freeze([
    // --- Allergies ---
    { category: 'allergy', code: 'peanuts', label: 'Peanut Allergy', sortOrder: 10 },
    { category: 'allergy', code: 'tree_nuts', label: 'Tree Nut Allergy', sortOrder: 20 },
    { category: 'allergy', code: 'milk', label: 'Milk Allergy', sortOrder: 30 },
    { category: 'allergy', code: 'eggs', label: 'Egg Allergy', sortOrder: 40 },
    { category: 'allergy', code: 'wheat', label: 'Wheat / Gluten Allergy', sortOrder: 50 },
    { category: 'allergy', code: 'soy', label: 'Soy Allergy', sortOrder: 60 },
    { category: 'allergy', code: 'fish', label: 'Fish Allergy', sortOrder: 70 },
    { category: 'allergy', code: 'shellfish', label: 'Shellfish Allergy', sortOrder: 80 },
    { category: 'allergy', code: 'sesame', label: 'Sesame Allergy', sortOrder: 90 },

    // --- Dietary restrictions (unchanged) ---
    { category: 'dietary_restriction', code: 'halal', label: 'Halal', sortOrder: 10 },
    { category: 'dietary_restriction', code: 'kosher', label: 'Kosher', sortOrder: 20 },
    { category: 'dietary_restriction', code: 'vegetarian', label: 'Vegetarian', sortOrder: 30 },
    { category: 'dietary_restriction', code: 'vegan', label: 'Vegan', sortOrder: 40 },
    { category: 'dietary_restriction', code: 'gluten_free', label: 'Gluten-free', sortOrder: 50 },
    { category: 'dietary_restriction', code: 'dairy_free', label: 'Dairy-free', sortOrder: 60 },
    { category: 'dietary_restriction', code: 'pescatarian', label: 'Pescatarian', sortOrder: 70 },
    { category: 'dietary_restriction', code: 'low_sodium', label: 'Low sodium', sortOrder: 80 },

    // --- Body areas ---
    { category: 'body_area', code: 'lower_back', label: 'Lower Back Pain', sortOrder: 10 },
    { category: 'body_area', code: 'upper_back', label: 'Upper Back Pain', sortOrder: 20 },
    { category: 'body_area', code: 'neck', label: 'Neck Pain', sortOrder: 30 },
    { category: 'body_area', code: 'left_shoulder', label: 'Left Shoulder Pain', sortOrder: 40 },
    { category: 'body_area', code: 'right_shoulder', label: 'Right Shoulder Pain', sortOrder: 50 },
    { category: 'body_area', code: 'left_knee', label: 'Left Knee Pain', sortOrder: 60 },
    { category: 'body_area', code: 'right_knee', label: 'Right Knee Pain', sortOrder: 70 },
    { category: 'body_area', code: 'left_hip', label: 'Left Hip Pain', sortOrder: 80 },
    { category: 'body_area', code: 'right_hip', label: 'Right Hip Pain', sortOrder: 90 },
    { category: 'body_area', code: 'left_ankle', label: 'Left Ankle Pain', sortOrder: 100 },
    { category: 'body_area', code: 'right_ankle', label: 'Right Ankle Pain', sortOrder: 110 },
    { category: 'body_area', code: 'left_wrist', label: 'Left Wrist Pain', sortOrder: 120 },
    { category: 'body_area', code: 'right_wrist', label: 'Right Wrist Pain', sortOrder: 130 },
    { category: 'body_area', code: 'left_elbow', label: 'Left Elbow Pain', sortOrder: 140 },
    { category: 'body_area', code: 'right_elbow', label: 'Right Elbow Pain', sortOrder: 150 },
    { category: 'body_area', code: 'abdomen', label: 'Abdominal Pain', sortOrder: 160 },
    { category: 'body_area', code: 'chest', label: 'Chest Pain', sortOrder: 170 },
]);

/** Label-only patch set for scoped catalog updates (excludes dietary). */
export const HEALTH_REFERENCE_LABEL_UPDATES = Object.freeze(
    HEALTH_REFERENCE_SEED_OPTIONS.filter(
        (item) =>
            item.category === 'allergy' || item.category === 'body_area'
    ).map((item) =>
        Object.freeze({
            category: item.category,
            code: item.code,
            label: item.label,
        })
    )
);
