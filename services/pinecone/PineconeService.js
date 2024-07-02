const fs = require("fs");
const path = require("path");
const keys = process.env.GOOGLE_SECRETS;
fs.writeFileSync(path.join(__dirname, "keys.json"), keys);
const keys2 = process.env.GOOGLE_VERTEX_SECRETS;
fs.writeFileSync("./vertexkeys.json", keys2);

const __constants = require("../../config/constants");
const { compile } = require("html-to-text");
const { v4: uuidv4 } = require("uuid");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { BigQuery } = require("@google-cloud/bigquery");
const {
  RecursiveUrlLoader,
} = require("@langchain/community/document_loaders/web/recursive_url");
const RagDocs = require("../../mongooseSchema/RagDocs");

const bigquery = new BigQuery({
  keyFilename: path.join(__dirname, "keys.json"),
});
const aiplatform = require("@google-cloud/aiplatform");
const { PredictionServiceClient } = aiplatform.v1;
const { helpers } = aiplatform;
const clientOptions = { apiEndpoint: "us-central1-aiplatform.googleapis.com" };
const location = "us-central1";
const endpoint = `projects/${process.env.PROJECT_ID}/locations/${location}/publishers/google/models/text-embedding-004`;
const parameters = helpers.toValue({
  outputDimensionality: 768,
});
console.log("parameters>>>>", parameters);
const { ChatVertexAI } = require("@langchain/google-vertexai");
const { z } = require("zod");
const model = new ChatVertexAI({
  authOptions: {
    credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
  },
  temperature: 0,
  model: "gemini-1.5-flash",
  maxOutputTokens: 8192,
});
const pdf_parse = require("pdf-parse");

