import express from 'express';
import { getPublicExercise, listPublicExercises } from './exercise.public.controller.js';

/**
 * Public Exercise Library — read-only Fitly system catalog.
 * No auth. Never returns trainer-owned exercises.
 */
const router = express.Router();

router.get('/', listPublicExercises);
router.get('/:idOrSlug', getPublicExercise);

export default router;
