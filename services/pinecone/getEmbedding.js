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
      // const accessToken = 'ya29.a0AXooCguZex0AfVJKNDcKupzWr_xJxfPW_Y9M5iEtUMF6titcMYou7VWIQsAtxH3hnKDgcfgysN5eL5C0dZEmtW3KkwbKRFXBGCWf_Gmq2fJOxlMY-Eisq6iIT_BLjRI_2ldRj45m2EvoXnZTDTXdiFi9uOwJHRQ3yqV3JrsY3BL5L_roIdF-GR2P-f8XgweEuzn2qGgeY_GgVYKj3eGxgqDZas3gZ3sP3qHI1Wg9HW1B-0VKbI2krCQLvH8guJq4gdEEeb3KHEviH4n8BgzzxeorBaEUjow1EtwGpTHO9KoprYyQqlS8-H0f-pbUn9EnfvonYXFWF5VdvABeLOT3CADwd2uRVoSERhShGikPvDLyUt_qtMBc3Eos2E0z4FavNij-2kgG0LXn_3_bkFkIgctlz7AUuHIaCgYKAeoSARMSFQHGX2MiSH7xchANFl4zIExUzBdfpQ0422'
      // const accessToken = await auth.getAccessToken();
      // const response = await axios.post(
      //   'https://us-central1-aiplatform.googleapis.com/v1/projects/ondc-ccai-app-14062024/locations/us-central1/publishers/google/models/text-embedding-004:predict',
      //   {
      //     instances: [{ content: data }],
      //     parameters: { autoTruncate: autoTruncate }
      //   },
      //   {
      //     headers: {
      //       Authorization: `Bearer ${accessToken}`,
      //       'Content-Type': 'application/json; charset=utf-8'
      //     }
      //   }
      // )
      // console.log('response.data.predictions[0]', response.data.predictions[0])
      console.log("inside emmmmmm");
      console.log("Generating embedding for text.");
      const model = new GoogleVertexAIEmbeddings();
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
