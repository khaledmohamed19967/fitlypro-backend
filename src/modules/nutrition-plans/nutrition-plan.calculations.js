/**
 * Nutrition Plan — macro calculation utilities (pure functions)
 */

import { GRAM_WEIGHT_REQUIRED_UNITS } from '../foods/food.constants.js';

const ZERO_MACROS = Object.freeze({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
});

/**
 * @param {number} quantity
 * @param {'g'|'kg'|'ml'|'l'|'piece'|'serving'} unit
 * @param {{ gramWeight?: number|null }} [defaultServing]
 * @returns {{ grams: number|null, error?: string }}
 */
export const convertQuantityToGrams = (quantity, unit, defaultServing = {}) => {
    if (quantity == null || quantity <= 0) {
        return { grams: null, error: 'Quantity must be greater than 0' };
    }

    switch (unit) {
        case 'g':
            return { grams: quantity };
        case 'kg':
            return { grams: quantity * 1000 };
        case 'ml':
            return { grams: quantity };
        case 'l':
            return { grams: quantity * 1000 };
        case 'piece':
        case 'serving': {
            const gramWeight = defaultServing?.gramWeight;
            if (gramWeight == null || gramWeight <= 0) {
                return {
                    grams: null,
                    error: 'Food defaultServing.gramWeight is required for piece/serving units',
                };
            }
            return { grams: quantity * gramWeight };
        }
        default:
            return { grams: null, error: `Unsupported unit: ${unit}` };
    }
};

/**
 * Validate PlanFoodItem unit against food snapshot/defaultServing.
 *
 * @param {number} quantity
 * @param {string} unit
 * @param {{ defaultServing?: { gramWeight?: number|null } }} [foodSnapshot]
 * @returns {{ valid: boolean, message?: string, field?: string }}
 */
export const validatePlanFoodItemUnit = (quantity, unit, foodSnapshot = {}) => {
    if (quantity == null || quantity <= 0) {
        return {
            valid: false,
            field: 'quantity',
            message: 'Quantity must be greater than 0',
        };
    }

    if (!unit) {
        return { valid: false, field: 'unit', message: 'Unit is required' };
    }

    const defaultServing = foodSnapshot.defaultServing ?? {};
    const conversion = convertQuantityToGrams(quantity, unit, defaultServing);

    if (conversion.error) {
        return {
            valid: false,
            field: GRAM_WEIGHT_REQUIRED_UNITS.includes(unit)
                ? 'defaultServing.gramWeight'
                : 'unit',
            message: conversion.error,
        };
    }

    return { valid: true };
};

/**
 * @param {{ calories?: number, protein?: number, carbs?: number, fat?: number }} nutritionPer100g
 * @param {number} grams
 * @returns {{ calories: number, protein: number, carbs: number, fat: number }}
 */
export const calculateItemMacros = (nutritionPer100g = {}, grams = 0) => {
    if (!grams || grams <= 0) {
        return { ...ZERO_MACROS };
    }

    const factor = grams / 100;

    return {
        calories: (nutritionPer100g.calories ?? 0) * factor,
        protein: (nutritionPer100g.protein ?? 0) * factor,
        carbs: (nutritionPer100g.carbs ?? 0) * factor,
        fat: (nutritionPer100g.fat ?? 0) * factor,
    };
};

/**
 * @param {{ calories?: number, protein?: number, carbs?: number, fat?: number }} a
 * @param {{ calories?: number, protein?: number, carbs?: number, fat?: number }} b
 */
export const sumMacros = (a, b) => ({
    calories: (a.calories ?? 0) + (b.calories ?? 0),
    protein: (a.protein ?? 0) + (b.protein ?? 0),
    carbs: (a.carbs ?? 0) + (b.carbs ?? 0),
    fat: (a.fat ?? 0) + (b.fat ?? 0),
});

/**
 * @param {{ quantity: number, unit: string, foodSnapshot?: object }} foodItem
 * @returns {{ calories: number, protein: number, carbs: number, fat: number }}
 */
export const calculateFoodItemMacros = (foodItem) => {
    const snapshot = foodItem?.foodSnapshot ?? {};
    const nutritionPer100g = snapshot.nutritionPer100g ?? {};
    const conversion = convertQuantityToGrams(
        foodItem.quantity,
        foodItem.unit,
        snapshot.defaultServing
    );

    if (conversion.grams == null) {
        return { ...ZERO_MACROS };
    }

    return calculateItemMacros(nutritionPer100g, conversion.grams);
};

/**
 * @param {object[]} foodItems
 * @returns {{ calories: number, protein: number, carbs: number, fat: number }}
 */
export const calculateMealTotals = (foodItems = []) => {
    if (!Array.isArray(foodItems) || foodItems.length === 0) {
        return { ...ZERO_MACROS };
    }

    return foodItems.reduce(
        (totals, item) => sumMacros(totals, calculateFoodItemMacros(item)),
        { ...ZERO_MACROS }
    );
};

/**
 * @param {object[]} meals
 * @returns {{ calories: number, protein: number, carbs: number, fat: number }}
 */
export const calculateDailyTotals = (meals = []) => {
    if (!Array.isArray(meals) || meals.length === 0) {
        return { ...ZERO_MACROS };
    }

    return meals.reduce(
        (totals, meal) => sumMacros(totals, calculateMealTotals(meal.foodItems)),
        { ...ZERO_MACROS }
    );
};

/**
 * Average daily macros across configured nutrition days.
 *
 * @param {object[]} nutritionDays
 * @returns {{
 *   avgDailyCalories: number,
 *   avgDailyProtein: number,
 *   avgDailyCarbs: number,
 *   avgDailyFat: number
 * }}
 */
export const calculatePlanComputedMacros = (nutritionDays = []) => {
    if (!Array.isArray(nutritionDays) || nutritionDays.length === 0) {
        return {
            avgDailyCalories: 0,
            avgDailyProtein: 0,
            avgDailyCarbs: 0,
            avgDailyFat: 0,
        };
    }

    const dayTotals = nutritionDays.map((day) => calculateDailyTotals(day?.meals));

    const sums = dayTotals.reduce((acc, totals) => sumMacros(acc, totals), { ...ZERO_MACROS });

    const count = nutritionDays.length;

    return {
        avgDailyCalories: sums.calories / count,
        avgDailyProtein: sums.protein / count,
        avgDailyCarbs: sums.carbs / count,
        avgDailyFat: sums.fat / count,
    };
};
