const { BigQuery } = require('@google-cloud/bigquery');
const __config = require('../../config')

let bigquery; 

try {
  bigquery = new BigQuery({
    projectId: __config.bigQuery.projectId,
    keyFilename: __config.bigQuery.keyFilename
  });

  console.log('Connected to Google BigQuery successfully!');
} catch (error) {
  console.error('Error connecting to Google BigQuery:', error);
}

module.exports = bigquery;