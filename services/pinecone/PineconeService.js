const fs = require("fs");
const path = require("path");
const keys = process.env.GOOGLE_SECRETS;
fs.writeFileSync(path.join(__dirname, "keys.json"), keys);
const keys2 = process.env.GOOGLE_VERTEX_SECRETS;
fs.writeFileSync("./vertexkeys.json", keys2);
const { StructuredOutputParser } = require("@langchain/core/output_parsers");
const { RunnableSequence } = require("@langchain/core/runnables");
const {
  ChatPromptTemplate,
  MessagesPlaceholder,
} = require("@langchain/core/prompts");

// Access your API key as an environment variable
// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const __constants = require("../../config/constants");
const { compile } = require("html-to-text");
const { v4: uuidv4 } = require("uuid");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { BigQuery } = require("@google-cloud/bigquery");
const {
  RecursiveUrlLoader,
} = require("@langchain/community/document_loaders/web/recursive_url");

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
// const chatHistoryONDC = [];
// const chatHistoryDummy = [];
const { BufferMemory, ChatMessageHistory } = require("langchain/memory");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const { ConversationChain } = require("langchain/chains");
const safetySettings = [
  {
    category: "HARM_CATEGORY_HARASSMENT",
    threshold: "BLOCK_ONLY_HIGH",
  },
  {
    category: "HARM_CATEGORY_HATE_SPEECH",
    threshold: "BLOCK_ONLY_HIGH",
  },
  {
    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
    threshold: "BLOCK_ONLY_HIGH",
  },
  {
    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
    threshold: "BLOCK_ONLY_HIGH",
  },
];
const { ChatVertexAI } = require("@langchain/google-vertexai");
const { z } = require("zod");
const model = new ChatVertexAI({
  authOptions: {
    credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
  },
  temperature: 0,
  model: "gemini-1.5-pro",
  maxOutputTokens: 8192,
  safetySettings: safetySettings,
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
            .table("ondc_geminititle_copy")
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

  async pushTextDataToBigQuery() {
    const texts = [
      {
        context: "The MD and CEO of ONDC is T Koshy",
        title: "All About Open Network for Digital Commerce",
        source: "https://ondc.org/about-ondc/",
      },
    ];

    for (const text of texts) {
      try {
        console.log("Processing text from source:", text.source);
        const title = text.title;
        console.log("title", title);
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 5000,
          chunkOverlap: 500,
        });
        const docs = await splitter.createDocuments([text.context]);
        docs.forEach((doc) => {
          doc.id = uuidv4();
        });

        const batch_size = 100;
        for (let i = 0; i < docs.length; i += batch_size) {
          const i_end = Math.min(docs.length, i + batch_size);
          const meta_batch = docs.slice(i, i_end);
          const ids_batch = meta_batch.map((x) => x.id);
          const texts_batch = meta_batch.map((x) => x.pageContent);

          const embeddings = await Promise.all(
            texts_batch.map((text) =>
              this.callPredict(text, "RETRIEVAL_DOCUMENT")
            )
          );
          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            source: text.source,
            title: text.title,
            context: `This is from url: ${text.source}, content: ${doc.pageContent}`,
            embedding: embeddings[index],
          }));
          console.log("rows", rows);
          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_geminititle")
            .insert(rows);
          console.log("Successfully uploaded batch", Math.floor(i / 100) + 1);
        }
      } catch (error) {
        console.error("Error processing text:", error);
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
            content: `This is from file: ${file.originalname} , Content: ${x.pageContent}`,
          }));
          const embeddings = await this.getEmbeddingsBatch(
            texts_batch,
            file.originalname
          );
          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            embedding: embeddings[index],
            context: `This is from file: ${file.originalname} , Content: ${doc.pageContent}`,
            source: file.originalname,
            title: file.originalname,
          }));

          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_geminititle_copy")
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
        this.callPredict(
          text.content.replace(/;/g, ""),
          "RETRIEVAL_DOCUMENT",
          file_name
        )
      )
    );
  }

  async createQuestEmbeddings(rows, sessionId) {
    for (const row of rows) {
      console.log("rowasddsa", row);
      try {
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: 5000,
          chunkOverlap: 500,
        });
        const docs = await splitter.createDocuments([row.question]);
        docs.forEach((doc) => {
          doc.id = uuidv4();
        });
        for (let i = 0; i < docs.length; i += 1) {
          const i_end = Math.min(docs.length, i + 1);
          const meta_batch = docs.slice(i, i_end);
          const embeddings = await this.callPredictForQues(
            row.question,
            "QUESTION_ANSWERING"
          );

          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            embedding: embeddings,
            questions: row.question,
            feedback: "negative",
          }));
          console.log("rows", rows);
          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_quest_emb")
            .insert(rows);
          console.log("Successfully uploaded");
        }
      } catch (error) {
        console.error("Error inserting rows into BigQuery:", error);
        throw error;
      }
    }
  }

  async callPredictForQues(text, task, title = "") {
    console.log("task", task);
    try {
      console.log("title>>>>>", title);
      console.log("TEXTTTTT", text);
      let instances;
      if (task === "RETRIEVAL_DOCUMENT" && title) {
        instances = text
          .split(";")
          .map((e) =>
            helpers.toValue({ content: e, taskType: task, title: title })
          );
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task }));
      } else {
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

  async getRelevantQuestionsBigQuery(question) {
    const questionEmbedding = await this.callPredict(
      question.replace(/;/g, ""),
      "QUESTION_ANSWERING"
    );
    const embeddingString = `[${questionEmbedding.join(", ")}]`;
    let query = `SELECT base.questions AS question, base.embedding AS embedding, base.feedback AS feedback, distance
    FROM
    VECTOR_SEARCH(
      TABLE ondc_dataset.ondc_quest_emb,
      'embedding',
        (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_quest_emb),
      top_k => 3,
      distance_type => 'COSINE'
    )`;
    try {
      let newQuestion = question;
      let newEmbedding = questionEmbedding;
      const feedback = "positive";
      const [rows] = await bigquery.query({ query });

      for (const row of rows) {
        if (row.feedback === "positive" && row.distance < 0.1) {
          console.log("Found similar question", row.question);
          newQuestion = row.question;
          newEmbedding = row.embedding;
          break;
        }
        if (row.feedback === "negative" && row.distance < 0.1) {
          console.log("Negative feedback found", row.question);
          feedback = "negative";
          break;
        }
      }
      return {
        requestion: newQuestion,
        embedding: newEmbedding,
        feedback: feedback,
      };
    } catch (error) {
      console.error("Error querying BigQuery:", error);
      throw error;
    }
  }

  async getRelevantContextsBigQuery(embedding) {
    const questionEmbedding = embedding;
    const embeddingString = `[${questionEmbedding.join(", ")}]`;
    // const sourcesArrayInString = `(${sourcesArray
    //   .map((source) => `'${source}'`)
    //   .join(", ")})`;
    let query = `SELECT DISTINCT base.context AS context,
                      base.source AS source
                      FROM
                      VECTOR_SEARCH(
                        TABLE ondc_dataset.ondc_gemini,
                        'embedding',
                          (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_gemini),
                        top_k => 20,
                        distance_type => 'COSINE'
                      ) `;
    // if (sourcesArrayInString == "()") {
    //   query = `SELECT DISTINCT base.context AS context,
    //   base.source AS source
    //   FROM 
    //   VECTOR_SEARCH(
    //     TABLE ondc_dataset.ondc_geminititle_copy,
    //     'embedding',
    //       (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_geminititle_copy),
    //     top_k => 20,
    //     distance_type => 'COSINE'
    //   )
    //   WHERE base.source IN ('${documentName}');`;
    // }
    try {
      const [rows] = await bigquery.query({ query });
      const contexts = rows.map((row) => row.context);

      return {
        contexts: contexts,
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
      console.log("Making Decision");
      const model = new ChatVertexAI({
        temperature: 0,
        model: "gemini-1.5-pro",
        safetySettings: safetySettings,
      });
      const structuredSchema = z.object({
        isVersion: z.string().describe("'Yes' or 'No'"),
        newQuestion: z.string().describe("the rephrased question"),
        documentName: z.string().describe("exact name of the document"),
      });
      const parser = StructuredOutputParser.fromZodSchema(structuredSchema);

      const chain = RunnableSequence.from([
        ChatPromptTemplate.fromTemplate(
          `Given a list of document names with their latest version numbers, analyze the user's question to determine if it relates to a specific version. Recognize version numbers in formats like "v1.1", "v2.0", etc. Do not assume every alphanumeric combination as a version number. Any question related to "TRV11" or "TRV10" is not a version-related question.
          Example: "How many flows are present in TRV11?" should not be treated as a version-related question just because it contains "V11" in it. Instead if there is a mention of "version 1.1" or "v1.2" or "v 1.2" in the user's question, then consider it as a version-related question. Do not consider TRV11, TRV10 or RET11 or ONDC:RET11 as a version-related question.
          If unsure whether a query relates to a document version, return isVersion as "No" and rephrased question as empty string.
          If question is related to a specific version, rephrase the question to include the exact document name. If not, return an empty string. 
          Question: {question}
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
          
          Format Instructions: {format_instructions}
          `
        ),
        model,
        parser,
      ]);

      const response = await chain.invoke({
        question: question,
        format_instructions: parser.getFormatInstructions(),
      });

      console.log("Descision about version: ", response);
      return response;
    } catch (error) {
      console.error("Error invoking Gemini model:", error);
      throw error;
    }
  }
  async makeDecisionFromGemini(question) {
    const model = new ChatVertexAI({
      temperature: 0,
      model: "gemini-1.5-pro",
      safetySettings: safetySettings,
    });

    const structuredSchema = z.object({
      answer: z.string().describe("'Yes' or 'No'"),
      newQuestion: z
        .string()
        .describe(
          "the new framed question based on the question asked and the chat history provided"
        ),
    });

    let chatHistory = chatHistoryDummy.slice(-3);
    let response
    if (chatHistory.length > 0) { 
      console.log(
        "Found chat history, making decision about rephrasing question"
      );
      const parser = StructuredOutputParser.fromZodSchema(structuredSchema);
      const chain = RunnableSequence.from([
        ChatPromptTemplate.fromTemplate(
          `Analyze the given question and decide if it requires context from the previous conversation. Respond with "Yes" only if the question is clearly related to the previous conversation or requires the context to be understood correctly. If the question is standalone or unrelated, respond with "No". If 'Yes', rephrase the question using necessary context from the chat history and assign the 'newQuestion' field with this new framed question. Ensure the rephrased question is concise and directly incorporates relevant context without altering the original intent. If 'No', assign the 'newQuestion' field as an empty string ('').
            Question: {question}
            Chat History (Last three interactions): {chatHistory}
            Format Instructions: {format_instructions}`
        ),
        model,
        parser,
      ]);

      response = await chain.invoke({
        question: question,
        format_instructions: parser.getFormatInstructions(),
        chatHistory: chatHistory,
      });
      if (response.answer === "Yes") {
        console.log("Question is rephrased as: ", response);
      }
      else {
        console.log("Question is not rephrased", response);
        response.newQuestion = ''
      }
    } else {
      console.log("No chat history found, skipping decision making");
      response = {
        answer: "No",
        newQuestion: "",
      };
    }
    return response;
  }

  async askQna(question, prompt, sessionId) {
    try {
      let finalQuestion = question;
      // const decision = await this.makeDecisionFromGemini(question);
      // if (decision.answer == "Yes") {
      //   finalQuestion = decision.newQuestion;
      // }
      // const versionLayer = await this.makeDecisionAboutVersionFromGemini(
      //   finalQuestion
      // );

      // let documentName;
      // let oldVersionArray = [];

      // if (versionLayer.isVersion == "No") {
      //   oldVersionArray = [
      //     "ONDC - API Contract for Logistics (v1.1.0)_Final.pdf",
      //     "ONDC - API Contract for Logistics (v1.1.0).pdf",
      //     "ONDC - API Contract for Retail (v1.1.0)_Final.pdf",
      //     "ONDC - API Contract for Retail (v1.1.0).pdf",
      //     "ONDC API Contract for IGM (MVP) v1.0.0.docx.pdf",
      //     "ONDC API Contract for IGM (MVP) v1.0.0.pdf",
      //     "ONDC API Contract for IGM MVP v1.0.0.pdf",
      //   ];
      // } else {
      //   documentName = versionLayer.documentName;
      //   finalQuestion = versionLayer.newQuestion;
      // }
      const { requestion, embedding, feedback } =
        await this.getRelevantQuestionsBigQuery(
          finalQuestion
        );
      if (feedback === "negative") {
        return {
          message: "Sorry, I am not able to answer this question",
          sources: [],
        };
      }
      const context = await this.getRelevantContextsBigQuery(
        embedding
      );
      let finalPrompt = await this.getPrompt(requestion, prompt);
      let answerStream;
      let sourcesArray;
      if (sessionId) {
        [answerStream, sourcesArray] = await Promise.all([
          this.streamAnswer(
            finalPrompt,
            context.contexts,
            requestion,
            sessionId,
            finalQuestion
          ),
          this.getSources(requestion, context),
        ]);
      } else {
        [answerStream, sourcesArray] = await Promise.all([
          this.directAnswer(
            finalPrompt,
            context.contexts,
            requestion,
            finalQuestion
          ),
          this.getSources(requestion, context),
        ]);
      }
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
      if (task === "RETRIEVAL_DOCUMENT" && title) {
        instances = text
          .split(";")
          .map((e) =>
            helpers.toValue({ content: e, taskType: task, title: title })
          );
        instances = text
          .split(";")
          .map((e) => helpers.toValue({ content: e, taskType: task }));
      } else {
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
      console.log("Embeddings created");
      return values.map((value) => value.numberValue);
    } catch (error) {
      console.error("Error calling predict:", error);
      throw error;
    }
  }

  // async streamAnswer(
  //   finalPrompt,
  //   context,
  //   question,
  //   sessionId,
  //   questionToPushInChatHistory
  // ) {
  //   console.log("Stream Answer", question);
  //   const newPrompt = ChatPromptTemplate.fromMessages([
  //     ["system", finalPrompt],
  //     new MessagesPlaceholder("chat_history"),
  //     ["user", "{input}"],
  //     // new MessagesPlaceholder("agent_scratchpad"),
  //   ]);
  //   const chatHistory = new ChatMessageHistory(chatHistoryONDC.slice(-6));
  //   const existingMemory = new BufferMemory({
  //     chatHistory: chatHistory,
  //     returnMessages: true,
  //     memoryKey: "chat_history",
  //   });
  //   const llmChain = new ConversationChain({
  //     llm: model,
  //     memory: existingMemory,
  //     prompt: newPrompt,
  //   });
  //   const responseStream = await llmChain.stream({
  //     input:
  //       finalPrompt +
  //       "\n" +
  //       `Context: ${context}\nQuestion: ${question}\nIf possible explain the answer with every detail possible`,
  //   });
  //   let finalResponse = "";
  //   if (sessionId) {
  //     for await (const response of responseStream) {
  //       // console.log("This is response", response)
  //       finalResponse += response.response;
  //       console.log("response", response.response);
  //       io.to(sessionId).emit("response", response.response);
  //     }
  //     console.log("Done");
  //   }
  //   chatHistoryONDC.push(
  //     new HumanMessage(questionToPushInChatHistory),
  //     new AIMessage(finalResponse)
  //   );
  //   chatHistoryDummy.push({
  //     question: questionToPushInChatHistory,
  //     answer: finalResponse,
  //   });
  //   console.log("finalResponse", finalResponse);
  //   return finalResponse;
  // }
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
  async directAnswer(
    finalPrompt,
    context,
    question,
    questionToPushInChatHistory
  ) {
    console.log("Direct Answer");
    const response = await model.invoke(
      finalPrompt +
        "\n" +
        `Context: ${context}\nQuestion: ${question} and if possible explain the answer with every detail possible`
    );
    chatHistoryONDC.push(
      new HumanMessage(questionToPushInChatHistory),
      new AIMessage(response.content)
    );
    chatHistoryDummy.push({
      question: questionToPushInChatHistory,
      answer: response.content,
    });
    return response.content;
  }
  async getSources(question, context) {
    const sourcesmodel = new ChatVertexAI({
      authOptions: {
        credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
      },
      temperature: 0,
      model: "gemini-1.5-pro",
      safetySettings: safetySettings,
    });
    const sourcesResponse = await sourcesmodel.invoke(
      `Below is a question and the context from which the answer is to be fetched. Your task is to accurately identify and return only the sources where the answer to the question is present. If the question mentions a specific version, only return the sources relevant to that version. Provide the sources exactly as they are given in the context, separated by commas, without any prefixes or suffixes. If there are no relevant sources for the question, do not return any unrelated sources.
      
      Important Notes:

      1. Only return sources that contain the answer to the question.
      2. If a version is mentioned, filter the sources accordingly.
      3. Do not include any unrelated sources.

      \nQuestion: ${question}\nContext: ${context.contexts}`
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
