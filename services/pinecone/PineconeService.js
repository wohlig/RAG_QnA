const pdf_parse = require("pdf-parse");
const __constants = require("../../config/constants");
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const langchainOpenAI = require("@langchain/openai");
const { loadSummarizationChain } = require("langchain/chains");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const fs = require("fs");
const { uuid } = require("uuidv4");
const { Pinecone } = require("@pinecone-database/pinecone");

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const index = pinecone.index("ondc-rag");
const RagDocs = require("../../mongooseSchema/RagDocs");
const { compile } = require("html-to-text");
const {
  RecursiveUrlLoader,
} = require("@langchain/community/document_loaders/web/recursive_url");

class PineconeService {
  static assistantId = "";
  static threadId = "";
  static runId = "";

  async pushWebsiteDataToPinecone(urls) {
    for (const url of urls) {
        try {
            const compiledConvert = compile({ wordwrap: 130 }); // returns (text: string) => string;
      
            const loader = new RecursiveUrlLoader(url, {
              extractor: compiledConvert,
              maxDepth: 1,
            });
            
            const websiteData = await loader.load();
            const splitter = new RecursiveCharacterTextSplitter({
              chunkSize: 1000,
              chunkOverlap: 200,
            });
            const ragDoc = new RagDocs({
              docName: url,
              fullText: websiteData[0].pageContent,
            });
            await ragDoc.save();
            const docs = await splitter.splitDocuments([websiteData[0]]);
            docs.forEach((doc) => {
              doc.id = uuid();
            });
          //   return docs
            const batch_size = 100;
            let embeddings = [];
            for (let i = 0; i < docs.length; i += batch_size) {
              const i_end = Math.min(docs.length, i + batch_size);
              const meta_batch = docs.slice(i, i_end);
              const ids_batch = meta_batch.map((x) => x.id);
              const texts_batch = meta_batch.map((x) => x.pageContent);
              let response;
              try {
                response = await openai.embeddings.create({
                  model: "text-embedding-3-large",
                  input: texts_batch,
                });
              } catch (error) {
                console.log(error);
              }
              embeddings = response.data.map((record) => record.embedding);
              for (let j = 0; j < embeddings.length; j++) {
                docs[j + i].embeddings = embeddings[j];
              }
              const meta_batch_cleaned = meta_batch.map((x) => ({
                context: x.pageContent,
                docIdInDb: ragDoc._id,
                source: x.metadata.source,
                title: x.metadata.title
              }));
              const to_upsert = ids_batch.map((id, i) => ({
                id: id,
                values: embeddings[i],
                metadata: meta_batch_cleaned[i],
              }));
              await index.upsert(to_upsert);
              console.log("Successfully uploaded", i / 100);
            }
            ragDoc.docChunks = docs;
            await ragDoc.save();
            console.log("URL Done", url);
        } catch (error) {
            console.log(error.message)
        }
    }
    // await index.deleteAll();
    return "Doneeeeeeee";
  }
  async deleteVectorsFromPinecone () {
    const records = await index.query({
        vector: [0.08,0.23,0.94,0.3,0.66,0.37,0.66,0.61,0.63,0.89,0.68,0.85,0.38,0.57,0.85,0.31,0.72,0.75,0.75,0.56,0.05,0.79,0.79,0.21,0.34,0.71,0.03,0.8,0.84,0.72,0.23,0.43,0.37,0.96,0.59,1,0.69,0.42,0.3,0.66,0.62,0.29,0.64,0.53,0.19,0.41,0.59,0.53,0.91,1,0.07,0.31,0.08,0.99,0.39,0.18,0.54,0.99,0.9,0.16,0.73,0.19,0.71,0.52,0.8,0.09,0.29,0.13,0.03,0.94,0.5,0.5,0.75,0.14,0.86,0.5,0.13,0.77,0.03,0.88,0.33,0.99,0.59,0.91,0.53,0.06,0.82,0.04,0.93,0.75,0.22,0.54,0.72,0.86,0.75,0.38,0.22,0.99,0.02,0.88,0.23,0.2,0.71,0.26,0.69,0.57,0.73,0.02,0.63,0.16,0.31,0.84,0.32,0.79,0.18,0.35,0.58,0.7,0.87,0.76,0.24,0.54,0.76,0.8,0.45,0.91,0.12,0.53,0.86,0.77,0.72,0.84,0.96,0.59,0.22,0.93,0.56,0.45,0.7,0.46,0.3,0.88,0.72,0.67,0.92,0.08,0.43,0.96,0.98,0.97,0.19,0.33,0.3,0.92,0.28,0.99,0.17,0.73,0.05,0.72,0.89,0.71,0.8,0.06,0.95,0.84,0.64,0.35,0.86,0.14,0.51,0.02,0.52,0.71,0.99,0.84,0.41,0.25,0.74,0.51,0.17,0.8,0.83,0.36,0.47,0.54,0.28,0.47,0.52,0.67,0.33,0.2,0.54,0.76,0.51,0.82,0.67,0.81,0.3,0.7,0.91,0.04,0.54,0.44,0.1,0.84,0.26,0.7,0.09,0.76,0.37,0.31,0.27,0.61,0.18,0.87,0.88,0.99,0.67,0.77,0.07,0.04,0.87,0.18,0.06,0.35,0.57,0.23,0.5,0.99,0.26,0.24,0.88,0.82,0.29,0.55,0.85,0.14,0.15,0.31,0.38,0.63,0.31,0.65,0.72,0.91,0.92,0.89,0.19,0.77,0.43,0.53,0.6,0.21,0.1,0.97,0.37,0.5,0.96,0.45,0.27,0.69,0.72,0.93,0.06,0.97,0.86,0.59,0.11,0.88,0.94,0.23,0.37,0.81,0.32,0.19,0.27,0.16,0.61,0.23,0.52,0.6,0.49,0.34,0.89,0.28,0.5,0.67,0.62,0.39,0.23,0.1,0.16,0.52,0.7,0.38,0.46,0.05,0.84,0.91,0.05,0.07,0.5,0.91,0.43,0.23,0.98,0.44,0.49,0.76,0.27,0.62,0.73,0.16,0.07,0.39,0.01,0.43,0.99,0.93,0.41,0.98,0.98,0.27,0.97,0.87,0.53,0.95,0.14,0.75,0.16,0.74,0.42,0.51,0.48,0.76,0.17,0.04,0.4,0.12,0.2,0.93,0.43,0.79,0.57,0.95,0.92,0.67,0.7,0.11,0.55,0.33,0.61,0.12,0.91,0.98,0.35,0.13,0.56,0.44,0.76,0.36,0.26,0.11,0.36,0.09,0.2,0.35,0.47,0.14,0.34,0.57,0.91,0.58,0.57,0.61,1,0.97,0.61,0.16,0.37,0.42,0.13,0.69,0.6,0.27,0.19,0.88,0.45,0.1,0.9,0.57,0.42,0.61,0.83,0.42,0.74,0.19,0.81,0.81,0.46,0.16,0.55,0.04,0.32,0.85,0.28,0.55,0.32,0.86,0.45,0.96,0.38,0.93,0.93,0.18,0.94,0.8,0.89,0.03,0.63,0.73,0.27,0.04,0.44,0.52,0,0.05,0.3,0.09,0.81,0.62,0.69,0.33,0.63,0.79,0.61,0.55,0.39,0.39,0.23,0.77,0.45,0.48,0.88,0.4,0.55,0.3,0.52,0.62,0.74,0.71,0.69,0.61,0.92,0.3,0.54,0.98,0.06,0.82,0.92,0.74,0.51,0.33,0.85,0.14,0.62,0.73,0.6,0.45,0.28,0.89,0.94,0.03,0.73,0.37,0.41,0.52,0.85,0.93,0.77,0.66,0.53,0.33,0.5,0.52,0.58,0.85,0.53,0.71,0.12,0.4,0.28,0.66,0.91,0.26,0.26,0.31,0.76,0.03,0.79,0.8,0.78,0.17,0.6,0.94,0.43,0.2,0.16,0.19,0.59,0.6,0.92,0.12,0.79,0.79,0.34,0.92,0.6,0.92,0.12,0.24,0.1,0.91,0.59,0.6,0.88,0.09,0.07,0.1,0.48,0.97,1,0.47,0.5,0.65,0.38,0.9,0.22,0.87,0.1,0.66,0.66,0.1,0.91,0.54,0.04,0.87,0.77,0.11,0.51,0.66,0.84,0.9,0.49,0.04,0.5,0.08,0.98,0.7,0.01,0.01,0.37,0.57,0.7,0.62,0.14,0.6,0.84,0,0,0.87,0.62,0.61,0.81,0.57,0.74,0.1,0.79,0.49,0.26,0.49,0.32,0.63,0.52,0.56,0.07,0.13,0.38,0.4,0.02,0.02,0.24,0.14,0.34,0.61,0.09,0.39,0.52,0.65,0.7,0.71,0.49,0.82,0.4,0.92,0.93,0.29,0.84,0.63,0.57,0.46,0.23,0.71,0.5,0.52,0.81,0.38,0.75,0.42,0.94,0.07,0.3,0.11,0.34,0.32,0.46,0.14,0.06,0.25,0.17,0.29,0.92,0.13,0.13,0.11,0.24,0.49,0.1,0.84,0.13,0.55,0.18,0.83,0.21,0.64,0.31,0.59,0.4,0.09,0.63,0.75,0.48,0.37,0.6,0.24,0.69,0.37,0.35,0.9,0.9,0.92,0.67,0.32,0.24,0.7,0.11,0.82,0.41,0.53,0.14,0.1,0.23,0.8,0.34,0.96,0.61,0.03,0.83,0.48,0.12,0.32,0.65,0.02,0.16,0.23,0.53,0.94,0.55,0.87,0.2,0.95,0.65,0.18,0.62,0.51,0.68,0.25,0.39,0.48,0.46,0.88,0.68,0.86,0.96,0.5,0.03,0.33,0.37,0.26,0.2,0.67,0.11,0.93,0.8,0.56,0.18,0.13,0,0.82,0.06,0.84,0.55,0.91,0.27,0.14,0.99,0.51,0.55,0.01,0.18,0.81,0.15,0.89,0.09,0.16,0.91,0.08,0.83,0.12,0.88,0.11,0.02,0.65,0.45,0.46,0.34,0.11,0.39,0.87,0.21,0.4,0.51,0.63,0.8,0.78,0.62,0.07,0.85,0.02,0.24,0.32,0.7,0.84,0.32,0.06,0.84,0.76,0.82,0.21,0.15,0.23,0.75,0.59,0.76,0.52,0.97,0.86,0.92,0.79,0.25,0.14,0.86,0.22,0.74,0.26,0.82,0.28,0.79,0.73,0.54,0.76,0.16,0.03,0.42,0.46,1,0.51,0.61,0.24,0.9,0.03,0,0.65,0.54,0.81,0.38,0.84,0.81,0.44,0.04,0.7,0.26,0.7,0.28,0.01,0.8,0.5,0.91,0.75,0.74,0.43,0.98,0.61,0.93,0.5,0.2,0.61,0.5,0.99,0.44,0.37,0.85,0.78,0.63,0.93,0.09,0.14,0.61,0.95,0.68,0.22,0.83,0.43,0.5,0.13,0.39,0.47,0.43,0.9,0.25,0.57,0.28,0.15,0.82,0.23,0.91,0.41,0.85,0.01,0.31,0.99,0.8,0.69,0.67,0.76,0.16,0.83,0.46,0.35,0.56,0.8,0.63,0.09,0.8,0.59,0.47,0.84,0.66,0.46,0.29,0.29,0.33,0.68,0.42,0.83,0.1,0.4,0.06,0.24,0.14,0.44,0.37,0.65,0.26,0.16,0.06,0.85,0.61,0.65,0.58,0.51,0.27,0.94,0.21,0.2,0.13,0.41,0.18,0.41,0.03,0.49,0.98,0.99,0.75,0.12,0.07,0.56,0.69,0.02,0.88,0.21,0.35,0.33,0.28,0.53,0.9,0.08,0.09,0.36,0.3,0.57,0.35,0.59,0.05,0.76,0.32,0.19,0.1,0.15,0.21,0.89,0.64,0.51,0.32,0.52,0.03,0.69,0.82,0.83,0.13,0.32,0.44,0.56,0.71,0.05,0.14,0.63,0.4,0.9,0.91,0.92,0.86,0.73,0.72,0.74,0.82,0.59,0.91,0.12,0.25,0.54,0.99,0.79,0.19,0.73,0.8,0.1,0.47,0.59,0.99,0.31,0.31,0.13,0.61,0.05,0.81,0.76,0.99,0.76,0.04,0.25,0.42,0.75,0.87,0.83,0.07,0.38,0.08,0.52,0.29,0.17,0.36,0.95,0.99,0,0.22,0.5,0.3,0.78,0.82,0.9,0.9,0.65,0.87,0.3,0.9,0.17,0.29,0.21,0.26,0.48,0.2,0.19,0.18,0.3,0.97,0.12,0.12,0.7,0.02,0.4,0.58,0.32,0.3,0.43,0.56,0.41,0.61,0.2,0.84,0.74,0.97,0.99,0.56,0.42,0.7,0.84,0.47,0.18,0.85,0.41,0.58,0.29,0.68,0.51,0.63,0.93,0.16,0.47,0.21,0.48,0.22,0.15,0.45,0.98,0.16,0.54,0.63,0.01,0.08,0.52,0.69,0.61,0.56,0.03,0.67,0.99,0.65,0.22,0.83,0.29,0.55,0.83,0.1,0.33,0.42,0.32,0.3,0.31,0.52,0.66,0.22,0.92,0.13,0.56,0.33,0.08,0.66,0.11,0.05,0.94,0.37,0.51,0.79,0.96,0.82,0.33,0.59,0.54,0.5,0.69,0.32,0.57,0.2,0.75,0.29,0.42,0.15,0.52,0.06,0.31,0.63,0.02,0.9,0.8,0.3,0.78,0.51,0.58,0.59,0.4,0.58,0.96,0.52,0.72,0.59,0.64,0.46,0.24,0.98,0.47,0.75,0.89,0.71,0.84,0.69,0.17,0.47,0.52,0.88,0.66,0.74,0.51,0.9,0.91,0.62,0.67,0.46,0.51,0.95,0.37,0.89,0.47,0.81,0.45,0.49,0.97,0.65,0.07,0.31,0.8,0.76,0.57,0.82,0.73,0.55,0.38,0.29,0.79,0.84,0.99,0.26,0.16,0.98,0.13,0.19,0.69,0.77,0.32,0.46,0.95,0.49,0.66,0.81,0.77,0.88,0.41,0.68,0.01,0.21,0.13,0.53,0.87,0.74,0.97,0.49,0.5,0.21,0.85,0.01,0.42,0.2,0.73,0.01,0.46,0.06,0.87,0.07,0.72,0.31,0.06,0.23,0.56,0.67,0.13,0.49,0.56,0.64,0.79,0.19,0.28,0.15,0.54,0.33,0.76,0.99,0.67,0.43,0.9,0.47,0.86,0.72,0.72,0.85,0.79,0.47,0.79,0.56,0.74,0.08,0.53,0.91,0.41,0.64,0.17,0.46,0.8,0.66,0.66,0.31,0.4,0.62,0.55,0.14,0.7,0.76,0.02,0.14,0.38,0.86,0.88,0.91,0.66,0.11,0.91,0.94,0.54,0.33,0.49,0.65,0.88,0.89,0.14,0.62,0.28,0.46,0.35,0.61,0.69,0.55,0.12,0.48,0.95,0.51,0.91,0.05,0.81,0.34,0.74,0.51,0.05,0.1,0.25,0.05,0.5,0.5,0.12,0.36,0.9,0.98,0.28,0.55,0.92,0.99,0.57,0.52,0.33,0.83,0.92,0.22,0.32,0.93,0.61,0.06,0.32,0.65,0.99,0.04,0.51,0.71,0.64,0.25,0.6,0.94,0.25,0.05,0.98,0.87,0.46,0.24,0.97,0.9,0.04,0.38,0.77,0.61,0.06,0.43,0.2,0.92,0.33,0.34,0.15,0.75,0.75,0.47,0.77,0.01,0.71,0.01,0.26,0.27,0.85,0.44,0.44,0.91,0.7,0.61,0.61,0.74,0.34,0.79,0.5,0.47,0.06,0.17,0.63,0.63,0.95,0.06,0.88,0.18,0.54,0.82,0.05,0.27,0.16,0.65,0.68,0.84,0.65,0.14,0.74,0.01,0.43,0.13,0.1,0.31,0.65,0.83,0.27,0.68,0.6,0.54,0.59,0.23,0.02,0.12,0.5,0.46,0.38,0.86,0.94,0.44,0.94,0.91,0.61,0.47,0.59,0.88,0.09,0.71,0.53,0.75,0.19,0.59,0.79,0.78,0.6,0.18,0.3,0.13,0.56,0.39,0.25,0.02,0.68,0.18,0.94,0.52,0.17,0.58,0.27,0.17,0.99,0.92,0.31,0.9,0.6,0.88,0.34,0.71,0.79,0.34,0.53,0.43,0.62,0.36,0.94,0.19,0.06,0.56,0.98,0.61,0.32,0.83,0.29,0.1,0.22,0.26,0.55,0.91,0.47,0.35,0.99,0.85,0.37,0.32,0.61,0.63,0.36,0.18,0.58,0.08,1,0.77,0.51,0.62,0.5,0.09,0.29,0.37,0.43,0.7,0.21,0.72,0.29,0.56,0.34,0.87,0.36,0.53,0.3,0.66,0.29,0.53,0.11,0.77,0.3,0.43,0.77,0.22,0.67,0.88,0.58,0.35,0.82,0.53,0.2,0.65,0.41,0.4,0.33,0.91,0.61,0.43,0.61,0.38,0.55,0.15,0.43,0.43,0.89,0.67,0.69,0.26,0.13,0.31,0.58,0.15,0.46,0.99,0.58,0.26,0.57,0.76,0.2,0.61,0.65,0.72,0.54,0.26,0.42,0.59,0.16,0.91,0.14,0.24,0.67,0.9,0.49,0.36,0.44,0.03,0.8,0.26,0.09,0.09,0.51,0.1,0.77,0.41,0.56,0.79,0.75,0.25,0.61,0,0.14,0.02,0.42,0.32,0.85,0.72,0.53,0.95,0.65,0.71,0.2,0.31,0.14,0.3,0.62,0.46,0.53,0.51,0.32,0.18,0.28,0.12,0.45,1,0.98,0.76,0.3,0.28,0.11,0.33,0.44,0.73,0.71,0.26,0.37,0.62,0.26,0.04,0.62,0.77,0.57,0.9,0.75,0.02,0.76,0.32,0.22,0.89,0.67,0.61,0.36,0.5,0.3,0.52,0.52,0.37,0.31,0.58,0.17,0.14,0.7,0.39,0.63,0.93,0.06,0.15,0.99,0.07,0.14,0.4,0.62,0.27,0.98,0.85,0.83,0.79,0.91,0.13,0.45,0.14,0.03,0.21,0.76,0.66,0.47,0.32,0.32,0.72,0.4,0.17,0.95,0.03,0.72,0,0.77,0.73,0.39,0.47,0.1,0.03,0.16,0.48,0.68,0.26,0.08,0.92,0.47,0.34,0.43,0.9,0.65,0.89,0.06,0.64,0.7,0.16,0.43,0.86,0.73,0.18,0.06,0.18,0.75,0.95,0.45,0.14,0.05,0.42,0.05,0.86,0.57,0.96,0.86,0.57,0.01,0.43,0.39,0.07,0.65,0.19,0.62,0.04,0.39,0.48,0.88,0.14,0.23,0.7,0.52,0.71,0.74,0.55,0.04,0.34,0.53,0.49,0.37,0.93,0.21,0.68,0.86,0.19,0.61,0.54,0.38,0.09,0.25,0.54,0.99,0.84,0.6,0.14,0.69,0.94,0.84,0.47,0.04,0.19,0.58,0.78,0.96,0.14,0.48,0.48,0.62,0.92,0.07,0.86,1,0.24,0.25,0.81,0.16,0.62,0.42,0.4,0.22,0.43,0.68,0.08,0.71,0.28,0.81,0.14,0.18,0.88,0.13,0.37,0.72,0.15,0.93,0.42,0.32,0.14,0.27,0.91,0.18,0.58,0.03,0.61,0,0.72,0.8,0.63,0.89,0.6,0.6,0.35,0.83,0.56,0.16,0.25,0.95,0.49,0.75,0.08,0.05,0.15,0.88,0.84,0.89,0.4,0.41,0.2,0.91,0.44,0.24,0.17,0.53,0.55,0.82,0.08,0.62,0.12,0.65,0.39,0.52,0.69,0.58,0.85,0.31,0.48,0.57,0.1,0.19,0.66,0.6,0.44,0.75,0.2,0.45,0.17,0.16,0.79,0.81,0.5,0.99,0.41,0.61,0.12,0.49,0.09,0.4,0.67,0.19,0.02,0.91,0.53,0.18,0.78,0.25,0.88,0.13,0.61,0.12,0.31,0.9,0.28,0.43,0.76,0.41,0.34,0.54,0.47,0.91,0.91,0.25,0.29,0.58,0.1,0.19,0.81,0.25,0.03,0.52,0.14,0.31,0.13,0.07,0.54,0.19,0.41,0.59,0.92,0.49,0.18,0.68,0.86,0.34,0.84,0.48,0.27,0.85,0.99,0.05,0.12,0.02,0.08,0.5,0.68,0,0.28,0.34,0.46,0.03,0.44,0.77,0.22,0.91,0.07,0.53,0.66,0.1,0.84,0.29,0.76,0.98,0.16,0.35,0.99,0.48,0.13,0.03,0.86,0.17,0.98,0.78,0.46,0.25,0.6,0.36,0.09,0.64,1,0.48,0.53,0.85,0.12,0.95,0.43,0.33,0.24,0.7,0.42,0.78,0.94,0.39,0.67,0.92,0.63,0.96,0.1,0.53,0.15,0.26,0.4,0.94,0.79,0.76,0.4,0.47,0.81,0.59,0.42,0.07,0.28,0.53,0.75,0.15,0.58,0.11,0.36,0.94,0.57,0.43,0.51,0.83,0.06,0.32,0.57,0.15,0.2,0.41,0.84,0.25,0.48,0.72,0.37,0.66,0.07,0.76,0.06,0.55,0.38,0.13,0.74,0.54,0.6,0.57,0.96,0.24,0.2,0.5,0.8,0.56,0.93,0.83,0.54,0.99,0.17,0.58,0.09,0.09,0.39,0.73,0.63,0.78,0.41,0.55,0.21,0.86,0.63,0.84,0.5,0.23,0.71,0.25,0.4,0.3,0.02,0.05,0.77,0.43,0.32,0.69,0.81,0.09,0.92,0.9,0.24,0.74,0.19,0.36,0.75,0.73,0.11,0.93,0.66,0.39,0.31,0.05,0.64,0.44,0.1,0.67,0.26,0.6,0.36,0.91,0.73,0.15,0.76,0.85,0.81,0.55,0.79,0.78,0.75,0.28,0.6,0.88,0.44,0.53,0.92,0.12,0.69,0.44,0.79,0.67,0.79,0.47,0.65,0.59,0.57,0.82,0.98,0.59,0.91,0.53,0.38,0.79,0.75,0.1,0.16,0.33,0.98,0.18,0.96,0.24,0.77,0.26,0.43,0.71,0.65,0.35,0.38,0.08,0.12,0.38,0.44,0.87,0.04,0.51,0.33,0.8,0.14,0.75,0.14,0.4,0.47,0.81,0.63,0.07,0.7,0.34,0.67,0.98,0.67,0.3,0.9,0.95,0.29,0.54,0.38,0.87,0.8,0.3,0.22,0.71,0.9,0.45,0.99,0.89,0.95,0.03,0.43,0.37,0.79,0.1,0.55,0.97,0.5,0.79,0.91,0.98,0.02,0.33,0.34,0.84,0.22,0.94,0.21,0.87,0.17,0.04,0.17,0.63,0.8,0.73,0.96,0.33,0.71,0.96,0.49,0.77,0.78,0.79,0.7,0.87,0.6,0.64,0.56,0.5,0.69,0.16,0.5,0.83,0.97,0.25,0.35,0.88,0.48,0.5,0.73,0.96,0.42,0.84,0.98,0.47,0.47,0.75,0.99,0.81,0.7,0.74,0.16,0.79,0.39,0.07,0.13,0.86,0.74,0.77,0.71,0.44,0.95,0.19,0.54,0.01,0.8,0.19,0.28,0.96,0.45,0.53,0.84,0.18,0.98,0.42,0.5,0.9,0.12,0.59,0.28,0.2,0.11,0.51,0.17,0.43,0.22,0.6,0.78,0.22,0.32,0.38,0.08,0.52,0.15,0.85,0.58,0.52,0.71,0.77,0.52,0.66,0.9,0.01,0.83,0.99,0.59,0.54,0.5,0.31,0.7,0.45,0.51,0.19,0.7,0.65,0.17,0.21,0.21,0.48,0.91,0.97,0.27,0.54,0.92,0.54,0.68,0.63,0.4,0.53,0.42,0,0.31,0.72,0.12,0.07,0.01,0.44,0.39,0.19,0.83,0.77,0.4,0.67,0.51,0.78,0.42,0.65,0.58,0.08,0.49,0.31,0.11,0.2,0.76,0.79,0.69,0.39,0.43,0.5,0.93,0.46,0.53,0.05,0.42,0.76,0.36,0.62,0.26,0.03,0.64,0.24,0.38,0.25,0.92,0.87,0.11,0.81,0.1,0.18,0.46,0.91,0.36,0.49,0.01,0.31,0.8,0.6,0.19,0.27,0.16,0.36,0.99,0.62,0.04,0.69,0.43,0.87,0.84,0.6,0.38,0.25,0.19,0.68,0.95,0.43,0.25,0.27,0.09,0.41,0.09,0.17,0.4,0.65,0.27,0.29,0.38,0.32,0.76,0.98,0.62,0.7,0.77,0.46,0.66,0.6,0.61,0.15,0.04,0.56,0.38,0.84,0.93,0.32,0.01,0.25,0.9,0.82,0.92,0.38,0.22,0.57,0.82,0.96,0.5,0.13,0.87,0.62,0.55,0.63,0.92,0.57,0.37,0.79,0.12,0.58,0.16,0.84,0.1,0.44,0.35,0.04,0.57,0.23,0.89,0.31,0.63,0.19,0.8,0.95,0.24,0.79,0.84,0.58,0.18,0.99,0.28,0.97,0.19,0.65,0.07,0.05,0.76,0.56,0.32,0.8,0.55,0.65,0.34,0.07,0.46,0.77,0.35,0.5,0.55,0.81,0.61,0.04,0.93,0.83,0.81,0.86,0.81,0.57,0.45,0.82,0.54,0.18,0.42,0.92,0.32,0.46,0.67,0.2,0.01,0.93,0.99,0.64,0.24,0.91,0.66,0.86,0.78,0.07,0.48,0.15,0.25,0.16,0.18,0.91,0.48,0.77,0.67,0.34,0.88,0.13,0.71,0.79,0.06,0.96,0.92,0.5,0.18,0.46,0.49,0.79,0.47,0.81,0.95,0.48,0.04,0.68,0.57,0.78,0.8,0.03,0.64,0.26,0.67,0.62,0.12,0.46,0.13,0.68,0.01,0.83,0,0.7,0.88,0.5,0.6,0.4,0.66,0.22,0.8,0.27,0.99,0.43,0.45,0.34,0.64,0.33,0.76,0.8,0.13,0.64,0.11,0.96,0.6,0.05,0.68,0.45,0.06,0.78,0.15,0.72,0.73,0.34,0.17,0.64,0.36,0.18,0.35,0.19,0.41,0.22,0.07,0.26,0.38,0.66,0.62,0.05,0.3,0,0.86,0.3,0.67,0.45,0.23,0.07,0.14,0.62,0.73,0.95,0.9,0.16,0.83,0.66,0.29,0.19,0.83,0.11,0.85,0.61,0.62,0.87,0.09,0.7,0.89,0.38,0.25,0.4,0.77,0.58,0.22,0.94,0.1,0.18,0.25,0.89,0.73,0.89,0.8,0.47,0.74,0.87,0.57,0.87,0.66,0.54,0.41,0.48,0.35,0.01,0.77,0.1,0.26,0.87,0.83,0.86,0.67,0.32,0.49,0.6,0.13,0.39,0.84,0.83,0.68,0.38,0.14,0.69,0.64,0.59,0.36,0.49,0.95,0.22,0.96,0.87,0.1,0.17,0.88,0.8,0.82,0.81,0.03,0.11,0.61,0.67,0.33,0.73,0.81,0.45,0.26,0.75,0.37,0.17,0.34,0.69,0.5,0.88,0.57,0.07,0.46,0.3,0.79,0.4,0.24,0.59,0.19,0.78,0.64,0.04,0.61,0.97,0.57,0.11,0.28,0.27,0.8,0.62,0.06,0.28,0.47,0.06,0.16,0.86,0.09,0.47,0.91,0.78,0.36,0.47,0.68,0.7,0.11,0.37,0.23,0.35,0.13,0.34,0.7,0.04,0.21,0.77,0.18,0.77,0.23,0.19,0.09,0.09,0.99,0.44,0.55,0.43,0.08,0.59,0.57,0.42,1,0.93,0.99,0.77,0.75,0.02,0.17,0.03,0.63,0.11,0.01,0.19,0.11,0.89,0.84,0.62,0.34,0.58,0.86,0.78,0.68,0.16,0.13,0.23,0.19,0.83,0.14,0.84,0.57,0.55,0.65,0.92,0.15,0.53,0.48,0.72,0.51,0.45,0.31,0.54,0.72,0.25,0.9,0.67,0.79,0.62,0.31,1,0.76,0.91,0.23,0.29,0.52,0.39,0.58,0.05,0.74,0.89,0.46,0.03,0.04,0.69,0.44,0.09,0.86,0.54,0.54,0.75,0.5,0.33,0.74,0.45,0.5,0.9,0.7,0.2,0.71,0.29,0.43,0.75,0.78,0.38,0.28,0.44,0.53,0.39,0.44,0.98,0.26,0.88,0.65,0.71,0.66,0.26,0.08,0.84,0.85,0.12,0.07,0.83,0.24,0.91,0.23,1,0.32,0.43,0.64,0.25,0.36,0.72,0.02,0.55,0.01,0.44,0.25,0.19,0.35,0.78,0.66,0.45,0.08,0.46,0.96,0.9,0.93,0.49,0.98,0.85,0.42,0.99,0.98,0.99,0.57,0.58,0.87,0.13,0.21,0.98,0.43,0.26,0.71,0.82,0.01,0.12,0.07,0.81,0.78,0.5,0.65,0.71,0.7,0.06,0.14,0.41,0.4,0,0.95,0.28,0.1,0.95,0.93,0.91,0.1,0.46,0.84,0.59,0.78,0.63,0.31,0.73,0.72,0.68,0.72,0.34,0.91,0.5,0.56,0.72,0.88,0.02,0.64,0.17,0.41,0.04,0.66,0.51,0.3,0.61,0.68,0.17,0.62,0.87,0.21,0.61,0.5,0.17,0.99,0.13,0.44,0.31,0.78,0.77,0.22,0.09,0.3,0.52,0.52,0.45,0.97,0.59,0.83,0.29,0.18,0.62,0.03,0.08,0.27,0.43,0.27,0.79,0.83,0.13,0.46,0.28,0.95,0.76,0.55,0.59,0.83,0.1,0.37,0.36,0.71,0.31,0.18,0.61,0.34,0.65,0.51,0.9,0.12,0.24,0.77,0.26,0.59,0.82,0.34,0.49,0.65,0.83,0.48,0.63,0.56,0.31,0.36,0.11,0.94,0.28,0.44,0.42,0.89,0.66,0.47,0.56,0.19,0.76,0.97,0.63,0.25,0.31,0.96,0.07,0.05,0.66,0.24,0.87,0.73,0.66,0.4,0.31,0.24,0.6,0.97,0.66,0.79,0.13,0.3,0.68,0.95,0.4,0.31,0.04,0.89,0.85,0.26,0.11,0.55,0.99,0.45,0.62,0.29,0.9,0.18,0.01,0.98,0.06,0.52,0.32,0.87,0.6,0.2,0.73,0.91,0.53,0.37,0.32,0.23,0.99,0.31,0.89,0.12,0.9,0.65,0.2,0.22,0.53,0.07,0.53,0.04,0.03],
        filter: {
            source: {$exists: false}
        },
        topK: 400,
        includeValues: false,
        includeMetadata: true
    })
    const allIds = records.matches.map((record) => record.id)
    await index.deleteMany(allIds)
    return "Doneeeee"
  }
  async pushDocumentsToPinecone(files) {
    const fileData = files;
    // await index.deleteAll();
    let count = 1;
    for (const file of fileData) {
      const pdfData = await pdf_parse(file.buffer);
      const formattedText = await this.formatTextOpenAI(pdfData.text)
      const originalDocName = file.originalname;
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });
      const ragDoc = new RagDocs({
        docName: originalDocName,
        fullText: formattedText,
      });
      await ragDoc.save();
      const docs = await splitter.createDocuments([formattedText]);
      docs.forEach((doc) => {
        doc.id = uuid();
      });
      const batch_size = 100;
      let embeddings = [];
      for (let i = 0; i < docs.length; i += batch_size) {
        const i_end = Math.min(docs.length, i + batch_size);
        const meta_batch = docs.slice(i, i_end);
        const ids_batch = meta_batch.map((x) => x.id);
        const texts_batch = meta_batch.map((x) => x.pageContent);
        let response;
        try {
          response = await openai.embeddings.create({
            model: "text-embedding-3-large",
            input: texts_batch,
          });
        } catch (error) {
          console.log(error);
        }
        embeddings = response.data.map((record) => record.embedding);
        for (let j = 0; j < embeddings.length; j++) {
          docs[j + i].embeddings = embeddings[j];
        }
        const meta_batch_cleaned = meta_batch.map((x) => ({
          context: x.pageContent,
          docIdInDb: ragDoc._id,
          source: originalDocName
        }));
        const to_upsert = ids_batch.map((id, i) => ({
          id: id,
          values: embeddings[i],
          metadata: meta_batch_cleaned[i],
        }));
        await index.upsert(to_upsert);
        console.log("Successfully uploaded", i / 100);
      }
      ragDoc.docChunks = docs;
      await ragDoc.save();
      console.log("File Doneee", count);
      count++;
    }
    return "Doneeeeeeee";
  }
  async getRelevantContexts(question) {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: question,
    });
    const questionEmbedding = response.data[0].embedding;
    const queryResponse = await index.query({
      vector: questionEmbedding,
    //   filter: {
    //     docIdInDb: { $eq: docId.toString() },
    //   },
      topK: 5,
      includeMetadata: true,
    });
    const contexts = queryResponse.matches.map(
      (match) => match.metadata.context
    );
    const allSources = queryResponse.matches.map(
        (match) => match.metadata.source
      );
    // console.log("Contextsssss", queryResponse.matches)
    const finalContext = contexts
      .filter(function (str) {
        return str !== undefined;
      })
      .join("");
    const uniqueSources = [... new Set(allSources)];
    const finalSources = uniqueSources.join(", ")
    console.log("Final Sources", finalSources)
      const finalObj = {
        contexts: finalContext,
        sources: finalSources
      }
    return finalObj;
  }
  async askGPT(question, context, sources) {
    console.log("This is Sources", sources)
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            `You are a helpful assistant that answers the given question accurately based on the context provided to you. Do not hallucinate or answer the question by yourself. If you could not find the answer from the given context, reply with 'The provided context does not contain the answer to your question'. Give final answer in following JSON format:
            {
                answer: final answer of the question based on the context provided to you,
                sources: all the sources you received from ${sources}
            }`,
        },
        {
          role: "user",
          content: `Context: ${context}
            Question: ${question}`,
        },
      ],
      temperature: 0.4,
      response_format: {
        type: "json_object",
      }
    });
    return response.choices[0].message.content;
  }
  async summariseDocument(docId) {
    const document = await RagDocs.findById(docId);
    const model = new langchainOpenAI.OpenAI({
      temperature: 0,
      modelName: "gpt-4-turbo",
      maxTokens: 4000,
      topP: 1,
    });
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 5000,
      chunkOverlap: 100,
    });
    const docs = await textSplitter.createDocuments([document.fullText]);
    try {
      const chain = loadSummarizationChain(model, {
        type: "map_reduce",
      });
      const result = await chain.call({
        input_documents: docs,
      });
      console.log(result.text);
      return result.text;
    } catch (error) {
      console.log(error);
    }
    return "Errorrrrrrr";
  }
  async formatText(text) {
    return text
      .replace(/\n+/g, "\n\n") // Add extra space for new lines
      .replace(/([a-z])([A-Z])/g, "$1 $2") // Add space between camel case words
      .replace(/(\d)\.(?=\D)/g, "$1. ") // Add space after numbers followed by a period and non-digit
      .replace(/([a-z])(?=\d)/gi, "$1 ") // Add space before numbers if there's a letter before it
      .replace(/,\n/g, ",\n\n") // Add extra space after commas and new lines
      .replace(/([a-z]),([a-z])/gi, "$1, $2") // Add space after commas between letters
      .replace(/\n([a-z])/gi, "\n$1") // Remove unintended spaces at the start of new lines
      .replace(/●/g, "\n●") // Add new line before bullets
      .replace(/(\w)([A-Z])/g, "$1 $2") // Add space between camelCase
      .replace(/\s{2,}/g, " "); // Replace multiple spaces with a single space
  }
  async formatTextOpenAI(text) {
    const response = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that formats the given text properly. You will add proper punctuation, spaces between words and other necessary things to make the text more readable.",
        },
        {
          role: "user",
          content: `This is the text to be formatted
            Text: ${text}
            Return only the formatted text, nothing else extra`,
        },
        {
          role: "assistant",
          content: "Answer: ",
        },
      ],
      model: "gpt-3.5-turbo",
    });
    return response.choices[0].message.content;
  }
  async createAssistant() {
    try {
      const assistant = await openai.beta.assistants.create({
        name: "Document Based QnA Assitant",
        description: `You are a chatbot that specialises in answering the user's questions accurately. First retrieve the necessary context based on the user's question by calling the 'getRelevantContexts' tool. This tool returns both the 'context' and the 'sources'. Take both and the question as parameters in the 'askGPT' tool and then answer the user's question. Incorporate all the sources you receive into your final answer. Give response in JSON: {'answer': final answer you received, 'sources': ['source 1', ...more sources]}`,
        model: "gpt-4-turbo",
        tools: [
          {
            type: "function",
            function: {
              name: "getRelevantContexts",
              description:
                "Get the relevant contexts based on the user's question",
              parameters: {
                type: "object",
                properties: {
                  question: {
                    type: "string",
                    description: "The user's question",
                  },
                //   docId: {
                //     type: "string",
                //     description:
                //       "The ID of the document about which the user is asking the question",
                //   },
                },
                required: ["question"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "askGPT",
              description:
                "Get the answer for the user's question based on the context provided",
              parameters: {
                type: "object",
                properties: {
                  question: {
                    type: "string",
                    description: "The user's question",
                  },
                  context: {
                    type: "string",
                    description:
                      "The reference context from which the user's question will be answered",
                  },
                  sources: {
                    tyep: "string",
                    description: "Sources from which the context was provided.",
                  }
                },
                required: ["question", "context", "sources"],
              },
            },
          },
        //   {
        //     type: "function",
        //     function: {
        //       name: "summariseDocument",
        //       description: "Summarises the given document",
        //       parameters: {
        //         type: "object",
        //         properties: {
        //           docId: {
        //             type: "string",
        //             description:
        //               "The ID of the document about which the user is asking the question",
        //           },
        //         },
        //         required: ["docId"],
        //       },
        //     },
        //   },
        ],
        response_format: {
            type: "json_object",
        }
      });
      PineconeService.assistantId = assistant.id;
      console.log(PineconeService.assistantId);
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async createThread() {
    try {
      const thread = await openai.beta.threads.create();
      PineconeService.threadId = thread.id;
      console.log(PineconeService.threadId);
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async createMessage(userQuestion) {
    try {
      const message = await openai.beta.threads.messages.create(
        PineconeService.threadId,
        {
          role: "user",
          content: userQuestion,
        }
      );
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async createRun() {
    try {
      const run = await openai.beta.threads.runs.create(
        PineconeService.threadId,
        {
          assistant_id: PineconeService.assistantId,
          instructions:
            "You are a chatbot that specialises in answering the user's questions accurately. First retrieve the necessary context based on the user's question by calling the 'getRelevantContexts' tool. This tool returns both the 'context' and the 'sources'. Take both and the question as parameters in the 'askGPT' tool and then answer the user's question. Incorporate all the sources you receive into your final answer. Give response in JSON: {'answer': final answer you received, 'sources': ['source 1', ...more sources]}",
        }
      );
      PineconeService.runId = run.id;
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async waitForRunCompletion() {
    try {
      let runStatus = {
        status: "default",
      };
      while (runStatus.status != "completed") {
        runStatus = await openai.beta.threads.runs.retrieve(
          PineconeService.threadId,
          PineconeService.runId
        );
        console.log(runStatus.status);
        if(runStatus.status == "failed") {
          return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
        }
        if(runStatus.status == "expired") {
          return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
        }
        if (runStatus.status == "requires_action") {
          const requiredActions =
            runStatus.required_action.submit_tool_outputs.tool_calls;
          console.log(requiredActions);
          const toolsOutput = [];
          for (let action of requiredActions) {
            const funcName = action.function.name;
            const parameters = JSON.parse(action.function.arguments);
            if (funcName === "getRelevantContexts") {
              const context = await this.getRelevantContexts(
                parameters.question,
                // parameters.docId
              );
              toolsOutput.push({
                tool_call_id: action.id,
                output: JSON.stringify(context),
              });
            } else if (funcName === "askGPT") {
              const answer = await this.askGPT(
                parameters.question,
                parameters.context,
                parameters.sources
              );
              toolsOutput.push({
                tool_call_id: action.id,
                output: JSON.stringify(answer),
              });
            } 
            // else if (funcName === "summariseDocument") {
            //   const summary = await this.summariseDocument(parameters.docId);
            //   toolsOutput.push({
            //     tool_call_id: action.id,
            //     output: JSON.stringify(summary),
            //   });
            // } 
            else {
              console.log("Unknown Function");
            }
          }
          await openai.beta.threads.runs.submitToolOutputs(
            PineconeService.threadId,
            PineconeService.runId,
            { tool_outputs: toolsOutput }
          );
        }
        await this.sleep(1000);
      }
      return runStatus.status;
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async retrieveResponse() {
    try {
      const threadMessages = await openai.beta.threads.messages.list(
        PineconeService.threadId
      );
      const messages = threadMessages.data;
      console.log(messages[0].content[0].text.value);
      return messages[0].content[0].text.value;
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async askQna(question) {
    // const finalQuestion = `
    // Question: ${question}
    // DocumentID: ${docId}`;
    if (PineconeService.assistantId == "") {
      await this.createAssistant();
      console.log("Assistant Created");
    }
    if (PineconeService.assistantId != "" && PineconeService.threadId == "") {
      await this.createThread();
      console.log("Thread Created");
    }
    if (PineconeService.assistantId != "" && PineconeService.threadId != "") {
      await this.createMessage(question);
      console.log("Message Added to Thread");
    }
    if (
      PineconeService.assistantId != "" &&
      PineconeService.threadId != "" &&
      PineconeService.runId == ""
    ) {
      await this.createRun();
      console.log("Run Created");
    }
    if (PineconeService.runId != "") {
      const status = await this.waitForRunCompletion();
      if (status == "completed") {
        PineconeService.runId = "";
        return await this.retrieveResponse();
      }
      return "Run Not Yet Complete";
    }
    return "Error";
  }
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new PineconeService();
