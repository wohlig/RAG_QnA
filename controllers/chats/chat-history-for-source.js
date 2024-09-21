const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const ChatsFeedbackService = require('../../services/bigquery/chatsFeedbackService');

/**
 * @namespace -Chat-History-Module-
 * @description API to fetch chat history for a given source.
 */

/**
 * @memberof -Chat-History-Module-
 * @name getChatHistoryBySource
 * @path {POST} /api/chats/history
 * @description Business Logic :- Fetch the chat history for a given source
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Response received successfully.
 * @response {string} metadata.data - It will return the list of chat history for the given source.
 * @code {200} if the msg is success the api returns the chat history for the provided source.
 * @author Samay
 * *** Last-Updated :- Samay, 21st September 2024 ***
 */

const validationSchema = {
    type: 'object',
    required: true,
    properties: {
        source: { type: 'string', required: true }
    }
};

const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body');
};

router.post('/history', validation, async (req, res) => {
    try {
        const { source } = req.body;
        const chatHistory = await ChatsFeedbackService.getChatHistoryBySource(source);
        res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: chatHistory });
    } catch (err) {
        console.log('Error fetching chat history:', err);
        res.sendJson({
            type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
            err: err.err || err
        });
    }
});

module.exports = router;
