import mongoose from 'mongoose';
import {
    WORKOUT_GOALS,
    WORKOUT_LEVELS,
    WORKOUT_PLAN_STATUSES,
    WEIGHT_UNITS,
    OWNERSHIP_TYPES,
    DEFAULT_WORKOUT_PLAN_ICON,
    WARMUP_ACTIVITY_TYPES,
    CARDIO_ACTIVITY_TYPES,
    ACTIVITY_INTENSITIES,
    CARDIO_PROTOCOLS,
    ACTIVITY_DURATION_MINUTES_MIN,
    ACTIVITY_DURATION_MINUTES_MAX,
    MAX_DAY_ACTIVITIES,
} from './workout-plan.constants.js';

/**
 * Lightweight exercise catalog snapshot stored on plan exercises.
 */
export const exerciseSnapshotSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Exercise snapshot name is required'],
            trim: true,
            maxlength: [120, 'Exercise snapshot name cannot exceed 120 characters'],
        },
        thumbnailUrl: {
            type: String,
            trim: true,
            default: null,
        },
    },
    { _id: false }
);

/**
 * Nested ownership subdocument.
 * Explicit Schema avoids Mongoose treating a nested `type` field as a SchemaType shortcut.
 */
const ownershipSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            required: [true, 'Ownership type is required'],
            enum: {
                values: OWNERSHIP_TYPES,
                message: 'Ownership type must be system or trainer',
            },
        },
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { _id: false }
);

/**
 * Embedded set within a plan exercise.
 */
export const exerciseSetSchema = new mongoose.Schema(
    {
        setNumber: {
            type: Number,
            required: [true, 'Set number is required'],
            min: [1, 'Set number must be at least 1'],
        },
        reps: {
            type: Number,
            min: [0, 'Reps cannot be negative'],
            default: null,
        },
        weight: {
            type: Number,
            min: [0, 'Weight cannot be negative'],
            default: null,
        },
        weightUnit: {
            type: String,
            required: [true, 'Weight unit is required'],
            enum: {
                values: WEIGHT_UNITS,
                message: 'Weight unit must be kg or lbs',
            },
            default: 'kg',
        },
        isWarmup: {
            type: Boolean,
            default: false,
        },
        isDropset: {
            type: Boolean,
            default: false,
        },
    },
    { _id: true }
);

/**
 * Embedded exercise programming row (distinct from Exercise Library catalog).
 */
export const planExerciseSchema = new mongoose.Schema(
    {
        exerciseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Exercise',
            required: [true, 'Exercise ID is required'],
        },
        order: {
            type: Number,
            required: [true, 'Exercise order is required'],
            min: [1, 'Exercise order must be at least 1'],
        },
        sets: {
            type: [exerciseSetSchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 20;
                },
                message: 'Sets cannot exceed 20 items per exercise',
            },
        },
        restBetweenSets: {
            type: Number,
            required: [true, 'Rest between sets is required'],
            min: [0, 'Rest between sets cannot be negative'],
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Exercise notes cannot exceed 500 characters'],
            default: null,
        },
        tempo: {
            type: String,
            trim: true,
            maxlength: [20, 'Tempo cannot exceed 20 characters'],
            default: null,
        },
        supersetWith: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        exerciseSnapshot: {
            type: exerciseSnapshotSchema,
            default: null,
        },
    },
    { _id: true }
);

/**
 * Display snapshot for warm-up / cardio activity rows.
 * Same lightweight shape as exerciseSnapshot for PDF/UI fallback.
 */
export const activitySnapshotSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Activity snapshot name is required'],
            trim: true,
            maxlength: [120, 'Activity snapshot name cannot exceed 120 characters'],
        },
        thumbnailUrl: {
            type: String,
            trim: true,
            default: null,
        },
    },
    { _id: false }
);

/**
 * Warm-up activity on a workout day (duration/intensity; optional Exercise link).
 */
