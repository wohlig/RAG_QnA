const axios = require("axios");
// const auth = require('../utils/auth'); // Adjust the path as necessary
const {
  GoogleVertexAIEmbeddings,
} = require("@langchain/community/embeddings/googlevertexai");
const fs = require("fs");
const keys = process.env.GOOGLE_VERTEX_SECRETS
fs.writeFileSync(`${__dirname}/vertexkeys.json`, keys);
// GOOGLE_APPLICATION_CREDENTIALS environment variable to the path of this file.
process.env.GOOGLE_APPLICATION_CREDENTIALS = `${__dirname}/vertexkeys.json`;
class EmbeddingService {
  async getEmbedding(data, autoTruncate = true) {
    try {
      console.log("Generating embedding for text.");
      const model = new GoogleVertexAIEmbeddings({model:"text-embedding-004"});
      const res = await model.embedQuery(data);
      console.log("Embedding generated.");
      return res;
      // return response.data.predictions[0].embeddings.values;
    } catch (error) {
      console.error("Error fetching embeddings from GCP:", error);
      throw error;
    }
  }
}

module.exports = new EmbeddingService();