class PineconeService {
  async pushWebsiteDataToBigQuery(urls) {
    for (const url of urls) {
      try {
        console.log("Processing URL:", url);
        const compiledConvert = compile({ wordwrap: 130 });
        const loader = new RecursiveUrlLoader(url, {
          extractor: compiledConvert,
          maxDepth: 1,
        });
        const websiteData = await loader.load();

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 5000,
          chunkOverlap: 500,
        });
        const docs = await splitter.splitDocuments([websiteData[0]]);
        docs.forEach((doc) => {
          doc.id = uuidv4();
        });

        const batch_size = 100;
        for (let i = 0; i < docs.length; i += batch_size) {
          const i_end = Math.min(docs.length, i + batch_size);
          const meta_batch = docs.slice(i, i_end);
          const ids_batch = meta_batch.map((x) => x.id);
          const texts_batch = meta_batch.map(
            (x) =>
              `This is from url: ${url}, content: ${x.pageContent.replace(
                /;/g,
                ""
              )}`
          );

          const embeddings = await Promise.all(
            texts_batch.map((text) =>
              this.callPredict(text, "RETRIEVAL_DOCUMENT")
            )
          );

          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            source: doc.metadata.source || url,
            title: doc.metadata.title || "N/A",
            context: `This is from url: ${url}, content: ${doc.pageContent}`,
            embedding: embeddings[index],
          }));

          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_gemini")
            .insert(rows);
          console.log("Successfully uploaded batch", Math.floor(i / 100) + 1);
        }

        console.log("URL Processed:", url);
      } catch (error) {
        console.error("Error processing URL:", url, error.message);
      }
    }
    return "Completed";
  }

  async pushDocumentsToBigQuery(files) {
    const fileData = files;

    for (const file of fileData) {
      try {
        const pdfData = await pdf_parse(file.buffer);
        let formattedText = pdfData.text;
        // let formattedText = await this.formatTextOpenAI(pdfData.text);

        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 1000,
          chunkOverlap: 200,
        });
        const docs = await splitter.createDocuments([formattedText]);
        docs.forEach((doc) => {
          doc.id = uuidv4();
        });

        const batch_size = 100;
        for (let i = 0; i < docs.length; i += batch_size) {
          const i_end = Math.min(docs.length, i + batch_size);
          const meta_batch = docs.slice(i, i_end);
          const ids_batch = meta_batch.map((x) => x.id);
          const texts_batch = meta_batch.map((x) => x.pageContent);

          const embeddings = await this.getEmbeddingsBatch(texts_batch);

          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            embedding: embeddings[index],
            context: doc.pageContent,
            source: file.originalname,
            title: file.originalname,
          }));

          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_table")
            .insert(rows);
          console.log("Successfully uploaded", i / 100);
        }

        console.log("File Processed:", file.originalname);
      } catch (error) {
        console.error(
          "Error processing file:",
          file.originalname,
          error.message
        );
      }
    }
    return "Completed";
  }

  async getEmbeddingsBatch(texts) {
    return Promise.all(
      texts.map((text) =>
        this.callPredict(text.replace(/;/g, ""), "RETRIEVAL_DOCUMENT")
      )
    );
  }

  async getRelevantContextsBigQuery(question, sourcesArray) {
    const questionEmbedding = await this.callPredict(
      question.replace(/;/g, ""),
      "QUESTION_ANSWERING"
    );
    const embeddingString = `[${questionEmbedding.join(", ")}]`;
    const sourcesArrayInString = `(${sourcesArray
      .map((source) => `'${source}'`)
      .join(", ")})`;
    console.log("sourcessss", sourcesArrayInString);
    let query = `SELECT DISTINCT base.context AS context,
                      base.source AS source
                      FROM
                      VECTOR_SEARCH(
                        TABLE ondc_dataset.ondc_gemini,
                        'embedding',
                          (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_gemini),
                        top_k => 20,
                        distance_type => 'COSINE'
                      ) 
                      WHERE base.source NOT IN ${sourcesArrayInString};`;
    if (sourcesArrayInString == "()") {
      query = `SELECT DISTINCT base.context AS context,
      base.source AS source
      FROM 
      VECTOR_SEARCH(
        TABLE ondc_dataset.ondc_gemini,
        'embedding',
          (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_gemini),
        top_k => 20,
        distance_type => 'COSINE'
      );`;
    }
    try {
      const [rows] = await bigquery.query({ query });
      // console.log("Rows>>>>", rows);
      const contexts = rows.map((row) => row.context);
      // const allSources = rows.map((row) => row.source);

      // const finalContext = contexts.join(" ");
      // const uniqueSources = [...new Set(allSources)];
      // const finalSources = uniqueSources.join(", ");
      // console.log("Data>>>>>>>>", {
      //   contexts: finalContext,
      //   sources: finalSources,
      // });
      return {
        contexts: contexts,
        // sources: finalSources,
      };
    } catch (error) {
      console.error("Error querying BigQuery:", error);
      throw error;
    }
  }

  async askGemini(question, context, promptBody) {
    let prompt = `You are a helpful assistant that answers the given question accurately based on the context provided to you. Make sure you answer the question in as much detail as possible, providing a comprehensive explanation. Do not hallucinate or answer the question by yourself`;
    if (promptBody) {
      console.log("Prompt Body:", promptBody);
      prompt = promptBody;
      // prompt +=
      //   ' Give the final answer in the following JSON format: {\n  "answer": final answer of the question based on the context provided to you,\n}';
    }
    if (question.toLowerCase().includes("steps")) {
      prompt +=
        'Also, provide the name of the sources from where you fetched the answer.Make sure you only provide the relevant sources from the answer was taken, Also if there is some version mentioned in the question, then please return the sources of that versions only.  Provide the final answer in numbered steps. Give the final answer in the following format, First give the answer, label it as "Answer:", then all sources fetched for answer and label it as "Sources:", Dont give the answer in json or array, just the steps trailed by comma or new line, for sources only provide the url or file name spearated by comma, dont add any prefix or suffix to the sources.';
    } else {
      prompt +=
        ' Also, provide the name of the sources from where you fetched the answer. Make sure you only provide the relevant sources from the answer was taken,  Also if there is some version mentioned in the question, then please return the sources of that versions only and get the answer from the contnet of that particular version only, dont take answer from any other version content. Give the final answer in the following format, First give the answer, label it as "Answer:", then all sources fetched for answer and label it as "Sources:",  for sources only provide the url or file name spearated by comma, dont add any prefix or suffix to the sources.';
    }

    try {
      const response = await model.invoke(
        prompt +
          "\n" +
          `Context: ${context}\nQuestion: ${question} and if possible explain the answer with every detail possible`
      );
      console.log("Response from Gemini:", response.content);
      return response.content;
    } catch (error) {
      console.error("Error invoking Gemini model:", error);
      throw error;
    }
  }
  async makeDecisionAboutVersionFromGemini(question) {
    try {
      const model = new ChatVertexAI({
        temperature: 0,
        model: "gemini-1.5-pro",
      });
      const structuredSchema = z.object({
        isVersion: z.string().describe("'Yes' or 'No'"),
        newQuestion: z.string().describe("the rephrased question"),
      });
      const structuredModel = model.withStructuredOutput(structuredSchema);
      const response =
        await structuredModel.invoke(`Given a list of document names with their latest version numbers, analyze the user's question to determine if it relates to a specific version. Recognize version numbers in formats like "v1.1", "v2.0", etc. Do not assume every alphanumeric combination as a version number. Any question related to "TRV11" or "TRV10" is not a version-related question.
        Example: "How many flows are present in TRV11?" should not be treated as a version-related question just because it contains "V11" in it. Instead if there is a mention of "version 1.1" or "v1.2" or "v 1.2" in the user's question, then consider it as a version-related question.
        If unsure whether a query relates to a document version, return isVersion as "No" and rephrased question as empty string.
        If question is related to a specific version, rephrase the question to include the exact document name. If not, return an empty string. 
        Question: ${question}
        Document list:
        [Fashion MVP [Addition to Retail MVP]-Draft-v0.3.pdf, MVP_ Electronics and Electrical Appliances_v 1.0.pdf, ONDC - API Contract for Logistics (v1.1.0)_Final.pdf, ONDC - API Contract for Logistics (v1.2.0).pdf, ONDC - API Contract for Retail (v1.1.0)_Final.pdf, ONDC - API Contract for Retail (v1.2.0).pdf, Test Case Scenarios - v1.1.0.pdf, ONDC API Contract for IGM_MVP_v1.0.0.pdf]
        
        Instructions:
        1. Check if the user's question mentions a specific version.
        2. Do not assume every alphanumeric combination is a version number
        3. If unsure whether the question relates to a document version, do not rephrase it
        4. If a version is mentioned in user's question:
           a. Identify the corresponding document name from the list.
           b. If no document found, return isVersion as 'No' and rephrased question as empty string
           c. if document found, rephrase the question to include the exact document name.
           d. Return the rephrased question.
        5. If no version is mentioned in the user's question, return an empty string.
        `);
      console.log(response);
      return response;
    } catch (error) {
      console.error("Error invoking Gemini model:", error);
      throw error;
    }
  }
  async askQna(question, prompt) {
    try {
      let finalQuestion = question;
      const versionLayer = await this.makeDecisionAboutVersionFromGemini(
        finalQuestion
      );
      // return versionLayer
      let oldVersionArray = [];
      if (versionLayer.isVersion == "No") {
        oldVersionArray = [
          "ONDC - API Contract for Logistics (v1.1.0)_Final.pdf",
          "ONDC - API Contract for Logistics (v1.1.0).pdf",
          "ONDC - API Contract for Retail (v1.1.0)_Final.pdf",
          "ONDC - API Contract for Retail (v1.1.0).pdf",
          "ONDC API Contract for IGM (MVP) v1.0.0.docx.pdf",
          "ONDC API Contract for IGM (MVP) v1.0.0.pdf",
          "ONDC API Contract for IGM MVP v1.0.0.pdf",
        ];
      } else {
        finalQuestion = versionLayer.newQuestion;
      }
      const context = await this.getRelevantContextsBigQuery(
        finalQuestion,
        oldVersionArray
      );
      // const context = await this.getRelevantContextsBigQuery(question);
      console.log("context...", context);
      let response = await this.askGemini(
        finalQuestion,
        context.contexts,
        prompt
      );
      const answer = "Answer:";
      const sources = "Sources:";

      let answerStart = response.indexOf(answer) + answer.length;
      let answerEnd = response.indexOf(sources);
      let answerText = response.substring(answerStart, answerEnd);
      answerText = answerText.trim();
      let sourcesText = response.substring(answerEnd + sources.length);
      console.log("answerText", answerText);
      console.log("sourcesText", sourcesText);
      // remove * from sourcesText
      sourcesText = sourcesText.replace(/\*/g, "");
      // convert sourcesText to array
      let sourcesArray = sourcesText.split(",");
      sourcesArray = sourcesArray.map((source) => source.trim());
      // keep onnly unique sources
      sourcesArray = [...new Set(sourcesArray)];
      console.log("sourcesArray", sourcesArray);
      const returnObj = {
        answer: answerText,
        sources: sourcesArray,
      };
      return returnObj;
    } catch (error) {
      console.log("Error in askQna", error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }

  async callPredict(text, task, title = "") {
    try {
      let instances;
      if (!title) {
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task }));
      }
      else {
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task, title: title }));
      }
      const request = { endpoint, instances, parameters };
      const client = new PredictionServiceClient(clientOptions);
      const [response] = await client.predict(request);
      const predictions = response.predictions;

      for (const prediction of predictions) {
        const embeddings = prediction.structValue.fields.embeddings;
        const values = embeddings.structValue.fields.values.listValue.values;
      }
      const embeddings = predictions[0].structValue.fields.embeddings;
      const values = embeddings.structValue.fields.values.listValue.values;
      console.log("Embeddings creaetd");
      return values.map((value) => value.numberValue);
    } catch (error) {
      console.error("Error calling predict:", error);
      throw error;
    }
  }
}

module.exports = new PineconeService();