export const warmupActivitySchema = new mongoose.Schema(
    {
        activityType: {
            type: String,
            required: [true, 'Warm-up activity type is required'],
            enum: {
                values: WARMUP_ACTIVITY_TYPES,
                message: 'Invalid warm-up activity type',
            },
        },
        order: {
            type: Number,
            required: [true, 'Warm-up activity order is required'],
            min: [1, 'Warm-up activity order must be at least 1'],
        },
        durationMinutes: {
            type: Number,
            required: [true, 'Warm-up duration is required'],
            min: [
                ACTIVITY_DURATION_MINUTES_MIN,
                `Warm-up duration must be at least ${ACTIVITY_DURATION_MINUTES_MIN} minute`,
            ],
            max: [
                ACTIVITY_DURATION_MINUTES_MAX,
                `Warm-up duration cannot exceed ${ACTIVITY_DURATION_MINUTES_MAX} minutes`,
            ],
        },
        intensity: {
            type: String,
            required: [true, 'Warm-up intensity is required'],
            enum: {
                values: ACTIVITY_INTENSITIES,
                message: 'Intensity must be low, moderate, or high',
            },
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Warm-up notes cannot exceed 500 characters'],
            default: null,
        },
        exerciseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Exercise',
            default: null,
        },
        activitySnapshot: {
            type: activitySnapshotSchema,
            required: [true, 'Warm-up activity snapshot is required'],
        },
    },
    { _id: true }
);

/**
 * Cardio activity on a workout day (duration/intensity/protocol; optional Exercise link).
 */
export const cardioActivitySchema = new mongoose.Schema(
    {
        activityType: {
            type: String,
            required: [true, 'Cardio activity type is required'],
            enum: {
                values: CARDIO_ACTIVITY_TYPES,
                message: 'Invalid cardio activity type',
            },
        },
        protocol: {
            type: String,
            required: [true, 'Cardio protocol is required'],
            enum: {
                values: CARDIO_PROTOCOLS,
                message: 'Cardio protocol must be continuous or interval',
            },
            default: 'continuous',
        },
        order: {
            type: Number,
            required: [true, 'Cardio activity order is required'],
            min: [1, 'Cardio activity order must be at least 1'],
        },
        durationMinutes: {
            type: Number,
            required: [true, 'Cardio duration is required'],
            min: [
                ACTIVITY_DURATION_MINUTES_MIN,
                `Cardio duration must be at least ${ACTIVITY_DURATION_MINUTES_MIN} minute`,
            ],
            max: [
                ACTIVITY_DURATION_MINUTES_MAX,
                `Cardio duration cannot exceed ${ACTIVITY_DURATION_MINUTES_MAX} minutes`,
            ],
        },
        intensity: {
            type: String,
            required: [true, 'Cardio intensity is required'],
            enum: {
                values: ACTIVITY_INTENSITIES,
                message: 'Intensity must be low, moderate, or high',
            },
        },
        distanceKm: {
            type: Number,
            min: [0, 'Distance cannot be negative'],
            default: null,
        },
        targetHeartRate: {
            type: Number,
            min: [0, 'Target heart rate cannot be negative'],
            default: null,
        },
        workSeconds: {
            type: Number,
            min: [0, 'Work seconds cannot be negative'],
            default: null,
        },
        recoverySeconds: {
            type: Number,
            min: [0, 'Recovery seconds cannot be negative'],
            default: null,
        },
        rounds: {
            type: Number,
            min: [0, 'Rounds cannot be negative'],
            default: null,
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Cardio notes cannot exceed 500 characters'],
            default: null,
        },
        exerciseId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Exercise',
            default: null,
        },
        activitySnapshot: {
            type: activitySnapshotSchema,
            required: [true, 'Cardio activity snapshot is required'],
        },
    },
    { _id: true }
);

/**
 * Embedded workout day within a plan.
 */
