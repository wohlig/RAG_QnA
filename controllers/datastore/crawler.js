const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const KnowledgeBaseService = require('../../services/datastore/knowledgeBaseService');
const validationOfAPI = require('../../middlewares/validation');


/**
 * @namespace -Crawler-
 * @description API related to the crawler operations.
 */

/**
 * @memberof -Crawler-
 * @name runCrawler
 * @path {GET} /api/datastore/crawler
 * @description Triggers the crawler function to process documents in the knowledge base.
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Crawler executed successfully.
 * @response {object} metadata.data - Details of the crawler execution.
 * @code {200} If the msg is 'Success', the API returns the execution details.
 * @code {500} If there is a server error during the crawler execution.
 * @author
 * *** Last-Updated :- 22nd September 2024 ***
 */


const validationSchema = {
    type: 'object',
    required: [],
    properties: {
    },
  };
  
  const validation = (req, res, next) => {
    return validationOfAPI(req, res, next, validationSchema, 'body');
  };

router.get('/crawler', validation, async (req, res) => {
  try {
    // Call the crawler function
    await KnowledgeBaseService.crawler();

    res.sendJson({
      type: __constants.RESPONSE_MESSAGES.SUCCESS,
      data: {
        message: 'Crawler executed successfully.',
      },
    });
  } catch (err) {
    console.error('Error executing crawler:', err);
    res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err.message || err,
    });
  }
});

module.exports = router;
