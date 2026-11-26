/**
 * Verify foodSnapshot image survives NutritionPlan document save/load.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Food from '../src/modules/foods/food.model.js';
import NutritionPlan from '../src/modules/nutrition-plans/nutrition-plan.model.js';
import { buildFoodSnapshot } from '../src/modules/foods/food.helpers.js';
import { FATSECRET_PROVIDER } from '../src/modules/foods/food.constants.js';

async function main() {
  await mongoose.connect(process.env.APP_DB_URL);

  const food = await Food.findOne({
    'source.externalProvider': FATSECRET_PROVIDER,
    'source.externalId': '35755',
    'image.url': { $type: 'string', $ne: '' },
  });
  if (!food) throw new Error('Expected Banana food with image (externalId 35755)');

  const snapshot = buildFoodSnapshot(food);
  if (!snapshot?.image?.url && !snapshot?.image?.thumbnailUrl) {
    throw new Error('buildFoodSnapshot missing image');
  }

  const trainerId = new mongoose.Types.ObjectId();
  const plan = await NutritionPlan.create({
    trainerId,
    ownership: { type: 'trainer', trainerId },
    name: `Image Roundtrip ${Date.now()}`,
    status: 'draft',
    goal: 'maintenance',
    duration: 1,
    daysCount: 1,
    macroTargets: { calories: 2000, protein: 150, carbs: 200, fat: 70 },
    nutritionDays: [
      {
        dayNumber: 1,
        name: 'Day 1',
        meals: [
          {
            order: 1,
            name: 'Meal 1',
            foodItems: [
              {
                foodId: food._id,
                order: 1,
                quantity: 1,
                unit: 'serving',
                foodSnapshot: snapshot,
              },
            ],
          },
        ],
      },
    ],
  });

  const reloaded = await NutritionPlan.findById(plan._id).lean();
  const savedSnap =
    reloaded?.nutritionDays?.[0]?.meals?.[0]?.foodItems?.[0]?.foodSnapshot;
  const ok = Boolean(savedSnap?.image?.url || savedSnap?.image?.thumbnailUrl);

  console.log(
    JSON.stringify({
      roundtripOk: ok,
      imageHost: ok
        ? new URL(savedSnap.image.url || savedSnap.image.thumbnailUrl).hostname
        : null,
      planId: String(plan._id),
    })
  );

  await NutritionPlan.deleteOne({ _id: plan._id });
  await mongoose.disconnect();
  if (!ok) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error('PROBE_FAILED', err?.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
