/**
 * Verify materialize + snapshot image preservation with a live search hint.
 * Never prints credentials.
 *
 * Run: node scripts/probe-food-image-materialize.mjs
 */
import 'dotenv/config';
import mongoose from 'mongoose';

import {
  resetFatSecretTokenCache,
  searchFoods,
} from '../src/integrations/fatsecret/fatsecret.client.js';
import {
  extractSearchFoods,
  mapSearchFoodToFitlyFood,
} from '../src/integrations/fatsecret/fatsecret.mapper.js';
import { buildFoodSnapshot } from '../src/modules/foods/food.helpers.js';
import foodService from '../src/modules/foods/food.service.js';
import Food from '../src/modules/foods/food.model.js';
import { FATSECRET_PROVIDER } from '../src/modules/foods/food.constants.js';

async function main() {
  resetFatSecretTokenCache();
  await mongoose.connect(process.env.APP_DB_URL);

  const { json } = await searchFoods({
    query: 'Banana',
    pageNumber: 0,
    maxResults: 3,
    foodType: 'generic',
    includeImages: true,
  });
  const mapped = extractSearchFoods(json).map(mapSearchFoodToFitlyFood).filter(Boolean);
  const withImage = mapped.find((f) => f.image?.url || f.image?.thumbnailUrl);
  if (!withImage?.source?.externalId) {
    throw new Error('No search hit with image for Banana');
  }

  const externalId = withImage.source.externalId;
  const imageHint = withImage.image;
  console.log(
    JSON.stringify({
      externalId,
      searchHasImage: true,
      urlHost: new URL(imageHint.url || imageHint.thumbnailUrl).hostname,
    })
  );

  // Use a throwaway trainer ObjectId for canReadFood (system foods are readable).
  const trainerId = new mongoose.Types.ObjectId().toString();
  const imageByExternalId = new Map([[externalId, imageHint]]);
  const { foods } = await foodService.materializeExternalFoods([externalId], trainerId, {
    imageByExternalId,
  });
  const publicFood = foods[0];
  const doc = await Food.findOne({
    'source.externalProvider': FATSECRET_PROVIDER,
    'source.externalId': externalId,
  }).lean();

  const snapshot = buildFoodSnapshot(doc);
  console.log(
    JSON.stringify({
      materializedPublicHasImage: Boolean(publicFood?.image?.url || publicFood?.image?.thumbnailUrl),
      mongoHasImage: Boolean(doc?.image?.url || doc?.image?.thumbnailUrl),
      snapshotHasImage: Boolean(snapshot?.image?.url || snapshot?.image?.thumbnailUrl),
      foodId: String(doc?._id || ''),
    })
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('PROBE_FAILED', err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
