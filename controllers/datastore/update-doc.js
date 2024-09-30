const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const KnowledgeBaseService = require('../../services/datastore/knowledgeBaseService');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' }); // Set your upload directory

/**
 * @namespace -KnowledgeBase-
 * @description API related to Knowledge Base operations.
 */

/**
 * @memberof -KnowledgeBase-
 * @name updateDocument
 * @path {PUT} /api/datastore/update-document
 * @description Updates an existing document in the knowledge base.
 * @body {file} file - The new document file to upload.
 * @body {string} document_name - The name of the document to update.
 * @body {string} last_updated_by - Name of the person who last updated the document.
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Document updated successfully.
 * @response {object} metadata.data - Details of the updated document.
 * @code {200} If the msg is 'Success', the API returns the update details.
 * @code {404} If the document is not found.
 * @code {500} If there is a server error during the update process.
 * @author
 * *** Last-Updated :- 22nd September 2024 ***
 */

// Adjust the validation schema to include 'document_name' and 'last_updated_by'
const validationSchema = {
  type: 'object',
  required: ['lastUpdatedBy'],
  properties: {
    lastUpdatedBy: { type: 'string' },
  },
};

const validation = (req, res, next) => {
  return validationOfAPI(req, res, next, validationSchema, 'body');
};

// Update the route to handle file uploads and text data
router.post('/update-document', upload.single('file'), validation, async (req, res) => {
  try {
    const {lastUpdatedBy } = req.body;
    const file = req.file;

    if (!file) {
      return res.sendJson({
        type: __constants.RESPONSE_MESSAGES.BAD_REQUEST,
        err: 'File is required.',
      });
    }

    // Call the service to handle updating the document
    const result = await KnowledgeBaseService.updateDocument(file, lastUpdatedBy);

    if (result.rowsAffected > 0) {
      res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: result });
    } else {
      res.sendJson({
        type: __constants.RESPONSE_MESSAGES.NOT_FOUND,
        err: 'Document not found.',
      });
    }
  } catch (err) {
    console.error('Error updating document in knowledge base', err);
    res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err.message || err,
    });
  }
});

module.exports = router;
