import mongoose from 'mongoose';
import {
    CONTACT_EMAIL_STATUSES,
    CONTACT_EMAIL_MAX,
    CONTACT_FULL_NAME_MAX,
    CONTACT_FULL_NAME_MIN,
    CONTACT_MESSAGE_MAX,
    CONTACT_MESSAGE_MIN,
    CONTACT_MESSAGE_STATUSES,
} from './contact.constants.js';

/**
 * Public Contact Us inquiry captured from the landing page.
 */
const contactMessageSchema = new mongoose.Schema(
    {
        fullName: {
            type: String,
            required: [true, 'Full name is required'],
            trim: true,
            minlength: [
                CONTACT_FULL_NAME_MIN,
                `Full name must be at least ${CONTACT_FULL_NAME_MIN} characters`,
            ],
            maxlength: [
                CONTACT_FULL_NAME_MAX,
                `Full name cannot exceed ${CONTACT_FULL_NAME_MAX} characters`,
            ],
        },
        email: {
            type: String,
            required: [true, 'Email is required'],
            trim: true,
            lowercase: true,
            maxlength: [
                CONTACT_EMAIL_MAX,
                `Email cannot exceed ${CONTACT_EMAIL_MAX} characters`,
            ],
        },
        message: {
            type: String,
            required: [true, 'Message is required'],
            trim: true,
            minlength: [
                CONTACT_MESSAGE_MIN,
                'Message is required',
            ],
            maxlength: [
                CONTACT_MESSAGE_MAX,
                `Message cannot exceed ${CONTACT_MESSAGE_MAX} characters`,
            ],
        },
        status: {
            type: String,
            required: true,
            enum: {
                values: CONTACT_MESSAGE_STATUSES,
                message: 'Status must be new, read, or archived',
            },
            default: 'new',
            index: true,
        },
        emailStatus: {
            type: String,
            required: true,
            enum: {
                values: CONTACT_EMAIL_STATUSES,
                message: 'Email status must be pending, sent, failed, or skipped',
            },
            default: 'pending',
        },
        emailError: {
            type: String,
            default: null,
            maxlength: [500, 'Email error cannot exceed 500 characters'],
        },
        /** SHA-256 hex of client IP (+ optional salt) for rate limiting — never raw IP. */
        ipHash: {
            type: String,
            required: true,
            index: true,
            maxlength: [64, 'IP hash cannot exceed 64 characters'],
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ ipHash: 1, createdAt: -1 });

const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);

export default ContactMessage;
