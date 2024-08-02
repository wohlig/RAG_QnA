const express = require('express');
const router = express.Router();
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');
const PineconeService = require('../../services/pinecone/PineconeService');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const xlsx = require('xlsx');

// Function to read all sheets from Excel file
async function readExcelFile(buffer) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetsData = [];
  
  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = xlsx.utils.sheet_to_json(worksheet);
    sheetsData.push({ sheetName, data: jsonData });
  });
  
  return sheetsData;
}

const validationSchema = {
  type: 'object',
  required: true,
  properties: {
    // Define any properties for validation here
  },
};

const validation = (req, res, next) => {
  return validationOfAPI(req, res, next, validationSchema, 'body');
};

const pushExcelDataToPinecone = async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const sheetsData = await readExcelFile(fileBuffer);
    const result = await PineconeService.pushExcelDataToBigQuery(sheetsData);
    res.sendJson({ type: __constants.RESPONSE_MESSAGES.SUCCESS, data: result });
  } catch (err) {
    console.log('pushExcelDataToPinecone Error', err);
    return res.sendJson({
      type: err.type || __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.err || err,
    });
  }
};

router.post('/pushExcelToPinecone', upload.single('file'), validation, pushExcelDataToPinecone);

module.exports = router;
