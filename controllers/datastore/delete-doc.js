const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const KnowledgeBaseService = require('../../services/datastore/knowledgeBaseService');

/**
 * @namespace -KnowledgeBase-
 * @description API related to Knowledge Base operations.
 */

/**
 * @memberof -KnowledgeBase-
 * @name deleteDocument
 * @path {DELETE} /api/datastore/delete-document
 * @description Deletes a document from BigQuery and Cloud Storage based on its name.
 * @body {string} document_name - The name of the document to delete.
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Document deleted successfully.
 * @response {object} metadata.data - Details of the delete operation.
 * @code {200} if the msg is success, the API returns the delete details.
 */

const validationSchema = {
  type: 'object',
  required: ['documentNames'],
  properties: {
    documentNames: { type: 'array' },
  },
};

const validation = (req, res, next) => {
  return validationOfAPI(req, res, next, validationSchema, 'body');
};

router.post('/delete-document', validation, async (req, res) => {
  try {
    const { documentNames } = req.body;
    const result = await KnowledgeBaseService.deleteDocument(documentNames);
    res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: result });
  } catch (err) {
    console.error('Error deleting document from knowledge base', err);
    res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err.message || err,
    });
  }
});

module.exports = router;
