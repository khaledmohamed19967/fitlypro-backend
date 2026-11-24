export const GENERIC_CHICKEN_SEARCH = {
    food_id: '36413',
    food_name: 'Chicken Breast',
    food_type: 'Generic',
    food_description: 'Per 100g - Calories: 165kcal | Fat: 3.57g | Carbs: 0.00g | Protein: 31.02g',
};

export const BRANDED_SEARCH = {
    food_id: '41963',
    brand_name: "McDonald's",
    food_name: 'Cheeseburger',
    food_type: 'Brand',
    food_description: 'Per 1 serving - Calories: 300kcal | Fat: 13.00g | Carbs: 32.00g | Protein: 15.00g',
};

export const SEARCH_WITH_IMAGE = {
    food_id: '33691',
    food_name: 'Banana',
    food_type: 'Generic',
    food_description: 'Per 100g - Calories: 89kcal | Fat: 0.33g | Carbs: 22.84g | Protein: 1.09g',
    food_images: {
        food_image: {
            image_url: 'https://images.fatsecret.com/banana.png',
            image_type: 'Standard',
        },
    },
};

/** Official v6-style multi-size food_images (Standard = 0, Isolated = 1). */
export const SEARCH_WITH_IMAGE_V6 = {
    food_id: '1641',
    food_name: 'Chicken Breast',
    food_type: 'Generic',
    food_description: 'Per 100g - Calories: 165kcal | Fat: 3.57g | Carbs: 0.00g | Protein: 31.02g',
    food_images: {
        food_image: [
            {
                image_url:
                    'https://www.foodimagedb.com/food-images/bc47e77b-3a5c-4a8e-aa6c-786646a8934a_1024x1024.png',
                image_type: '0',
            },
            {
                image_url:
                    'https://www.foodimagedb.com/food-images/bc47e77b-3a5c-4a8e-aa6c-786646a8934a_400x400.png',
                image_type: '0',
            },
            {
                image_url:
                    'https://www.foodimagedb.com/food-images/bc47e77b-3a5c-4a8e-aa6c-786646a8934a_72x72.png',
                image_type: '0',
            },
            {
                image_url:
                    'https://www.foodimagedb.com/food-images/isolated-chicken_1024x1024.png',
                image_type: '1',
            },
            {
                image_url:
                    'https://www.foodimagedb.com/food-images/isolated-chicken_400x400.png',
                image_type: '1',
            },
        ],
    },
};

export const SEARCH_MISSING_NUTRITION = {
    food_id: '1',
    food_name: 'Unknown Item',
    food_type: 'Generic',
};

export const DETAIL_CHICKEN = {
    food: {
        food_id: '36413',
        food_name: 'Chicken Breast',
        food_type: 'Generic',
        servings: {
            serving: [
                {
                    serving_id: '1',
                    serving_description: '100 g',
                    metric_serving_amount: '100.000',
                    metric_serving_unit: 'g',
                    number_of_units: '100.000',
                    measurement_description: 'g',
                    calories: '165',
                    carbohydrate: '0',
                    protein: '31.02',
                    fat: '3.57',
                    is_default: '1',
                },
                {
                    serving_id: '2',
                    serving_description: '1 piece',
                    metric_serving_amount: '120.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'piece',
                    calories: '198',
                    carbohydrate: '0',
                    protein: '37.22',
                    fat: '4.28',
                },
            ],
        },
    },
};

export const DETAIL_EGG_PIECE = {
    food: {
        food_id: '33691',
        food_name: 'Egg',
        food_type: 'Generic',
        servings: {
            serving: {
                serving_id: '9',
                serving_description: '1 large',
                metric_serving_amount: '50.000',
                metric_serving_unit: 'g',
                number_of_units: '1.000',
                measurement_description: 'large',
                calories: '78',
                carbohydrate: '0.56',
                protein: '6.29',
                fat: '5.3',
            },
        },
    },
};

/**
 * Representative multi-serving Egg detail (metric grams on every option).
 * FatSecret marks "1 large" as is_default; 100g is also present.
 * Not a verified live capture — constructed to match documented response shape.
 */
export const DETAIL_EGG_MULTI = {
    food: {
        food_id: '33691',
        food_name: 'Egg',
        food_type: 'Generic',
        servings: {
            serving: [
                {
                    serving_id: '1',
                    serving_description: '1 small',
                    metric_serving_amount: '38.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'small',
                    calories: '54',
                    carbohydrate: '0.34',
                    protein: '4.79',
                    fat: '3.6',
                },
                {
                    serving_id: '2',
                    serving_description: '1 medium',
                    metric_serving_amount: '44.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'medium',
                    calories: '63',
                    carbohydrate: '0.39',
                    protein: '5.54',
                    fat: '4.18',
                },
                {
                    serving_id: '3',
                    serving_description: '1 large',
                    metric_serving_amount: '50.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'large',
                    calories: '72',
                    carbohydrate: '0.45',
                    protein: '6.3',
                    fat: '4.75',
                    is_default: '1',
                },
                {
                    serving_id: '4',
                    serving_description: '1 extra large',
                    metric_serving_amount: '56.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'extra large',
                    calories: '80',
                    carbohydrate: '0.5',
                    protein: '7.05',
                    fat: '5.32',
                },
                {
                    serving_id: '5',
                    serving_description: '100 g',
                    metric_serving_amount: '100.000',
                    metric_serving_unit: 'g',
                    number_of_units: '100.000',
                    measurement_description: 'g',
                    calories: '143',
                    carbohydrate: '0.9',
                    protein: '12.6',
                    fat: '9.5',
                },
            ],
        },
    },
};

