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
const { BufferMemory, ChatMessageHistory } = require("langchain/memory");
const { HumanMessage, AIMessage } = require("@langchain/core/messages");
const { ConversationChain } = require("langchain/chains");
const BigQueryChatsService = require("../../services/bigquery/chatsFeedbackService");

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

class BigQueryService {
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
            .dataset(process.env.BIG_QUERY_DATA_SET_ID)
            .table(process.env.BIG_QUERY_TABLE_ID)
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
            .dataset(process.env.BIG_QUERY_DATA_SET_ID)
            .table(process.env.BIG_QUERY_TABLE_ID)
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

  async callPredictForQues(text, task, title = "") {
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

  async getRelevantQuestionsBigQuery(question) {
    const questionEmbedding = await this.callPredict(
      question.replace(/;/g, ""),
      "QUESTION_ANSWERING"
    );
    const embeddingString = `[${questionEmbedding.join(", ")}]`;
    let query = `SELECT base.questions AS question, base.embedding AS embedding, base.feedback AS feedback, distance
    FROM
    VECTOR_SEARCH(
      TABLE ${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_QUESTIONS_TABLE_ID},
      'embedding',
        (SELECT ${embeddingString} AS embedding FROM ${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_QUESTIONS_TABLE_ID}),
      top_k => 3,
      distance_type => 'COSINE'
    )`;
    try {
      let newQuestion = question;
      let newEmbedding = questionEmbedding;
      let feedback = "positive";
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

    let query = `SELECT DISTINCT base.context AS context,
    base.source AS source,
    docs.document_link AS document_link,
    docs.document_name AS document_name
    FROM
    VECTOR_SEARCH(
      TABLE ${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_TABLE_ID},
      'embedding',
        (SELECT ${embeddingString} AS embedding FROM ${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_TABLE_ID}),
      top_k => 20,
      distance_type => 'COSINE'
    )
    LEFT JOIN \`${process.env.BIG_QUERY_DATA_SET_ID}.${process.env.BIG_QUERY_DOCUMENTS_TABLE_ID}\` AS docs
    ON base.source = docs.document_name
      `;

    try {
      const [rows] = await bigquery.query({ query });
      const contexts = rows.map((row) => row.context);
      const sources = rows.map((row) => ({
        source: row.source,
        document_link: row.document_link,
        document_name: row.document_name,
      }));

      return {
        contexts: contexts,
        sources: sources,
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

  async makeDecisionFromGemini(question, chatHistoryRephrase) {
    const model = new ChatVertexAI({
      temperature: 0,
      model: "gemini-1.5-pro",
      safetySettings: safetySettings,
    });

    const structuredSchema = z.object({
      answer: z.string().describe("'Yes'"),
      newQuestion: z
        .string()
        .describe(
          "the new framed question based on the question asked and the chat history provided"
        ),
    });

    let chatHistory = chatHistoryRephrase.slice(-3);
    let response;
    if (chatHistory.length > 0) {
      console.log(
        "Found chat history, making decision about rephrasing question"
      );
      const parser = StructuredOutputParser.fromZodSchema(structuredSchema);
      const chain = RunnableSequence.from([
        ChatPromptTemplate.fromTemplate(
          `Analyze the provided chat history and the new question and rephrase the new question to include the necessary context from the chat history without altering its original intent. Assign this rephrased question to the variable newQuestion. But make sure the rephrased question does not need any previous context from the chat history, it must be a standalone question. Ensure the rephrased question is concise and directly incorporates relevant context.

            Question: {question}
            Chat History (Last three interactions): {chatHistory}
            Format Instructions: {format_instructions}`
        ),
        model,
        parser,
      ]);
      let historyText = "";
      for (const turn of chatHistory) {
        historyText += `User: ${turn.question}\nAssistant: ${turn.answer}\n`;
      }

      response = await chain.invoke({
        question: question,
        format_instructions: parser.getFormatInstructions(),
        chatHistory: historyText,
      });
      if (response.answer === "Yes") {
        console.log("Question is rephrased as: ", response);
      } else {
        console.log("Question is not rephrased", response);
        response.newQuestion = "";
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

  async askQna(question, prompt, sessionId, chatHistory) {
    try {
      if (!chatHistory) {
        chatHistory = [];
      }
      const chatHistoryLangchain = [];
      const chatHistoryRephrase = chatHistory;
      for (const chat of chatHistory) {
        chatHistoryLangchain.push(
          new HumanMessage(chat.question),
          new AIMessage(chat.answer)
        );
      }
      console.log("Chat history Langchain", chatHistoryLangchain);
      console.log("Chat history Rephrase", chatHistoryRephrase);
      let finalQuestion = question;
      let decision;
      if (chatHistory && chatHistory.length > 0) {
        decision = await this.makeDecisionFromGemini(
          question,
          chatHistoryRephrase
        );
        if (decision.answer == "Yes") {
          finalQuestion = decision.newQuestion;
        }
      }
      const { requestion, embedding, feedback } =
        await this.getRelevantQuestionsBigQuery(finalQuestion);
      if (feedback === "negative") {
        io.to(sessionId).emit(
          "response",
          "Sorry, I am not able to answer this question"
        );
        BigQueryChatsService.saveFeedbackBatch({
          id: uuidv4(),
          question: question,
          response: "Sorry, I am not able to answer this question",
          sources: [],
          session_id: sessionId,
          timestamp: new Date().toISOString(),
          read_status: 0,
          confidence_score: 0,
        }).catch((err) => console.error("Error saving to BigQuery:", err));
        return {
          message: "Sorry, I am not able to answer this question",
          sources: [],
        };
      }
      const context = await this.getRelevantContextsBigQuery(embedding);
      let finalPrompt = await this.getPrompt(requestion, prompt);
      let answerStream;
      let sourcesArray;
      if (sessionId) {
        [answerStream, sourcesArray] = await Promise.all([
          chatHistoryLangchain && chatHistoryLangchain.length > 0
            ? this.streamAnswer(
                finalPrompt,
                context.contexts,
                requestion,
                sessionId,
                chatHistoryLangchain
              )
            : this.streamAnswerWithoutHistory(
                finalPrompt,
                context.contexts,
                requestion,
                sessionId
              ),
          this.getSources(requestion, context),
        ]);
      } else {
        [answerStream, sourcesArray] = await Promise.all([
          this.directAnswer(
            finalPrompt,
            context.contexts,
            requestion,
            chatHistoryLangchain
          ),
          this.getSources(requestion, context),
        ]);
      }
      const confidenceScore = await this.getConfidenceScore(
        finalQuestion,
        answerStream
      );
      const chatId = uuidv4();
      const arrayMid =
        sourcesArray.length > 1 ? Math.floor(sourcesArray.length / 2) : 1;
      BigQueryChatsService.saveFeedbackBatch({
        id: chatId,
        question: question,
        response: answerStream,
        sources:
          (sourcesArray &&
            sourcesArray.length == 1 &&
            sourcesArray[0] &&
            sourcesArray[0].source === "") ||
          sourcesArray.length === 0
            ? ["No Response"]
            : sourcesArray.map((source) => source.source).slice(0, arrayMid),
        session_id: sessionId,
        timestamp: new Date().toISOString(),
        read_status: 0,
        confidence_socre: confidenceScore,
      }).catch((err) => console.error("Error saving to BigQuery:", err));
      return {
        answer: answerStream,
        sources: sourcesArray,
        chatId: chatId,
        questionToPushInChatHistory: requestion,
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

  async streamAnswer(
    finalPrompt,
    context,
    question,
    sessionId,
    chatHistoryLangchain
  ) {
    console.log("Stream Answer", question);
    const newPrompt = ChatPromptTemplate.fromMessages([
      ["system", finalPrompt],
      new MessagesPlaceholder("chat_history"),
      ["user", "{input}"],
    ]);
    const chatHistory = new ChatMessageHistory(chatHistoryLangchain.slice(-6));
    const existingMemory = new BufferMemory({
      chatHistory: chatHistory,
      returnMessages: true,
      memoryKey: "chat_history",
    });
    const llmChain = new ConversationChain({
      llm: model,
      memory: existingMemory,
      prompt: newPrompt,
    });
    const responseStream = await llmChain.stream({
      input:
        finalPrompt +
        "\n" +
        `Context: ${context}\nQuestion: ${question}\nIf possible explain the answer with every detail possible`,
    });
    let finalResponse = "";
    if (sessionId) {
      for await (const response of responseStream) {
        finalResponse += response.response;
        console.log("response", response.response);
        io.to(sessionId).emit("response", response.response);
      }
      console.log("Done");
    }
    console.log("finalResponse", finalResponse);
    return finalResponse;
  }

  async streamAnswerWithoutHistory(finalPrompt, context, question, sessionId) {
    console.log("Streaming answer without history");
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
    console.log("Direct Answer");
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
      safetySettings: safetySettings,
    });

    const sourcesResponse = await sourcesmodel.invoke(
      `Below is a question and the context from which the answer is to be fetched. Your task is to accurately identify and return only the sources where the answer to the question is present. If the question mentions a specific version, only return the sources relevant to that version. Provide the sources exactly as they are given in the context, separated by commas, without any prefixes or suffixes. If there are no relevant sources for the question, do not return any unrelated sources, instead return an empty string ('').
  
      Important Notes:
  
      1. Only return sources that contain the answer to the question.
      2. If a version is mentioned, filter the sources accordingly.
      3. Do not include any unrelated sources, instead return empty string ('').
  
      \nQuestion: ${question}\nContext: ${context.contexts}`
    );

    console.log("Getting sources done");

    let sourcesArray = sourcesResponse.content.split(",");
    sourcesArray = sourcesArray.map((source) => source.trim());
    sourcesArray = [...new Set(sourcesArray)];
    sourcesArray = sourcesArray.filter((source) => source !== "");
    sourcesArray = sourcesArray.map((source) => {
      if (source.includes("https://github.com")) {
        return source.replace(/\s/g, "");
      }
      if (source.includes('"')) {
        return source.replace(/"/g, "");
      }
      return source;
    });
    sourcesArray = sourcesArray.filter((source) => source !== "");

    const validSources = [];

    for (let source of sourcesArray) {
      const sourceObj = context.sources.find((s) => {
        return s.source.includes(source);
      });

      if (source.startsWith("http")) {
        validSources.push({
          source: source,
          type: "website",
        });
      } else if (sourceObj && sourceObj.document_link) {
        validSources.push({
          source: sourceObj.source,
          document_link: sourceObj.document_link,
          type: "document",
        });
      } else {
        console.warn(
          `Source "${source}" not found in document mappings. Skipping.`
        );
      }
    }

    return validSources;
  }

  async getConfidenceScore(question, answer) {
    try {
      const model = new ChatVertexAI({
        authOptions: {
          credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
        },
        temperature: 0,
        model: "gemini-1.5-pro",
        safetySettings: safetySettings,
      });

      const structuredSchema = z.object({
        confidenceScore: z
          .number()
          .min(0)
          .max(1)
          .describe("A confidence score between 0 and 1."),
      });

      const parser = StructuredOutputParser.fromZodSchema(structuredSchema);

      const promptTemplate = `Based on the following question and answer, evaluate the correctness and completeness of the answer with respect to the question. Provide a confidence score between 0 and 1, where 1 indicates the answer fully addresses the question accurately and completely, and 0 indicates the answer does not address the question at all or is incorrect. Return the result in the following JSON format:
  
  {format_instructions}
  
  Question: {question}
  
  Answer: {answer}`;

      const chain = RunnableSequence.from([
        ChatPromptTemplate.fromTemplate(promptTemplate),
        model,
        parser,
      ]);

      const response = await chain.invoke({
        question: question,
        answer: answer,
        format_instructions: parser.getFormatInstructions(),
      });

      const confidenceScore = response.confidenceScore;

      if (
        typeof confidenceScore !== "number" ||
        confidenceScore < 0 ||
        confidenceScore > 1
      ) {
        throw new Error("Invalid confidence score received from Gemini.");
      }

      console.log("Confidence Score", confidenceScore);

      return confidenceScore;
    } catch (error) {
      console.error("Error in getConfidenceScore:", error);
      throw error;
    }
  }
}

module.exports = new BigQueryService();
