const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const KnowledgeBaseService = require('../../services/datastore/knowledgeBaseService');
const validationOfAPI = require('../../middlewares/validation');

/**
 * @namespace -KnowledgeBase-
 * @description API related to Knowledge Base operations.
 */

/**
 * @memberof -KnowledgeBase-
 * @name getActiveDocuments
 * @path {GET} /api/datastore/documents
 * @description Retrieves all documents with status 'Active' from the knowledge base.
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Documents retrieved successfully.
 * @response {object} metadata.data - Array of active documents.
 * @code {200} If the msg is 'Success', the API returns the documents.
 * @code {500} If there is a server error during the retrieval process.
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

router.get('/get-documents', validation, async (req, res) => {
  try {
    const documents = await KnowledgeBaseService.getDocuments();
    const refreshStatus = await KnowledgeBaseService.needsCrawling();

    res.sendJson({
      type: __constants.RESPONSE_MESSAGES.SUCCESS,
      data: documents,
      refreshButtonEnabled: refreshStatus,
    });
  } catch (err) {
    console.error('Error retrieving documents from knowledge base:', err);
    res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err.message || err,
    });
  }
});

module.exports = router;
