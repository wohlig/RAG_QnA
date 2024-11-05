const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const KnowledgeBaseService = require('../../services/datastore/knowledgeBaseService');
const multer = require('multer');

// Configure multer for file uploads (you can adjust the destination as needed)
const upload = multer({ dest: 'uploads/' });

/**
 * @namespace -KnowledgeBase-
 * @description API related to Knowledge Base operations.
 */

/**
 * @memberof -KnowledgeBase-
 * @name addDocument
 * @path {POST} /api/datastore/add-document
 * @description Business Logic :- Add new document(s) to the knowledge base with accompanying text data.
 * @body {file} documents - One or multiple documents to upload.
 * @body {string} last_updated_by - Name of the person who last updated the document(s).
 * @body {string} type - Type or category of the document(s).
 * @response {string} ContentType=application/json - Response content type.
 * @response {string} metadata.msg=Success - Documents added successfully.
 * @response {object} metadata.data - Details of the added documents.
 * @code {200} if the msg is success, the API returns the added documents' details.
 * @author Bilal
 * *** Last-Updated :- Bilal, 22nd September 2024 ***
 */

// Since we're handling multipart/form-data, adjust the validation accordingly
const validationSchema = {
  type: 'object',
  required: ['last_updated_by', 'type'],
  properties: {
    last_updated_by: { type: 'string' },
    type: { type: 'string' },
  },
};

const validation = (req, res, next) => {
  return validationOfAPI(req, res, next, validationSchema, 'body');
};

// Update the route to handle file uploads and text data
router.post('/add-document', upload.array('documents'), validation, async (req, res) => {
  try {
    const files = req.files; // Array of uploaded files
    const data = req.body; // Text data from the request body

    // Ensure that files were uploaded
    if (!files || files.length === 0) {
      return res.status(400).sendJson({
        type: __constants.RESPONSE_MESSAGES.BAD_REQUEST,
        err: 'No files were uploaded.',
      });
    }

    // Call the service to handle adding documents
    const addedDocuments = await KnowledgeBaseService.addDocument(files, data);

    res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: addedDocuments });
  } catch (err) {
    console.error('Error adding documents to knowledge base', err);
    res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err.message || err,
    });
  }
});

module.exports = router;
