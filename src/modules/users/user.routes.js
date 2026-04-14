import express from 'express';
import {
    createUser,
    getAllUsers,
    getUserById,
    updateUser,
    deleteUser,
    getUserStats,
} from './user.controller.js';
import { validateUser, validateUpdateUser } from './user.validator.js';
import { validate } from '../../middlewares/validate.js';

const router = express.Router();

/**
 * User Routes
 */

// Statistics route (before :id to avoid conflict)
// router.get('/stats', getUserStats);

// CRUD routes
router
    .route('/')
    .get(getAllUsers)
    .post(validate(validateUser), createUser);

// router
//     .route('/:id')
//     .get(getUserById)
//     .put(validate(validateUpdateUser), updateUser)
//     .delete(deleteUser);

export default router;