export const workoutDaySchema = new mongoose.Schema(
    {
        dayNumber: {
            type: Number,
            required: [true, 'Day number is required'],
            min: [1, 'Day number must be between 1 and 7'],
            max: [7, 'Day number must be between 1 and 7'],
        },
        name: {
            type: String,
            required: [true, 'Day name is required'],
            trim: true,
            minlength: [1, 'Day name is required'],
            maxlength: [120, 'Day name cannot exceed 120 characters'],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [2000, 'Day description cannot exceed 2000 characters'],
            default: null,
        },
        warmupActivities: {
            type: [warmupActivitySchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= MAX_DAY_ACTIVITIES;
                },
                message: `Warm-up activities cannot exceed ${MAX_DAY_ACTIVITIES} items per day`,
            },
        },
        exercises: {
            type: [planExerciseSchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 50;
                },
                message: 'Exercises cannot exceed 50 items per day',
            },
        },
        cardioActivities: {
            type: [cardioActivitySchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= MAX_DAY_ACTIVITIES;
                },
                message: `Cardio activities cannot exceed ${MAX_DAY_ACTIVITIES} items per day`,
            },
        },
    },
    { _id: true }
);

const workoutPlanSchema = new mongoose.Schema(
    {
        /**
         * Compatibility field (Phase 2).
         * Canonical ownership is `ownership`.
         * System plans: null. Trainer plans: same as ownership.trainerId.
         */
        trainerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        ownership: {
            type: ownershipSchema,
            required: [true, 'Ownership is required'],
        },
        /**
         * Stable seed identity for system templates only.
         * Null for trainer-owned plans.
         */
        templateKey: {
            type: String,
            trim: true,
            lowercase: true,
            maxlength: [64, 'Template key cannot exceed 64 characters'],
            default: null,
        },
        icon: {
            type: String,
            trim: true,
            default: DEFAULT_WORKOUT_PLAN_ICON,
        },
        name: {
            type: String,
            required: [true, 'Plan name is required'],
            trim: true,
            minlength: [2, 'Plan name must be at least 2 characters'],
            maxlength: [120, 'Plan name cannot exceed 120 characters'],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [2000, 'Description cannot exceed 2000 characters'],
            default: null,
        },
        duration: {
            type: Number,
            required: [true, 'Duration is required'],
            min: [1, 'Duration must be at least 1 week'],
        },
        daysPerWeek: {
            type: Number,
            required: [true, 'Days per week is required'],
            min: [1, 'Days per week must be between 1 and 7'],
            max: [7, 'Days per week must be between 1 and 7'],
        },
        goal: {
            type: String,
            required: [true, 'Goal is required'],
            enum: {
                values: WORKOUT_GOALS,
                message: 'Invalid workout goal',
            },
        },
        level: {
            type: String,
            required: [true, 'Level is required'],
            enum: {
                values: WORKOUT_LEVELS,
                message: 'Invalid workout level',
            },
        },
        workoutDays: {
            type: [workoutDaySchema],
            default: [],
            validate: {
                validator(value) {
                    return !value || value.length <= 7;
                },
                message: 'Workout days cannot exceed 7 items',
            },
        },
        isTemplate: {
            type: Boolean,
            required: [true, 'isTemplate is required'],
            default: false,
        },
        status: {
            type: String,
            required: [true, 'Status is required'],
            enum: {
                values: WORKOUT_PLAN_STATUSES,
                message: 'Status must be draft, active, or archived',
            },
            default: 'active',
        },
        notes: {
            type: String,
            trim: true,
            maxlength: [500, 'Plan notes cannot exceed 500 characters'],
            default: null,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

/**
 * Keep ownership + trainerId consistent.
 * ownership is canonical; trainerId is mirrored for Phase 2 compatibility.
 */
workoutPlanSchema.pre('validate', function syncOwnershipFields() {
    // Legacy Phase 2 docs: ownership missing but trainerId present
    if ((!this.ownership || !this.ownership.type) && this.trainerId) {
        this.ownership = {
            type: 'trainer',
            trainerId: this.trainerId,
        };
        return;
    }

    const ownership = this.ownership;
    if (!ownership || !ownership.type) {
        this.invalidate('ownership.type', 'Ownership type is required');
        return;
    }

    if (ownership.type === 'system') {
        if (ownership.trainerId != null) {
            this.invalidate('ownership.trainerId', 'System plans must have null ownership.trainerId');
            return;
        }
        this.trainerId = null;
        return;
    }

    if (ownership.type === 'trainer') {
        if (ownership.trainerId == null && this.trainerId != null) {
            ownership.trainerId = this.trainerId;
        }
        if (ownership.trainerId == null) {
            this.invalidate('ownership.trainerId', 'Trainer plans require ownership.trainerId');
            return;
        }
        this.trainerId = ownership.trainerId;
        if (this.templateKey) {
            this.invalidate('templateKey', 'Trainer plans cannot have a templateKey');
        }
    }
});

/**
 * Unique dayNumber within plan.
 */
workoutPlanSchema.pre('validate', function validateWorkoutDayNumbers() {
    const days = this.workoutDays;
    if (!Array.isArray(days) || days.length === 0) {
        return;
    }

    const seen = new Set();
    for (const day of days) {
        if (day?.dayNumber == null) continue;
        if (seen.has(day.dayNumber)) {
            this.invalidate('workoutDays', 'Day numbers must be unique within a plan');
            return;
        }
        seen.add(day.dayNumber);
    }
});

/**
 * Unique exercise order within each day.
 */
workoutPlanSchema.pre('validate', function validateExerciseOrders() {
    const days = this.workoutDays;
    if (!Array.isArray(days)) {
        return;
    }

    for (const day of days) {
        const exercises = day?.exercises;
        if (!Array.isArray(exercises) || exercises.length === 0) {
            continue;
        }

        const seen = new Set();
        for (const exercise of exercises) {
            if (exercise?.order == null) continue;
            if (seen.has(exercise.order)) {
                this.invalidate(
                    'workoutDays',
                    'Exercise order values must be unique within each day'
                );
                return;
            }
            seen.add(exercise.order);
        }
    }
});

/**
 * Unique warm-up / cardio activity order within each day section.
 */
workoutPlanSchema.pre('validate', function validateActivityOrders() {
    const days = this.workoutDays;
    if (!Array.isArray(days)) {
        return;
    }

    for (const day of days) {
        for (const [field, label] of [
            ['warmupActivities', 'Warm-up'],
            ['cardioActivities', 'Cardio'],
        ]) {
            const activities = day?.[field];
            if (!Array.isArray(activities) || activities.length === 0) {
                continue;
            }

            const seen = new Set();
            for (const activity of activities) {
                if (activity?.order == null) continue;
                if (seen.has(activity.order)) {
                    this.invalidate(
                        'workoutDays',
                        `${label} activity order values must be unique within each day`
                    );
                    return;
                }
                seen.add(activity.order);
            }
        }
    }
});

/**
 * Unique setNumber within each exercise.
 */
workoutPlanSchema.pre('validate', function validateSetNumbers() {
    const days = this.workoutDays;
    if (!Array.isArray(days)) {
        return;
    }

    for (const day of days) {
        const exercises = day?.exercises;
        if (!Array.isArray(exercises)) {
            continue;
        }

        for (const exercise of exercises) {
            const sets = exercise?.sets;
            if (!Array.isArray(sets) || sets.length === 0) {
                continue;
            }

            const seen = new Set();
            for (const set of sets) {
                if (set?.setNumber == null) continue;
                if (seen.has(set.setNumber)) {
                    this.invalidate(
                        'workoutDays',
                        'Set numbers must be unique within each exercise'
                    );
                    return;
                }
                seen.add(set.setNumber);
            }
        }
    }
});

workoutPlanSchema.index({ trainerId: 1, status: 1, createdAt: -1 });
workoutPlanSchema.index({ trainerId: 1, isTemplate: 1, status: 1 });
workoutPlanSchema.index({ trainerId: 1, goal: 1 });
workoutPlanSchema.index({ trainerId: 1, level: 1 });
workoutPlanSchema.index({ 'ownership.type': 1, 'ownership.trainerId': 1, status: 1, createdAt: -1 });
workoutPlanSchema.index({ 'ownership.type': 1, isTemplate: 1, status: 1 });

/**
 * System template seed identity — unique only for system templates with a key.
 */
workoutPlanSchema.index(
    { templateKey: 1 },
    {
        unique: true,
        partialFilterExpression: {
            'ownership.type': 'system',
            isTemplate: true,
            templateKey: { $type: 'string' },
        },
    }
);

const WorkoutPlan = mongoose.model('WorkoutPlan', workoutPlanSchema);

export default WorkoutPlan;
