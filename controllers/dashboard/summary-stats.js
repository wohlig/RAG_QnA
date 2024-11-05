const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const ChatsFeedbackService = require('../../services/bigquery/chatsFeedbackService');

/**
 * @namespace -Dashboard-Stats-
 * @description API related to Dashboard Summary Statistics.
 */

/**
 * @memberof -Dashboard-Stats-
 * @name getSummaryStats
 * @path {GET} /api/dashboard/summary-stats
 * @description Business Logic :- Fetch summary statistics for the dashboard
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Response received successfully.
 * @response {string} metadata.data - It will return the summary statistics.
 * @code {200} if the msg is success the api returns the summary stats.
 * @author Samay
 * *** Last-Updated :- Samay, 29rd September 2024 ***
 */

const validationSchema = {
    type: 'object',
    required: true,
    properties: {}
}

const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body')
}

router.post('/summary-stats', validation, async (req, res) => {
    try {
        const stats = await ChatsFeedbackService.getSummaryStats(req.body.start_time, req.body.end_time);
        res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: stats });
    } catch (err) {
        console.log('Error fetching summary stats', err);
        res.sendJson({
            type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
            err: err.err || err
        });
    }
});

module.exports = router;
