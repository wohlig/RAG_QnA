const { BigQuery } = require("@google-cloud/bigquery");
const path = require("path");
const fs = require("fs");
const keys = process.env.GOOGLE_SECRETS;
fs.writeFileSync(path.join(__dirname, "keys.json"), keys);
const bigquery = new BigQuery({
  keyFilename: path.join(__dirname, "keys.json"),
});
const { v4: uuidv4 } = require("uuid");

class chatsFeedbackService {
  async saveFeedback(data) {
    try {
      // data: Question: string, response: string, feedback: 0/ 1 (which will be numerical notations for thumbs up and thumbs down), feedback description: string
      // save in bigquery
      console.log("Data in saveFeedback function :: data", data);
      const row = {
        question: data.question,
        response: data.response,
        sources: data.sources,
        custom_status: "under_review",
        id: uuidv4(),
      };
      // save in bigquery
      const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
      const tableId = process.env.BIG_QUERY_FEEDBACK_TABLE_ID;
      const rows = [row];
      await bigquery.dataset(datasetId).table(tableId).insert(rows);
      console.log(`Inserted 1 row`);
      return {
        message: "Feedback saved successfully",
        data: row,
      };
    } catch (err) {
      console.log("Error in saveFeedback function :: err", err);
      throw new Error(err);
    }
  }
  async saveFeedbackBatch(data) {
    // console.log("🚀 ~ chatsFeedbackService ~ saveFeedbackBatch ~ data:", data);
    try {
      // Create the row data
      const row = {
        question: data.question,
        response: data.response,
        sources: data.sources,
        custom_status: "under_review",
        session_id: data.session_id,
        timestamp: data.timestamp,
        id: data.id,
        confidence_socre: data.confidence_socre,
      };

      // Write the row data to a temporary JSON file for batch load
      const tempFilePath = "./feedback_temp.json";
      const stream = fs.createWriteStream(tempFilePath);

      // Write row as a single JSON object (not an array)
      stream.write(JSON.stringify(row) + "\n");
      stream.end();

      // wait for the stream to finish
      await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
      });

      const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
      const tableId = process.env.BIG_QUERY_FEEDBACK_TABLE_ID;

      // Load the data as a batch insert into BigQuery
      const resp = await bigquery
        .dataset(datasetId)
        .table(tableId)
        .load(tempFilePath, {
          sourceFormat: "NEWLINE_DELIMITED_JSON",
        });
      // console.log(`Batch insert response:`, resp);

      // Clean up the temporary file
      fs.unlinkSync(tempFilePath);

