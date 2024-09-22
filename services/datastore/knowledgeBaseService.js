const { BigQuery } = require("@google-cloud/bigquery");
const { Storage } = require("@google-cloud/storage"); // Import the Storage client
const path = require("path");
const fs = require("fs");
const os = require("os");
const keys = process.env.GOOGLE_SECRETS;
const PineconeService = require('../pinecone/PineconeService')
const axios = require('axios')

// Write keys to a temporary JSON file
fs.writeFileSync(path.join(__dirname, "keys.json"), keys);

const bigquery = new BigQuery({
  keyFilename: path.join(__dirname, "keys.json"),
});
 
const storage = new Storage({
  keyFilename: path.join(__dirname, "keys.json"),
});

class knowledgebaseService {

  async addDocument(files, data) {
    try {
      const bucketName = process.env.GCS_BUCKET_NAME;
      const bucket = storage.bucket(bucketName);

      const results = [];

      for (const file of files) {
        const fileName = path.basename(file.originalname);
        const filePath = file.path;

        console.log(`Processing file: ${fileName}`);

        // Check if the file exists in the bucket
        const [exists] = await bucket.file(fileName).exists();

        if (exists) {
          console.log(
            `Document "${fileName}" already exists in the knowledge base.`
          );
          results.push({
            fileName,
            message: "Document already in knowledge base",
          });
          // Remove the local file
          fs.unlink(filePath, (err) => {
            if (err) console.error(`Error deleting file ${filePath}:`, err);
          });
          continue; // Skip to the next file
        }

        // Upload the file to the bucket
        await bucket.upload(filePath, {
          destination: fileName,
          public: true, // Make the file publicly accessible (optional)
        });

        console.log(`Uploaded "${fileName}" to bucket "${bucketName}".`);

        // Get the public URL of the uploaded file
        const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(
          fileName
        )}`;

        // Prepare data for BigQuery, including 'last_updated'
        const row = {
          document_name: fileName,
          document_link: publicUrl,
          last_updated: new Date().toISOString(), // Current timestamp in ISO format
          last_crawled: new Date("1970-01-01T00:00:00Z").toISOString(), // Very old timestamp
          last_updated_by: data.last_updated_by || "Unknown",
          type: data.type || path.extname(fileName).substring(1),
          status: "Active",
          //   id: uuidv4(),
        };

        console.log("Row to be inserted:", row);

        // Write the row to a temporary NDJSON file
        const tempFilePath = path.join(
          os.tmpdir(),
          `document_data_${fileName}.json`
        );
        fs.writeFileSync(tempFilePath, JSON.stringify(row) + "\n"); // Ensure newline at the end

        const fileContent = fs.readFileSync(tempFilePath, "utf8");
        console.log("Content of temporary JSON file:", fileContent);

        // Load data into BigQuery using a load job
        const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
        const tableId = process.env.BIG_QUERY_DOCUMENTS_TABLE_ID;

        const [job] = await bigquery
          .dataset(datasetId)
          .table(tableId)
          .load(tempFilePath, {
            sourceFormat: "NEWLINE_DELIMITED_JSON",
            location: "asia-south1", // Set to your dataset's location
          });

        // Wait for the job to complete
        // await job.promise();

        console.log(
          `Loaded document "${fileName}" into BigQuery via batch load.`
        );

        // Delete the temporary file
        fs.unlinkSync(tempFilePath);

        results.push({
          fileName,
          message: "Document added successfully",
          data: row,
        });

        // Remove the local file after processing
        fs.unlink(filePath, (err) => {
          if (err) console.error(`Error deleting file ${filePath}:`, err);
        });
      }

      return results;
    } catch (err) {
      console.error("Error in addDocument function:", err);
      throw err;
    }
  }

  async updateDocument(file, lastUpdatedBy) {
    try {
      const bucketName = process.env.GCS_BUCKET_NAME;
      const bucket = storage.bucket(bucketName);
      const documentName = path.basename(file.originalname);

      // Delete the existing file from Cloud Storage
      const existingFile = bucket.file(documentName);

      // Check if the file exists
      const [fileExists] = await existingFile.exists();
      if (fileExists) {
        // Delete the file
        await existingFile.delete();
        console.log(`Deleted existing file "${documentName}" from Cloud Storage.`);
      } else {
        console.log(`File "${documentName}" does not exist in Cloud Storage.`);
      }

      // Upload the new file to Cloud Storage
      const filePath = file.path;
      await bucket.upload(filePath, {
        destination: documentName,
        public: true, // Make the file publicly accessible (optional)
      });

      console.log(`Uploaded new file "${documentName}" to bucket "${bucketName}".`);

      // Get the public URL of the uploaded file
      const publicUrl = `https://storage.googleapis.com/${bucketName}/${encodeURIComponent(
        documentName
      )}`;

      // Prepare data for BigQuery
      const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
      const tableId = process.env.BIG_QUERY_DOCUMENTS_TABLE_ID;

      const query = `
        UPDATE \`${datasetId}.${tableId}\`
        SET
          document_link = @document_link,
          last_updated = @last_updated,
          last_updated_by = @last_updated_by
        WHERE document_name = @document_name
      `;