/** No is_default; includes ~100g — Fitly should select 100g (priority 2). */
export const DETAIL_NO_DEFAULT_WITH_100G = {
    food: {
        food_id: '90001',
        food_name: 'Oats',
        food_type: 'Generic',
        servings: {
            serving: [
                {
                    serving_id: '10',
                    serving_description: '1 cup',
                    metric_serving_amount: '80.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'cup',
                    calories: '300',
                    carbohydrate: '54',
                    protein: '10',
                    fat: '6',
                },
                {
                    serving_id: '11',
                    serving_description: '100 g',
                    metric_serving_amount: '100.000',
                    metric_serving_unit: 'g',
                    number_of_units: '100.000',
                    measurement_description: 'g',
                    calories: '375',
                    carbohydrate: '67.5',
                    protein: '12.5',
                    fat: '7.5',
                },
            ],
        },
    },
};

/** No is_default and no ~100g — Fitly should select first valid metric serving. */
export const DETAIL_NO_DEFAULT_NO_100G = {
    food: {
        food_id: '90002',
        food_name: 'Almonds',
        food_type: 'Generic',
        servings: {
            serving: [
                {
                    serving_id: '20',
                    serving_description: '1 oz',
                    metric_serving_amount: '28.000',
                    metric_serving_unit: 'g',
                    number_of_units: '1.000',
                    measurement_description: 'oz',
                    calories: '160',
                    carbohydrate: '6',
                    protein: '6',
                    fat: '14',
                },
                {
                    serving_id: '21',
                    serving_description: '10 almonds',
                    metric_serving_amount: '12.000',
                    metric_serving_unit: 'g',
                    number_of_units: '10.000',
                    measurement_description: 'almonds',
                    calories: '70',
                    carbohydrate: '2.5',
                    protein: '2.5',
                    fat: '6',
                },
            ],
        },
    },
};

/**
 * Explicit default has no usable metric weight — must be ignored; fall back to 100g.
 * Representative fixture (not a live capture).
 */
export const DETAIL_INVALID_DEFAULT_FALLBACK_100G = {
    food: {
        food_id: '90003',
        food_name: 'Mystery Food',
        food_type: 'Generic',
        servings: {
            serving: [
                {
                    serving_id: '30',
                    serving_description: '1 serving',
                    // Missing metric amount — invalid for Fitly selection.
                    number_of_units: '1.000',
                    measurement_description: 'serving',
                    calories: '200',
                    carbohydrate: '20',
                    protein: '10',
                    fat: '8',
                    is_default: 1,
                },
                {
                    serving_id: '31',
                    serving_description: '100 g',
                    metric_serving_amount: '100.000',
                    metric_serving_unit: 'g',
                    number_of_units: '100.000',
                    measurement_description: 'g',
                    calories: '200',
                    carbohydrate: '20',
                    protein: '10',
                    fat: '8',
                },
            ],
        },
    },
};

/** Same as egg multi but is_default is numeric 1 (docs type) instead of string "1". */
export const DETAIL_EGG_MULTI_NUMERIC_DEFAULT = {
    food: {
        food_id: '33691',
        food_name: 'Egg',
        food_type: 'Generic',
        servings: {
            serving: DETAIL_EGG_MULTI.food.servings.serving.map((entry) =>
                entry.serving_id === '3'
                    ? { ...entry, is_default: 1 }
                    : (() => {
                          const next = { ...entry };
                          delete next.is_default;
                          return next;
                      })()
            ),
        },
    },
};

export const TOKEN_RESPONSE = {
    access_token: 'test-token',
    token_type: 'Bearer',
    expires_in: 86400,
};

/** Legacy v5-shaped search envelope (foods nested directly under foods_search). */
export const SEARCH_RESPONSE_V5 = {
    foods_search: {
        max_results: '20',
        total_results: '2',
        page_number: '0',
        food: [GENERIC_CHICKEN_SEARCH, BRANDED_SEARCH],
    },
};

/**
 * Official foods.search.v6 JSON shape: foods under foods_search.results.food,
 * with optional food_images when include_food_images=true.
 */
export const SEARCH_RESPONSE_V6 = {
    foods_search: {
        max_results: '20',
        total_results: '2',
        page_number: '0',
        results: {
            food: [
                {
                    ...GENERIC_CHICKEN_SEARCH,
                    servings: {
                        serving: [
                            {
                                serving_id: '1',
                                serving_description: '100 g',
                                metric_serving_amount: '100.000',
                                metric_serving_unit: 'g',
                                number_of_units: '100.000',
                                measurement_description: 'g',
                                is_default: '1',
                                calories: '165',
                                carbohydrate: '0.00',
                                protein: '31.02',
                                fat: '3.57',
                            },
                        ],
                    },
                    food_images: SEARCH_WITH_IMAGE_V6.food_images,
                },
                BRANDED_SEARCH,
            ],
        },
    },
};

export const SEARCH_RESPONSE_V1 = {
    foods: {
        max_results: '20',
        total_results: '1',
        page_number: '0',
        food: GENERIC_CHICKEN_SEARCH,
    },
};

export const EMPTY_SEARCH_RESPONSE = {
    foods: {
        max_results: '20',
        total_results: '0',
        page_number: '0',
    },
};

export const MISSING_SCOPE_ERROR = {
    error: {
        code: 14,
        message: "Missing scope: 'premier'",
    },
};

export const RATE_LIMIT_ERROR = {
    error: {
        code: 21,
        message: 'Rate limit exceeded',
    },
};