      console.log(`Batch inserted 1 row with ID ${row.id}`);
      return {
        message: "Feedback saved successfully (batch)",
        data: row,
      };
    } catch (err) {
      console.log("Error in saveFeedbackBatch function :: err", err);
      throw new Error(err);
    }
  }
  async updateFeedback(chatId, feedback, description) {
    console.log(
      "Data in updateFeedback function :: chatId, feedback, description",
      chatId,
      feedback,
      description
    );
    const query = `
          UPDATE \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
          SET feedback = @feedback, feedback_description = @description
          WHERE id = @chatId
      `;
    await bigquery.query({
      query: query,
      params: { chatId, feedback, description },
    });
  }
  async getSummaryStats(start_time, end_time) {
    const query = `
          SELECT 
              COUNT(DISTINCT session_id) AS total_sessions,
              COUNT(question) AS total_questions,
              SUM(CASE WHEN feedback = 1 THEN 1 ELSE 0 END) AS relevant,
              SUM(CASE WHEN feedback = 0 THEN 1 ELSE 0 END) AS irrelevant,
              SUM(CASE WHEN feedback IS NULL THEN 1 ELSE 0 END) AS no_feedback
          FROM \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
          WHERE timestamp BETWEEN '${start_time}' AND '${end_time}'
      `;
    const [rows] = await bigquery.query(query);
    return rows.map((row) => ({
      totalSessions: row.total_sessions,
      totalQuestions: row.total_questions,
      relevant: row.relevant,
      irrelevant: row.irrelevant,
      noFeedback: row.no_feedback,
      relevancePercent: ((row.relevant / row.total_questions) * 100).toFixed(2),
      irrelevancePercent: ((row.irrelevant / row.total_questions) * 100).toFixed(2),
      noFeedbackPercent: ((row.no_feedback / row.total_questions) * 100).toFixed(2),
    }))[0];
  }
  async getDetailStats(source, start_time, end_time) {
    console.log("🚀 ~ chatsFeedbackService ~ getDetailStats ~ source:", source);
  
    let query = `
      SELECT 
        source,
        COUNT(*) AS count,
        COUNT(CASE WHEN custom_status = 'under_review' THEN 1 END) AS yet_to_be_reviewed,
        COUNT(CASE WHEN custom_status = 'relevant' THEN 1 END) AS relevant,
        COUNT(CASE WHEN custom_status = 'irrelevant' THEN 1 END) AS irrelevant,
        COUNT(CASE WHEN custom_status = 'needs_improvement' THEN 1 END) AS needs_improvement,
        COUNT(CASE WHEN custom_status = 'retrained' THEN 1 END) AS retrained
      FROM \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
      CROSS JOIN UNNEST(sources) AS source
      WHERE timestamp BETWEEN '${start_time}' AND '${end_time}'
    `;
  
    // If the source filter is provided, include it in the WHERE clause
    if (source) {
      query += ` AND source = '${source}'`;
    }
  
    query += ` GROUP BY source ORDER BY source`;
  
    const [rows] = await bigquery.query({ query });
    return rows;
  }
  async updateChatStatus(chatIds, status) {
    if (!Array.isArray(chatIds)) {
      chatIds = [chatIds];
    }
    const query = `
          UPDATE \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
          SET custom_status = @status
          WHERE id IN UNNEST(@chatIds)
      `;
    await bigquery.query({
      query: query,
      params: { chatIds, status },
    });
  }
  async getUniqueSources(start_time, end_time) {
    const query = `
      SELECT 
        source,
        dt.document_link,
        COUNT(*) AS total_questions,
        AVG(confidence_socre) AS avg_confidence,
        MAX(timestamp) AS last_update,
        SUM(CASE WHEN feedback = 1 THEN 1 ELSE 0 END) AS positive_feedback_count,
        (SUM(CASE WHEN feedback = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100 AS relevance_percent
      FROM (
        SELECT *
        FROM \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
        WHERE timestamp BETWEEN @start_time AND @end_time
      ) AS ft
      CROSS JOIN UNNEST(ft.sources) AS source
      LEFT JOIN \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_DOCUMENTS_TABLE_ID}\` AS dt
      ON dt.document_name LIKE CONCAT('%', source, '%')
      GROUP BY source, dt.document_link
      ORDER BY last_update DESC
    `;
  
    const options = {
      query: query,
      params: { start_time, end_time },
    };
  
    try {
      const [rows] = await bigquery.query(options);
      return rows.map((row) => ({
        source: row.source,
        documentLink: row.document_link,
        totalQuestions: row.total_questions,
        averageConfidence: row.avg_confidence
          ? Number(row.avg_confidence).toFixed(2)
          : null,
        relevancePercent: row.relevance_percent
          ? Number(row.relevance_percent).toFixed(2)
          : null,
        lastUpdate: row.last_update,
      }));
    } catch (err) {
      console.error("Error in getUniqueSources function:", err);
      throw new Error(err);
    }
  }
  
  
  async updateReadStatus(id) {
    console.log(`Updating Read Status of chatId ${id}`)
    const query = `UPDATE \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
                   SET read_status = 1
                   WHERE id = @id`
    const options = {
      query: query,
      params: { id },
    };

    try {
      await bigquery.query(options);
      return "Read Status Updated";
    } catch (err) {
      console.error("Error in updateReadStatus function:", err);
      throw new Error(err);
    }
  }
  async getChatHistoryBySource(source, start_time, end_time) {
    console.log("Fetching chat history for source:", source);
  
    const query = `
      SELECT 
        id,
        question,
        response,
        sources,
        feedback,
        custom_status,
        read_status,
        timestamp
      FROM \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_FEEDBACK_TABLE_ID}\`
      CROSS JOIN UNNEST(sources) AS source
      WHERE timestamp BETWEEN '${start_time}' AND '${end_time}'
        AND source = @source
      ORDER BY timestamp DESC
    `;
  
    const options = {
      query: query,
      params: { source },
    };
  
    try {
      const [rows] = await bigquery.query(options);

      // Step 1: Collect all unique sources from all rows
      let allSources = [];
      rows.forEach((row) => {
        allSources = allSources.concat(row.sources);
      });
      allSources = [...new Set(allSources)]; // Remove duplicates

      // Step 2: Get links for all sources in a single call
      const KnowledgeBaseService = require("../../services/datastore/knowledgeBaseService");

      const linksOfSource = await KnowledgeBaseService.getLinksOfSource(
        allSources
      );

      // Build a map from document_name to document_link for quick lookup
      const sourceLinkMap = new Map();
      linksOfSource.forEach((item) => {
        sourceLinkMap.set(item.document_name, item.document_link);
      });

      // Step 3: Update each row's sources using the map
      rows.forEach((row) => {
        const updatedSources = row.sources
          .map((sourceName) => {
            const document_link = sourceLinkMap.get(sourceName);
            if (document_link) {
              return {
                document_name: sourceName,
                document_link: document_link,
              };
            }
            return null;
          })
          .filter((item) => item !== null);
        row.sources = updatedSources;
      });

      return rows;
    } catch (err) {
      console.error("Error in getChatHistoryBySource function:", err);
      throw new Error(err);
    }
  }
  
}
module.exports = new chatsFeedbackService();