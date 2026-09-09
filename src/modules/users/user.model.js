import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../../config/index.js';

/**
 * User Schema Definition
 */
const userSchema = new mongoose.Schema(
    {
        firstName: {
            type: String,
            required: [true, 'First name is required'],
            trim: true,
            minlength: [2, 'First name must be at least 2 characters'],
            maxlength: [50, 'First name cannot exceed 50 characters'],
        },
        lastName: {
            type: String,
            required: [true, 'Last name is required'],
            trim: true,
            minlength: [2, 'Last name must be at least 2 characters'],
            maxlength: [50, 'Last name cannot exceed 50 characters'],
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            lowercase: true,
            trim: true,
            match: [
                /^\w+([-.]?\w+)*@\w+([-.]?\w+)*(\.\w{2,3})+$/,
                'Please provide a valid email address',
            ],
        },
        password: {
            type: String,
            required: [true, 'Password is required'],
            minlength: [6, 'Password must be at least 6 characters'],
            select: false, // Don't include password in queries by default
        },
        phone: {
            type: String,
            trim: true,
            match: [/^[0-9]{10,15}$/, 'Please provide a valid phone number'],
        },
        dateOfBirth: {
            type: Date,
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other'],
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        role: {
            type: String,
            enum: ['client', 'trainer', 'admin'],
            default: 'client',
        },
        trainer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },

        // === FITNESS INFORMATION (Optional - for clients) ===
        primaryFitnessGoal: {
            type: String,
            enum: [
                'weight_loss',
                'muscle_gain',
                'general_fitness',
                'endurance',
                'strength',
                'flexibility',
                'sports_performance',
                'rehabilitation',
            ],
        },
        currentWeight: {
            type: Number,
            min: [20, 'Current weight must be at least 20 kg'],
            max: [300, 'Current weight cannot exceed 300 kg'],
        },
        targetWeight: {
            type: Number,
            min: [20, 'Target weight must be at least 20 kg'],
            max: [300, 'Target weight cannot exceed 300 kg'],
        },
        height: {
            type: Number,
            min: [50, 'Height must be at least 50 cm'],
            max: [250, 'Height cannot exceed 250 cm'],
        },
        experienceLevel: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced', 'expert'],
        },

        // === PROGRAM DETAILS (Optional - for clients) ===
        programType: {
            type: String,
            enum: [
                'personal_training',
                'group_training',
                'online_coaching',
                'nutrition_only',
                'hybrid',
            ],
        },
        sessionsPerWeek: {
            type: Number,
            min: [1, 'Sessions per week must be at least 1'],
            max: [7, 'Sessions per week cannot exceed 7'],
        },
        startDate: {
            type: Date,
        },
        packageDuration: {
            type: String,
            enum: ['1_month', '3_months', '6_months', '12_months', 'ongoing'],
        },
        endDate: {
            type: Date,
        },

        // === ADDITIONAL INFORMATION (Optional - for clients) ===
        additionalNotes: {
            type: String,
            maxlength: [1000, 'Additional notes cannot exceed 1000 characters'],
        },
        medicalConditions: {
            type: String,
            maxlength: [500, 'Medical conditions cannot exceed 500 characters'],
        },
        injuries: {
            type: String,
            maxlength: [500, 'Injuries cannot exceed 500 characters'],
        },

        // === PROGRESS TRACKING (Optional - for clients) ===
        progressNotes: [
            {
                date: {
                    type: Date,
                    default: Date.now,
                },
                weight: Number,
                notes: String,
                recordedBy: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'User',
                },
            },
        ],
    },
    {
        timestamps: true, // Adds createdAt and updatedAt automatically
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// Pre-save hook to hash password
// Pre-save hook to hash password
userSchema.pre('save', async function () {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) {
        return;
    }

    // Generate salt and hash password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Virtual field for full name
userSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Virtual field for BMI calculation
userSchema.virtual('bmi').get(function () {
    if (this.currentWeight && this.height) {
        const heightInMeters = this.height / 100;
        return (this.currentWeight / (heightInMeters * heightInMeters)).toFixed(2);
    }
    return null;
});

// Virtual field for weight difference
userSchema.virtual('weightDifference').get(function () {
    if (this.currentWeight && this.targetWeight) {
        return (this.currentWeight - this.targetWeight).toFixed(2);
    }
    return null;
});

// Index for better query performance (email index comes from unique: true above)
userSchema.index({ createdAt: -1 });
userSchema.index({ trainer: 1 }); // Index for trainer queries

// Instance method to compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('Password comparison failed');
    }
};

// Instance method to generate JWT token
userSchema.methods.generateAuthToken = function () {
    const payload = {
        id: this._id,
        email: this.email,
        role: this.role,
    };

    return jwt.sign(payload, config.jwt.secret, {
        expiresIn: config.jwt.expiresIn,
    });
};

// Instance method to get public profile
userSchema.methods.getPublicProfile = function () {
    return {
        id: this._id,
        fullName: this.fullName,
        firstName: this.firstName,
        lastName: this.lastName,
        email: this.email,
        role: this.role,
        phone: this.phone,
        gender: this.gender,
        dateOfBirth: this.dateOfBirth,
        isActive: this.isActive,
        trainer: this.trainer,
        // Fitness data (optional, for clients)
        primaryFitnessGoal: this.primaryFitnessGoal,
        currentWeight: this.currentWeight,
        targetWeight: this.targetWeight,
        height: this.height,
        bmi: this.bmi,
        weightDifference: this.weightDifference,
        experienceLevel: this.experienceLevel,
        programType: this.programType,
        sessionsPerWeek: this.sessionsPerWeek,
        startDate: this.startDate,
        packageDuration: this.packageDuration,
        endDate: this.endDate,
        additionalNotes: this.additionalNotes,
        medicalConditions: this.medicalConditions,
        injuries: this.injuries,
        progressNotes: this.progressNotes,
        createdAt: this.createdAt,
        updatedAt: this.updatedAt,
    };
};

// Instance method to add progress note
userSchema.methods.addProgressNote = function (weight, notes, recordedBy) {
    this.progressNotes.push({
        weight,
        notes,
        recordedBy,
        date: new Date(),
    });
    return this.save();
};

// Static method to find user by email
userSchema.statics.findByEmail = function (email) {
    return this.findOne({ email: email.toLowerCase() });
};

const User = mongoose.model('User', userSchema);

export default User;
