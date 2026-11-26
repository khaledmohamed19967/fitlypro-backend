import contactService from './contact.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { ApiResponse } from '../../utils/ApiResponse.js';

/**
 * @desc    Submit a public Contact Us message
 * @route   POST /api/v1/contact
 * @access  Public
 */
export const createContactMessage = asyncHandler(async (req, res) => {
    const result = await contactService.createContactMessage(req.body, req);

    const message = result.emailDelivered
        ? 'Your message has been sent successfully.'
        : 'Your message has been received successfully.';

    res.status(201).json(
        new ApiResponse(
            201,
            {
                id: result.id,
                emailDelivered: result.emailDelivered,
                emailSkipped: result.emailSkipped,
            },
            message
        )
    );
});
