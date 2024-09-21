const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const ChatsFeedbackService = require('../../services/bigquery/chatsFeedbackService');

/**
 * @namespace -Dashboard-Details-
 * @description API related to Dashboard Detailed Statistics.
 */

/**
 * @memberof -Dashboard-Details-
 * @name getDetailStats
 * @path {POST} /api/dashboard/detail-stats
 * @description Business Logic :- Fetch detailed statistics for a specific source from the dashboard
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Response received successfully.
 * @response {string} metadata.data - It will return the detailed statistics for the specified source.
 * @code {200} if the msg is success the api returns the detailed stats.
 * @author Samay
 * *** Last-Updated :- Samay, 29rd September 2024 ***
 */

const validationSchema = {
    type: 'object',
    required: true,
    properties: {
        source: { type: 'string', required: false }
    }
}

const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body')
}

router.post('/detail-stats', validation, async (req, res) => {
    try {
        const stats = await ChatsFeedbackService.getDetailStats(req.body.source);
        res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: stats });
    } catch (err) {
        console.log('Error fetching detail stats', err);
        res.sendJson({
            type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
            err: err.err || err
        });
    }
});

module.exports = router;
