const express = require('express');
const router = express.Router();
const { GoogleAuth } = require('google-auth-library');
const { google } = require('googleapis');
const PineconeService = require('../../services/bigquery/bigQueryService');
const __constants = require('../../config/constants');
const validationOfAPI = require('../../middlewares/validation');

const validationSchema = {
  type: 'object',
  required: true,
  properties: {
    spreadsheetId: { type: 'string' },
    sheetName: { type: 'string' },
    prompt: { type: 'string' }
  }
};

const validation = (req, res, next) => {
  return validationOfAPI(req, res, next, validationSchema, 'body');
};

const getValues = async (spreadsheetId, sheetName) => {
  const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
  });

  const service = google.sheets({ version: 'v4', auth });
  try {
    const range = `${sheetName}!A:C`;
    const result = await service.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const numRows = result.data.values ? result.data.values.length : 0;
    console.log(`${numRows} rows retrieved.`);

    return result.data.values;
  } catch (err) {
    throw err;
  }
}

const updateValues = async (spreadsheetId, range, values) => {
  const auth = new GoogleAuth({
    scopes: 'https://www.googleapis.com/auth/spreadsheets',
  });

  const service = google.sheets({ version: 'v4', auth });
  try {
    const result = await service.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      resource: { values },
    });
    console.log(`${result.updatedCells} cells updated.`);
    return result;
  } catch (err) {
    throw err;
  }
}

const askQnaFromSheet = async (req, res) => {
  try {
    const { spreadsheetId, sheetName, prompt } = req.body;

    // Get questions from Google Sheets
    const range = `${sheetName}!A:C`;
    const data = await getValues(spreadsheetId, sheetName);
    if (!data || data.length === 0) {
      return res.status(400).send({ message: 'No data found in the specified range.' });
    }

    // Assume questions are in the first column
    const questions = data.map(row => row[0]);

    // Get answers for each question
    const answers = await Promise.all(questions.map(async (question) => {
      const result = await PineconeService.askQna(question, prompt);
      const sources = result.sources ? result.sources.join(', ') : 'No sources';
      return [result.answer, sources];
    }));

    // Prepare data for update
    const startRow = 1; // Assuming the data starts from the first row
    const endRow = startRow + answers.length - 1;
    const updateRange = `${sheetName}!B${startRow}:C${endRow}`;
    const updatedValues = answers.map((answer) => [answer[0], answer[1]]);

    // Update Google Sheets with answers
    await updateValues(spreadsheetId, updateRange, updatedValues);

    res.send({ message: 'Questions answered and sheet updated successfully.' });
  } catch (err) {
    console.log('askQnaFromSheet Error', err);
    return res.status(500).send({
      type: __constants.RESPONSE_MESSAGES.SERVER_ERROR,
      err: err.message || err
    });
  }
};

router.post('/askQnaFromSheet', validation, askQnaFromSheet);
module.exports = router;
