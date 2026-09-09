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

export const TOKEN_RESPONSE = {
    access_token: 'test-token',
    token_type: 'Bearer',
    expires_in: 86400,
};

export const SEARCH_RESPONSE_V5 = {
    foods_search: {
        max_results: '20',
        total_results: '2',
        page_number: '0',
        food: [GENERIC_CHICKEN_SEARCH, BRANDED_SEARCH],
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
