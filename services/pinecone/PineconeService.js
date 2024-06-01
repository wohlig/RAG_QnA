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

class PineconeService {
  static assistantId = "";
  static threadId = "";
  static runId = "";

  async pushDocumentsToPinecone(files) {
    const fileData = files;
    // await index.deleteAll();
    let count = 1
    for(const file of fileData) {
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
        console.log("File Doneee", count)
        count++
    }
    return "Doneeeeeeee"
  }
  async getRelevantContexts(question, docId) {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: question,
    });
    const questionEmbedding = response.data[0].embedding;
    const queryResponse = await index.query({
      vector: questionEmbedding,
      filter: {
        docIdInDb: { $eq: docId.toString() },
      },
      topK: 5,
      includeMetadata: true,
    });
    const contexts = queryResponse.matches.map(
      (match) => match.metadata.context
    );
    const finalContext = contexts
      .filter(function (str) {
        return str !== undefined;
      })
      .join("");
    return finalContext;
  }
  async askGPT(question, context) {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that answers the given question based on the context provided to you.",
        },
        {
          role: "user",
          content: `Context: ${context}
            Question: ${question}`,
        },
      ],
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
        description: `You are a chatbot that specialises in answering the user's questions accurately. If question is related to the summary of the document, then call the summariseDocument tool. If not, then judge whether a tool needs to be called to answer the question or not. If yes, then first retrieve the necessary context based on the user's question by calling the getRelevantContexts tool, and then answers the question based on the context you retrieved by calling the askGPT tool.`,
        model: "gpt-3.5-turbo",
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
                  docId: {
                    type: "string",
                    description:
                      "The ID of the document about which the user is asking the question",
                  },
                },
                required: ["question", "docId"],
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
                },
                required: ["question", "context"],
              },
            },
          },
          {
            type: "function",
            function: {
              name: "summariseDocument",
              description: "Summarises the given document",
              parameters: {
                type: "object",
                properties: {
                  docId: {
                    type: "string",
                    description:
                      "The ID of the document about which the user is asking the question",
                  },
                },
                required: ["docId"],
              },
            },
          },
        ],
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
            "You are a chatbot that specialises in answering the user's questions accurately. If question is related to the summary of the document, then call the summariseDocument tool. If not, then judge whether a tool needs to be called to answer the question or not. If yes, then first retrieve the necessary context based on the user's question by calling the getRelevantContexts tool, and then answers the question based on the context you retrieved by calling the askGPT tool.",
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
                parameters.docId
              );
              toolsOutput.push({
                tool_call_id: action.id,
                output: JSON.stringify(context),
              });
            } else if (funcName === "askGPT") {
              const answer = await this.askGPT(
                parameters.question,
                parameters.context
              );
              toolsOutput.push({
                tool_call_id: action.id,
                output: JSON.stringify(answer),
              });
            } else if (funcName === "summariseDocument") {
              const summary = await this.summariseDocument(parameters.docId);
              toolsOutput.push({
                tool_call_id: action.id,
                output: JSON.stringify(summary),
              });
            } else {
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
  async askQna(question, docId) {
    const finalQuestion = `
    Question: ${question}
    DocumentID: ${docId}`;
    if (PineconeService.assistantId == "") {
      await this.createAssistant();
      console.log("Assistant Created");
    }
    if (PineconeService.assistantId != "" && PineconeService.threadId == "") {
      await this.createThread();
      console.log("Thread Created");
    }
    if (PineconeService.assistantId != "" && PineconeService.threadId != "") {
      await this.createMessage(finalQuestion);
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
        PineconeService.runId == "";
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
