/**
 * Live FatSecret + Mongo food-image audit probe.
 * Never prints credentials or tokens.
 *
 * Run: node scripts/probe-food-images-live.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import {
  resetFatSecretTokenCache,
  searchFoods,
  getFoodById,
} from '../src/integrations/fatsecret/fatsecret.client.js';
import {
  extractSearchFoods,
  extractFoodGetPayload,
  mapProductImage,
  mapSearchFoodToFitlyFood,
  mapFatSecretFoodToFitlyFood,
} from '../src/integrations/fatsecret/fatsecret.mapper.js';
import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';

const QUERIES = [
  { label: 'Egg', query: 'Egg', foodType: 'generic' },
  { label: 'Banana', query: 'Banana', foodType: 'generic' },
  { label: 'Chicken Breast', query: 'Chicken Breast', foodType: 'generic' },
  { label: 'Whole Milk', query: 'Whole Milk', foodType: 'generic' },
  { label: 'Composite (Chicken Salad)', query: 'Chicken Salad', foodType: 'generic' },
  { label: 'Branded (Coca Cola)', query: 'Coca Cola', foodType: 'brand' },
];

function summarizeImage(image) {
  if (!image?.url && !image?.thumbnailUrl) return { hasImage: false };
  return {
    hasImage: true,
    urlHost: safeHost(image.url),
    thumbHost: safeHost(image.thumbnailUrl),
  };
}

function safeHost(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

async function probeSearch(entry) {
  const { json, method, scope } = await searchFoods({
    query: entry.query,
    pageNumber: 0,
    maxResults: 5,
    foodType: entry.foodType,
    includeImages: true,
  });
  const foods = extractSearchFoods(json);
  const mapped = foods.map(mapSearchFoodToFitlyFood).filter(Boolean);
  const withImages = mapped.filter((f) => f.image?.url || f.image?.thumbnailUrl);
  const first = mapped[0] || null;
  const rawFirst = foods[0] || null;
  const rawImageAttrs = rawFirst
    ? Boolean(rawFirst.food_images?.food_image || rawFirst.food_image)
    : false;

  let detailImage = null;
  let detailHasRawImages = false;
  if (first?.source?.externalId) {
    try {
      const detailJson = await getFoodById(first.source.externalId);
      const detailFood = extractFoodGetPayload(detailJson);
      detailHasRawImages = Boolean(
        detailFood?.food_images?.food_image || detailFood?.food_image
      );
      const detailMapped = mapFatSecretFoodToFitlyFood(detailFood);
      detailImage = summarizeImage(detailMapped?.image);
    } catch (err) {
      detailImage = { hasImage: false, error: err?.message || 'detail-failed' };
    }
  }

  return {
    label: entry.label,
    query: entry.query,
    foodType: entry.foodType,
    method,
    scope,
    resultCount: mapped.length,
    withImages: withImages.length,
    firstName: first?.name || null,
    firstType: first?.type || null,
    searchRawHasImageAttrs: rawImageAttrs,
    searchMappedImage: summarizeImage(first?.image),
    detailRawHasImageAttrs: detailHasRawImages,
    detailMappedImage: detailImage,
  };
}

async function probeMongo() {
  const total = await Food.countDocuments({});
  const withAnyImage = await Food.countDocuments({
    $or: [
      { 'image.url': { $type: 'string', $ne: '' } },
      { 'image.thumbnailUrl': { $type: 'string', $ne: '' } },
    ],
  });
  const missingImage = total - withAnyImage;

  const plans = await NutritionPlan.countDocuments({});
  const plansWithSnapshotImage = await NutritionPlan.countDocuments({
    $or: [
      { 'nutritionDays.meals.foodItems.foodSnapshot.image.url': { $type: 'string', $ne: '' } },
      {
        'nutritionDays.meals.foodItems.foodSnapshot.image.thumbnailUrl': {
          $type: 'string',
          $ne: '',
        },
      },
    ],
  });

  // Sample whether foodSnapshot schema currently stores image at all (field presence).
  const samplePlan = await NutritionPlan.findOne({
    'nutritionDays.meals.foodItems.0': { $exists: true },
  })
    .select('nutritionDays.meals.foodItems.foodSnapshot')
    .lean();

  let snapshotHasImageKey = false;
  let snapshotSampleName = null;
  outer: for (const day of samplePlan?.nutritionDays || []) {
    for (const meal of day.meals || []) {
      for (const item of meal.foodItems || []) {
        if (item?.foodSnapshot) {
          snapshotSampleName = item.foodSnapshot.name || null;
          snapshotHasImageKey = Object.prototype.hasOwnProperty.call(
            item.foodSnapshot,
            'image'
          );
          break outer;
        }
      }
    }
  }

  return {
    foods: { total, withAnyImage, missingImage },
    plans: { total: plans, withSnapshotImage: plansWithSnapshotImage },
    snapshotSample: { name: snapshotSampleName, hasImageKey: snapshotHasImageKey },
  };
}

async function main() {
  console.log('=== Live FatSecret food image probe ===');
  console.log(
    `Config present: clientId=${Boolean(process.env.FATSECRET_CLIENT_ID)} secret=${Boolean(
      process.env.FATSECRET_CLIENT_SECRET
    )} scope=${process.env.FATSECRET_SCOPE || '(unset)'} db=${Boolean(process.env.APP_DB_URL)}`
  );

  resetFatSecretTokenCache();

  const searchResults = [];
  for (const entry of QUERIES) {
    try {
      const row = await probeSearch(entry);
      searchResults.push(row);
      console.log(JSON.stringify(row));
    } catch (err) {
      const fail = {
        label: entry.label,
        ok: false,
        error: err?.message || String(err),
        fatsecretCode: err?.fatsecretCode ?? null,
      };
      searchResults.push(fail);
      console.log(JSON.stringify(fail));
    }
  }

  console.log('=== Mongo food image counts ===');
  try {
    await mongoose.connect(process.env.APP_DB_URL);
    const mongo = await probeMongo();
    console.log(JSON.stringify(mongo));
  } catch (err) {
    console.log(JSON.stringify({ mongoError: err?.message || String(err) }));
  } finally {
    await mongoose.disconnect().catch(() => {});
  }

  const anySearchImage = searchResults.some((r) => r.searchMappedImage?.hasImage);
  const anyDetailImage = searchResults.some((r) => r.detailMappedImage?.hasImage);
  console.log(
    JSON.stringify({
      summary: {
        anySearchImage,
        anyDetailImage,
        includeFoodImagesExpected: true,
      },
    })
  );
}

main().catch((err) => {
  console.error('PROBE_FAILED', err?.message || err);
  process.exitCode = 1;
});
