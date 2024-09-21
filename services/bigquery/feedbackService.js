const bigquery = new BigQuery({
  keyFilename: path.join(__dirname, "keys.json"),
});
const { v4: uuidv4 } = require('uuid');
class feedbackService {
    async saveFeedback (data) {
      try {
        // data: Question: string, response: string, feedback: 0/ 1 (which will be numerical notations for thumbs up and thumbs down), feedback description: string
        // save in bigquery
        console.log('Data in saveFeedback function :: data', data)
        const row = {
          question: data.question,
          response: data.response,
          sources: data.sources,
          custom_status: "under_review",
          id: uuidv4(),
        }
        // save in bigquery
        const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
        const tableId = process.env.BIG_QUERY_FEEDBACK_TABLE_ID;
        const rows = [row];
        await bigquery
          .dataset(datasetId)
          .table(tableId)
          .insert(rows);
        console.log(`Inserted 1 row`);
        return {
          message: 'Feedback saved successfully',
          data: row
        }
      } catch (err) {
        console.log('Error in saveFeedback function :: err', err)
        throw new Error(err)
      }
    }
    async updateFeedback (id, feedback, description) {
      try {
        // update in bigquery
        console.log('Data in updateFeedback function :: id, feedback', id, feedback)
        const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
        const tableId = process.env.BIG_QUERY_FEEDBACK_TABLE_ID;
        const rows = [
          {
            id: id,
            feedback: feedback,
            feedback_description: description
          }
        ];
        await bigquery
          .dataset(datasetId)
          .table(tableId)
          .update(rows);
        console.log(`Updated 1 row`);
        return {
          message: 'Feedback updated successfully',
          data: rows
        }
      } catch (err) {
        console.log('Error in updateFeedback function :: err', err)
        throw new Error(err)
      }
    }
    async updateStatus (id, status) {
      try {
        // update in bigquery
        console.log('Data in updateStatus function :: id, status', id, status)
        const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
        const tableId = process.env.BIG_QUERY_FEEDBACK_TABLE_ID;
        const rows = [
          {
            id: id,
            custom_status: status
          }
        ];
        await bigquery
          .dataset(datasetId)
          .table(tableId)
          .update(rows);
        console.log(`Updated 1 row`);
        return {
          message: 'Feedback status updated successfully',
          data: rows
        }
      } catch (err) {
        console.log('Error in updateStatus function :: err', err)
        throw new Error(err)
      }
    }
    async getUniqueSources () {
      let query = `SELECT DISTINCT sources FROM ${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}`
    }
  }
  
  module.exports = new feedbackService()
  