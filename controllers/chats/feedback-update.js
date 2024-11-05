const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const ChatsFeedbackService = require('../../services/bigquery/chatsFeedbackService');

/**
 * @namespace -Feedback-Module-
 * @description API related to updating feedback for chats.
 */

/**
 * @memberof -Feedback-Module-
 * @name updateFeedback
 * @path {POST} /api/chats/feedback/update
 * @description Business Logic :- Update feedback for a specific chat by ID
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Response received successfully.
 * @response {string} metadata.data - It will return the updated chat ID.
 * @code {200} if the msg is success the api updates the feedback.
 * @author Samay
 * *** Last-Updated :- Samay, 29rd September 2024 ***
 */

const validationSchema = {
    type: 'object',
    required: true,
    properties: {
        chatId: { type: 'string', required: true },
        feedback: { type: 'integer', required: true },
        description: { type: 'string', required: false }
    }
}

const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body')
}

router.post('/feedback/update', validation, async (req, res) => {
    try {
        const { chatId, feedback, description } = req.body;
        await ChatsFeedbackService.updateFeedback(chatId, feedback, description);
        res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, updatedId: chatId });
    } catch (err) {
        console.log('Error updating feedback', err);
        res.sendJson({
            type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
            err: err.err || err
        });
    }
});

module.exports = router;
