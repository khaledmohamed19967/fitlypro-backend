import express from 'express';
import userRoutes from '../modules/users/user.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import clientRoutes from '../modules/clients/client.routes.js';

const router = express.Router();

/**
 * Main Routes Configuration
 */

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'API is running',
        timestamp: new Date().toISOString(),
    });
});

// Module routes
router.use('/users', userRoutes);
router.use('/auth', authRoutes);
router.use('/clients', clientRoutes);

// Add more module routes here
// router.use('/workouts', workoutRoutes);
// router.use('/nutrition', nutritionRoutes);

export default router;
