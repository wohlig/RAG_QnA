const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const ChatsFeedbackService = require('../../services/bigquery/chatsFeedbackService');

/**
 * @namespace -Sources-Module-
 * @description API related to fetching unique sources and associated data.
 */

/**
 * @memberof -Sources-Module-
 * @name getUniqueSources
 * @path {GET} /api/sources
 * @description Business Logic :- Fetch unique sources along with the count of associated questions, average confidence, and other summary data.
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Response received successfully.
 * @response {string} metadata.data - It will return the unique sources and associated data.
 * @code {200} if the msg is success the api returns the list of sources with other fields.
 * @author Samay
 * *** Last-Updated :- Samay, 29rd September 2024 ***
 */

const validationSchema = {
    type: 'object',
    required: true,
    properties: {}
}

const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body');
}

router.post('/sources', validation, async (req, res) => {
    try {
        const sources = await ChatsFeedbackService.getUniqueSources(req.body.start_time, req.body.end_time);
        res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: sources });
    } catch (err) {
        console.log('Error fetching unique sources', err);
        res.sendJson({
            type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
            err: err.err || err
        });
    }
});

module.exports = router;
