const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const ChatsFeedbackService = require('../../services/bigquery/chatsFeedbackService');

/**
 * @namespace -Chat-Status-
 * @description API related to updating chat statuses.
 */

/**
 * @memberof -Chat-Status-
 * @name updateChatStatus
 * @path {POST} /api/chats/status/update
 * @description Business Logic :- Update the status of single or multiple chats
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Response received successfully.
 * @response {string} metadata.data - It will return the updated chat IDs.
 * @code {200} if the msg is success the api returns the updated status of the chats.
 * @author Samay
 * *** Last-Updated :- Samay, 29rd September 2024 ***
 */

const validationSchema = {
    type: 'object',
    required: true,
    properties: {
        chatIds: { type: 'array', items: { type: 'string' }, required: true },
        status: { type: 'string', required: true }
    }
}

const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body')
}

router.post('/status/update', validation, async (req, res) => {
    try {
        const { chatIds, status } = req.body;
        await ChatsFeedbackService.updateChatStatus(chatIds, status);
        res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, updatedIds: chatIds });
    } catch (err) {
        console.log('Error updating chat status', err);
        res.sendJson({
            type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
            err: err.err || err
        });
    }
});

module.exports = router;
