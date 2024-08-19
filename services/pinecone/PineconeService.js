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
const { ChatVertexAI } = require("@langchain/google-vertexai");
const { z } = require("zod");
const model = new ChatVertexAI({
  authOptions: {
    credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
  },
  temperature: 0,
  model: "gemini-1.5-pro",
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
              this.callPredict(text, "RETRIEVAL_DOCUMENT", url)
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
            .table("ondc_geminititle")
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
          chunkSize: 5000,
          chunkOverlap: 500,
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
          const texts_batch = meta_batch.map((x) => ({
            content: `This is from file: ${file.originalname} , Content: ${x.pageContent}`
            }));
          const embeddings = await this.getEmbeddingsBatch(texts_batch,file.originalname);
          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            embedding: embeddings[index],
            context: `This is from file: ${file.originalname} , Content: ${doc.pageContent}`,
            source: file.originalname,
            title: file.originalname,
          }));

          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_geminititle")
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

  async getEmbeddingsBatch(texts, file_name) {
    return Promise.all(
      texts.map((text) =>
        this.callPredict(text.content.replace(/;/g, ""), "RETRIEVAL_DOCUMENT", file_name)
      )
    );
  }

  async getRelevantContextsBigQuery(question, sourcesArray, documentName) {
    const questionEmbedding = await this.callPredict(
      question.replace(/;/g, ""),
      "QUESTION_ANSWERING"
    );
    const embeddingString = `[${questionEmbedding.join(", ")}]`;
    const sourcesArrayInString = `(${sourcesArray
      .map((source) => `'${source}'`)
      .join(", ")})`;
    let query = `SELECT DISTINCT base.context AS context,
                      base.source AS source
                      FROM
                      VECTOR_SEARCH(
                        TABLE ondc_dataset.ondc_geminititle,
                        'embedding',
                          (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_geminititle),
                        top_k => 20,
                        distance_type => 'COSINE'
                      ) 
                      WHERE base.source NOT IN ${sourcesArrayInString};`;
    if (sourcesArrayInString == "()") {
      query = `SELECT DISTINCT base.context AS context,
      base.source AS source
      FROM 
      VECTOR_SEARCH(
        TABLE ondc_dataset.ondc_geminititle,
        'embedding',
          (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_geminititle),
        top_k => 20,
        distance_type => 'COSINE'
      )
      WHERE base.source IN ('${documentName}');`;
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

  async getPrompt(question, promptBody) {
    let prompt = `You are a helpful assistant that answers the given question accurately based on the context provided to you. Make sure you answer the question in as much detail as possible, providing a comprehensive explanation. Do not hallucinate or answer the question by yourself`;
    if (promptBody) {
      console.log("Prompt Body:", promptBody);
      prompt = promptBody;
    }
    if (question.toLowerCase().includes("steps")) {
      prompt +=
        " Provide the final answer in numbered steps. Also explain each steps in detail. Give the final answer in the following format, give the answer directly, dont add any prefix or suffix, Dont give the answer in json or array, just the steps trailed by comma or new line. Dont attach any reference or sources in the answer";
    } else {
      prompt +=
        " If there is some version mention in the question, then get the answer from the contnet of that particular version only, dont take answer from any other version content. If the answer contains any APIs, then explain each API in detail as well. If the context contains any contract link relevant to the answer, then provide that link in the answer too. If an example or sample payload can be used to better explain the answer, provide that in the final answer as well. Give the final answer in the following format, give the answer directly, dont add any prefix or suffix. Dont attach any reference or sources in the answer";
    }
    return prompt;
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
        documentName: z.string().describe("exact name of the document"),
      });
      const structuredModel = model.withStructuredOutput(structuredSchema);
      const response =
        await structuredModel.invoke(`Given a list of document names with their latest version numbers, analyze the user's question to determine if it relates to a specific version. Recognize version numbers in formats like "v1.1", "v2.0", etc. Do not assume every alphanumeric combination as a version number. Any question related to "TRV11" or "TRV10" is not a version-related question.
        Example: "How many flows are present in TRV11?" should not be treated as a version-related question just because it contains "V11" in it. Instead if there is a mention of "version 1.1" or "v1.2" or "v 1.2" in the user's question, then consider it as a version-related question. Do not consider TRV11, TRV10 or RET11 or ONDC:RET11 as a version-related question.
        If unsure whether a query relates to a document version, return isVersion as "No" and rephrased question as empty string.
        If question is related to a specific version, rephrase the question to include the exact document name. If not, return an empty string. 
        Question: ${question}
        Document list:
        [Fashion MVP [Addition to Retail MVP]-Draft-v0.3.pdf, MVP_ Electronics and Electrical Appliances_v 1.0.pdf, ONDC - API Contract for Logistics (v1.1.0)_Final.pdf, ONDC - API Contract for Logistics (v1.2.0).pdf, ONDC - API Contract for Retail (v1.1.0)_Final.pdf, ONDC - API Contract for Retail (v1.2.0).pdf, Test Case Scenarios - v1.1.0.pdf, ONDC API Contract for IGM_MVP_v1.0.0.pdf]
        
        Instructions:
        1. Check if the user's question mentions a specific version.
        2. Do not assume every alphanumeric combination is a version number
        3. Also, return the exact name of the document from which the question was asked.
        4. If unsure whether the question relates to a document version, do not rephrase it
        5. If a version is mentioned in user's question:
           a. Identify the corresponding document name from the list.
           b. If no document found, return isVersion as 'No' and rephrased question as empty string
           c. If document found, rephrase the question to include the exact document name.
           d. Return the rephrased question along with the exact document name.
        6. If no version is mentioned in the user's question, return newQuestion and documentName as an empty string.
        `);
      console.log(response);
      return response;
    } catch (error) {
      console.error("Error invoking Gemini model:", error);
      throw error;
    }
  }
  async askQna(question, prompt, sessionId, chatId) {
    try {
      let finalQuestion = question;
      let chat = await Chat.findOne({sessionId: chatId})
     if(chat) {
       console.log("Making Decision")
       const decision = await this.makeDecisionFromGemini(
         question, chat
       );
       if (decision.answer == "Yes") {
         finalQuestion = decision.newQuestion;
       }
     }

      const versionLayer = await this.makeDecisionAboutVersionFromGemini(
        finalQuestion
      );
      // return versionLayer
      let documentName;
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
        documentName = versionLayer.documentName;
        finalQuestion = versionLayer.newQuestion;
      }
      const context = await this.getRelevantContextsBigQuery(
        finalQuestion,
        oldVersionArray,
        documentName
      );
      // const context = await this.getRelevantContextsBigQuery(question);
      let finalPrompt = await this.getPrompt(finalQuestion, prompt);
      var answerStream;
      var sourcesArray;
      if (sessionId) {
        [answerStream, sourcesArray] = await Promise.all([
          this.streamAnswer(finalPrompt, context.contexts, question, sessionId),
          this.getSources(question, context),
        ]);
      } else {
        [answerStream, sourcesArray] = await Promise.all([
          this.directAnswer(finalPrompt, context.contexts, question),
          this.getSources(question, context),
        ]);
      }

      console.log("Getting sources");

      console.log("sourcesArray", sourcesArray);
      return {
        answer: answerStream,
        sources: sourcesArray,
      };
    } catch (error) {
      console.log("Error in askQna", error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }

  async callPredict(text, task, title = "") {
    try {
      let instances;
      if (task==="RETRIEVAL_DOCUMENT" && title) {
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task, title: title }));
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task }));
      }
      else {
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task }));
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
  async streamAnswer(finalPrompt, context, question, sessionId) {
    const answerStream = await model.stream(
      finalPrompt +
        "\n" +
        `Context: ${context}\nQuestion: ${question} and if possible explain the answer with every detail possible`
    );
    let finalResponse = "";
    if (sessionId) {
      for await (const response of answerStream) {
        finalResponse += response.content;
        console.log("response", response.content);
        io.to(sessionId).emit("response", response.content);
      }
      console.log("Done");
    }
    console.log("finalResponse", finalResponse);
    return finalResponse;
  }
  async directAnswer(finalPrompt, context, question) {
    const response = await model.invoke(
      finalPrompt +
        "\n" +
        `Context: ${context}\nQuestion: ${question} and if possible explain the answer with every detail possible`
    );
    return response.content;
  }
  async getSources(question, context) {
    const sourcesmodel = new ChatVertexAI({
      authOptions: {
        credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
      },
      temperature: 0,
      model: "gemini-1.5-pro",
      maxOutputTokens: 500,
    });
    const sourcesResponse = await sourcesmodel.invoke(
      `Below is the question and the context from which the answer is to be fetched. You need to provide the sources from where the answer of the question is present. Make sure you only provide the relevant sources where the answer can be fetched from, Also if there is some version mentioned in the question, then please return the sources of that versions only. Make sure you return the sources separated by comma (,) For sources only provide the url or file name spearated by comma, dont add any prefix or suffix while giving the response. Give name of the sources exact as provided in the context. Be accurate in provide the sources, only provide those source where answer is present for the question. \nQuestion: ${question}\nContext: ${context.contexts}`
    );
    console.log("Getting sources done");

    let sourcesArray = sourcesResponse.content.split(",");
    sourcesArray = sourcesArray.map((source) => source.trim());
    sourcesArray = [...new Set(sourcesArray)];
    sourcesArray = sourcesArray.filter((source) => source !== "");
    return sourcesArray;
  }
}

module.exports = new PineconeService();