      const options = {
        query: query,
        params: {
          document_link: publicUrl,
          last_updated: new Date().toISOString(),
          last_updated_by: lastUpdatedBy,
          document_name: documentName,
        },
        location: 'asia-south1', // Set to your dataset's location
      };

      // Run the query as a job
      const [job] = await bigquery.createQueryJob(options);
      console.log(`Update job started: ${job.id}`);

      // Wait for the query to finish
      await job.getQueryResults();

      // Retrieve job statistics
      const [metadata] = await job.getMetadata();
      const numDmlAffectedRows = metadata.statistics.query.numDmlAffectedRows;

      if (numDmlAffectedRows > 0) {
        console.log(`Document "${documentName}" updated successfully.`);
        return {
          message: 'Document updated successfully',
          document_name: documentName,
          rowsAffected: numDmlAffectedRows,
        };
      } else {
        console.log(`No document found with name "${documentName}".`);
        return {
          message: 'No document found to update',
          document_name: documentName,
          rowsAffected: 0,
        };
      }
    } catch (err) {
      console.error('Error in updateDocument function:', err);
      throw err;
    } finally {
      // Clean up the uploaded file from the local file system
      if (file && file.path) {
        fs.unlink(file.path, (err) => {
          if (err) console.error(`Error deleting file ${file.path}:`, err);
        });
      }
    }
  }


  async deleteDocument(documentNames) {
    try {
      const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
      const tableId = process.env.BIG_QUERY_DOCUMENTS_TABLE_ID;

      // Update the status field in BigQuery
      const query = `
        UPDATE \`${datasetId}.${tableId}\`
        SET status = @status
        WHERE document_name = @document_name
      `;
      const results = [];

      for (const documentName of documentNames) {
        const options = {
          query: query,
          params: {
            status: "TBD",
            document_name: documentName,
          },
          location: "asia-south1", // Set to your dataset's location
        };
        const [job] = await bigquery.createQueryJob(options);
        console.log(`Update job started: ${job.id}`);

        // Wait for the query to finish
        await job.getQueryResults();

        // Retrieve job statistics
        const [metadata] = await job.getMetadata();
        const numDmlAffectedRows = metadata.statistics.query.numDmlAffectedRows;

        if (numDmlAffectedRows > 0) {
          console.log(
            `Updated status to 'TBD' for ${numDmlAffectedRows} row(s) in BigQuery for document "${documentName}".`
          );
          results.push({
            message: "Document status updated successfully",
            document_name: documentName,
            rowsAffected: numDmlAffectedRows,
          });
        } else {
          console.log(
            `No rows found in BigQuery for document "${documentName}".`
          );
          results.push({
            message: "No document found to update",
            document_name: documentName,
            rowsAffected: 0,
          });
        }
      }
      return results;
    } catch (err) {
      console.error("Error in deleteDocument function:", err);
      throw err;
    }
  }

  async getDocuments() {
    try {
        const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
        const tableId = process.env.BIG_QUERY_DOCUMENTS_TABLE_ID;
      const query = `
        SELECT *
        FROM \`${datasetId}.${tableId}\`
        WHERE status = @status
      `;

      const options = {
        query: query,
        params: {
          status: 'Active',
        },
        location: 'asia-south1', // Set to your dataset's location
      };

      const [job] = await bigquery.createQueryJob(options);
      console.log(`Query job started: ${job.id}`);

      const [rows] = await job.getQueryResults();

      console.log(`Retrieved ${rows.length} documents with status 'Active'.`);

      return rows;
    } catch (err) {
      console.error('Error in getDocuments function:', err);
      throw err;
    }
  }

  async crawler() {
    const datasetId = process.env.BIG_QUERY_DATA_SET_ID;
    const tableId = process.env.BIG_QUERY_DOCUMENTS_TABLE_ID;
    const bucketName = process.env.GCS_BUCKET_NAME;
    const bucket = storage.bucket(bucketName);

    // Additional BigQuery table
    const secondaryTableId = 'ondc_crawler_test';
    let array3 = []; // Define array3 here to use in finally block
    try {
      // Step 1: Retrieve rows from BigQuery with the specified condition
      const query = `
        SELECT document_name, document_link, status
        FROM \`${datasetId}.${tableId}\`
        WHERE last_updated > last_crawled
      `;

      const options = {
        query: query,
        location: 'asia-south1', // Set to your dataset's location
      };

      const [job] = await bigquery.createQueryJob(options);
      console.log(`Query job started: ${job.id}`);

      const [rows] = await job.getQueryResults();

      console.log(`Retrieved ${rows.length} rows from BigQuery.`);

      // Step 2: Segregate rows based on status
      const array1 = []; // For status 'Active'
      const array2 = []; // For status 'TBD'

      for (const row of rows) {
        if (row.status === 'Active') {
          array1.push({
            document_name: row.document_name,
            document_link: row.document_link,
          });
        } else if (row.status === 'TBD') {
          array2.push({
            document_name: row.document_name,
            document_link: row.document_link,
          });
        }
      }

      console.log(`Segregated rows into array1 (Active): ${array1.length} items.`);
      console.log(`Segregated rows into array2 (TBD): ${array2.length} items.`);

      // Step 3: Download documents from array1 and store in array3
      array3 = []; // This will mimic files uploaded by a user

      for (const item of array1) {
        const { document_name, document_link } = item;

        console.log(`Downloading document: ${document_name} from ${document_link}`);

        try {
          // Download the document and get the data as a buffer
          const file = bucket.file(document_name);
          const [exists] = await file.exists();

          if (!exists) {
            console.error(`File ${document_name} does not exist in Cloud Storage.`);
            continue;
          }

          const fileBuffer = await file.download();
          // fileBuffer is an array with the file data in the first element
          const buffer = fileBuffer[0];


          // Prepare the file object as if uploaded by a user
          const fileObject = {
            originalname: document_name,
            buffer: buffer,
          };

          array3.push(fileObject);

          console.log(`Downloaded and stored document: ${document_name}`);
        } catch (downloadErr) {
          console.error(`Error downloading document ${document_name}:`, downloadErr);
          // Handle download error (e.g., continue to next document or halt execution)
          continue; // Continue with next document
        }
      }

      console.log(`Downloaded all documents. Total: ${array3.length}`);
      console.log("Array1", array1);
      console.log("Array2", array2);
      console.log("Array3", array3);
    //   return

      // Step 4: Pass array3 to pushDocumentsToBigQuery
      const embeddingFile = await PineconeService.pushDocumentsToBigQuery(array3);
      console.log("Embedding", embeddingFile)

      // Step 5: Update last_crawled date for documents in array1
      const currentTimestamp = new Date().toISOString();
      for (const item of array1) {
        const { document_name } = item;

        const updateQuery = `
          UPDATE \`${datasetId}.${tableId}\`
          SET last_crawled = @last_crawled
          WHERE document_name = @document_name
        `;

        const updateOptions = {
          query: updateQuery,
          params: {
            last_crawled: currentTimestamp,
            document_name: document_name,
          },
          location: 'asia-south1',
        };

        try {
          const [updateJob] = await bigquery.createQueryJob(updateOptions);
          await updateJob.getQueryResults();

          console.log(`Updated last_crawled for "${document_name}" in BigQuery.`);
        } catch (updateErr) {
          console.error(`Error updating last_crawled for "${document_name}":`, updateErr);
          // Handle the error accordingly
        }
      }

      // Step 6: Process array2
      for (const item of array2) {
        const { document_name } = item;

        console.log(`Processing document for deletion: ${document_name}`);

        // Delete file from Cloud Storage
        const file = bucket.file(document_name);
        try {
          await file.delete();
          console.log(`Deleted file "${document_name}" from Cloud Storage.`);
        } catch (err) {
          if (err.code === 404) {
            console.log(`File "${document_name}" not found in Cloud Storage.`);
          } else {
            console.error(`Error deleting file "${document_name}" from Cloud Storage:`, err);
            // Handle the error accordingly
          }
        }

        // Delete row from BigQuery table
        const deleteQuery = `
          DELETE FROM \`${datasetId}.${tableId}\`
          WHERE document_name = @document_name
        `;

        const deleteOptions = {
          query: deleteQuery,
          params: {
            document_name: document_name,
          },
          location: 'asia-south1',
        };

        try {
          const [deleteJob] = await bigquery.createQueryJob(deleteOptions);
          await deleteJob.getQueryResults();

          console.log(`Deleted row for "${document_name}" from BigQuery table "${tableId}".`);
        } catch (deleteErr) {
          console.error(`Error deleting row for "${document_name}" from BigQuery:`, deleteErr);
          // Handle the error accordingly
        }

        // Modify the filename extension to .pdf
        const pdfDocumentName = path.basename(document_name, path.extname(document_name)) + '.pdf';

        // Delete documents from 'ondc_geminititle_copy' where 'source' equals pdfDocumentName
        const deleteSecondaryQuery = `
          DELETE FROM \`${datasetId}.${secondaryTableId}\`
          WHERE source = @source
        `;

        const deleteSecondaryOptions = {
          query: deleteSecondaryQuery,
          params: {
            source: pdfDocumentName,
          },
          location: 'asia-south1',
        };

        try {
          const [deleteSecondaryJob] = await bigquery.createQueryJob(deleteSecondaryOptions);
          await deleteSecondaryJob.getQueryResults();

          console.log(`Deleted records from "${secondaryTableId}" where source = "${pdfDocumentName}".`);
        } catch (deleteSecondaryErr) {
          console.error(`Error deleting records from "${secondaryTableId}" for source "${pdfDocumentName}":`, deleteSecondaryErr);
          // Handle the error accordingly
        }
      }

      console.log('Crawler function completed successfully.');
    } catch (err) {
      console.error('Error in crawler function:', err);
      throw err;
    }
  }


}

module.exports = new knowledgebaseService();
