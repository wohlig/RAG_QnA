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
const {
  VertexAI,
  FunctionDeclarationSchemaType,
} = require('@google-cloud/vertexai');
const { z } = require("zod");
// const model = new ChatVertexAI({
//   authOptions: {
//     credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
//   },
//   temperature: 0,
//   model: "gemini-1.5-flash",
//   maxOutputTokens: 8192,
// });
const pdf_parse = require("pdf-parse");
// const { GoogleGenerativeAI } = require("@google/generative-ai");
// const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
if (process.env.GOOGLE_VERTEX_SECRETS) {
  try {
    var geminiKey = JSON.parse(
      process.env.GOOGLE_VERTEX_SECRETS
  )
  } catch (error) {
      console.error("Error reading the JSON file:", error)
  }
}

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

  async getRelevantContextsBigQuery(obj) {
    const questionEmbedding = await this.callPredict(
      obj.question.replace(/;/g, ""),
      "QUESTION_ANSWERING"
    );
    const embeddingString = `[${questionEmbedding.join(", ")}]`;
    const sourcesArrayInString = `(${obj.sourcesArray
      .map((source) => `'${source}'`)
      .join(", ")})`;
    console.log("sourcessss", sourcesArrayInString);
    let query = `SELECT DISTINCT base.context AS context,
                      base.source AS source
                      FROM
                      VECTOR_SEARCH(
                        TABLE ondc_dataset.ondc_geminititle,
                        'embedding',
                          (SELECT ${embeddingString} AS embedding FROM ondc_dataset.ondc_geminititle),
                        top_k => 5,
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
        top_k => 5,
        distance_type => 'COSINE'
      )
      WHERE base.source IN ('${obj.documentName}');`;
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
      // return contexts.join(" ")
      return {
        contexts: contexts,
        // sources: finalSources,
      };
    } catch (error) {
      console.error("Error querying BigQuery:", error);
      throw error;
    }
  }

  async askGemini(obj) {
    const model = new ChatVertexAI({
      temperature: 0,
      model: "gemini-1.5-flash",
    });
    let prompt = `You are a helpful assistant that answers the given question accurately based on the context provided to you. Make sure you answer the question in as much detail as possible, providing a comprehensive explanation. Do not hallucinate or answer the question by yourself`;
    if (obj.promptBody) {
      console.log("Prompt Body:", obj.promptBody);
      prompt = obj.promptBody;
      // prompt +=
      //   ' Give the final answer in the following JSON format: {\n  "answer": final answer of the question based on the context provided to you,\n}';
    }
    if (obj.question.toLowerCase().includes("steps")) {
      prompt +=
        'Also, provide the name of the sources from where you fetched the answer.Make sure you only provide the relevant sources from the answer was taken, Also if there is some version mentioned in the question, then please return the sources of that versions only.  Provide the final answer in numbered steps. Give the final answer in the following format, First give the answer, label it as "Answer:", then all sources fetched for answer and label it as "Sources:", Dont give the answer in json or array, just the steps trailed by comma or new line, for sources only provide the url or file name spearated by comma, dont add any prefix or suffix to the sources.';
    } else {
      prompt +=
        ' Also, provide the name of the sources from where you fetched the answer. Make sure you only provide the relevant sources from the answer was taken,  Also if there is some version mentioned in the question, then please return the sources of that versions only and get the answer from the contnet of that particular version only, dont take answer from any other version content. If the answer contains any APIs, then explain each API in detail as well. If the context contains any contract link relevant to the answer, then provide that link in the answer too. If an example or sample payload can be used to better explain the answer, provide that in the final answer as well. Give the final answer in the following format, First give the answer, label it as "Answer:", then all sources fetched for answer and label it as "Sources:",  for sources only provide the url or file name spearated by comma, dont add any prefix or suffix to the sources.';
    }

    try {
      const response = await model.invoke(
        prompt +
          "\n" +
          `Context: ${obj.context}\nQuestion: ${obj.question} and if possible explain the answer with every detail possible`
      );
      console.log("Response from Gemini:", response.content);
      return response.content;
    } catch (error) {
      console.error("Error invoking Gemini model:", error);
      throw error;
    }
  }

  async makeDecisionAboutVersionFromGemini(obj) {
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
        Example: "How many flows are present in TRV11?" should not be treated as a version-related question just because it contains "V11" in it. Instead if there is a mention of "version 1.1" or "v1.2" or "v 1.2" in the user's question, then consider it as a version-related question. Do not consider TRV11, TRV10 or RET11 as a version-related question.
        If unsure whether a query relates to a document version, return isVersion as "No" and rephrased question as empty string.
        If question is related to a specific version, rephrase the question to include the exact document name. If not, return an empty string. 
        Question: ${obj.question}
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

  async askQna(question, prompt) {
    try {
      let finalQuestion = question;
      const versionLayer = await this.makeDecisionAboutVersionFromGemini(
        finalQuestion
      );
      // return versionLayer
      let documentName
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
        documentName = versionLayer.documentName
        finalQuestion = versionLayer.newQuestion;
      }
      const context = await this.getRelevantContextsBigQuery(
        finalQuestion,
        oldVersionArray,
        documentName
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

  async functionDeclarations() {
    const functionDeclarations = [
      {
        function_declarations: [
          {
            name: 'makeDecisionAboutVersionFromGemini',
            description:
              'Determine whether the given question is a version related question or not and returns the context required for answering the question',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                question: {type: FunctionDeclarationSchemaType.STRING},
              },
              required: ['question'],
            },
          },
          {
            name: 'getRelevantContextsBigQuery',
            description: 'Get all the relevant contexts based on the given question',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                question: {type: FunctionDeclarationSchemaType.STRING},
                sourcesArray: {type: FunctionDeclarationSchemaType.ARRAY},
                documentName: {type: FunctionDeclarationSchemaType.STRING}
              },
              required: ['question', 'sourcesArray', 'documentName'],
            },
          },
          {
            name: 'askGemini',
            description: 'Get the answer to the given question based on the contexts provided',
            parameters: {
              type: FunctionDeclarationSchemaType.OBJECT,
              properties: {
                question: {type: FunctionDeclarationSchemaType.STRING},
                context: {type: FunctionDeclarationSchemaType.STRING},
                promptBody: {type: FunctionDeclarationSchemaType.STRING}
              },
              required: ['question', 'context', 'promptBody'],
            },
          },
        ],
      },
    ];
    return functionDeclarations
    
    // const makeDecisionAboutVersionFromGeminiDeclaration = {
    //   name: 'makeDecisionAboutVersionFromGemini',
    //   parameters: {
    //     type: "OBJECT",
    //     description: "Determine whether the given question is a version related question or not and returns the context required for answering the question",
    //     properties: {
    //       question: {
    //         type: "STRING",
    //         description: "The question that has been asked by the user",
    //       }
    //     },
    //     required: ["question"],
    //   }
    // }

    // const getRelevantContextsBigQueryDeclaration = {
    //   name: 'getRelevantContextsBigQuery',
    //   parameters: {
    //     type: "OBJECT",
    //     description: "Get all the relevant contexts based on the given question",
    //     properties: {
    //       question: {
    //         type: "STRING",
    //         description: "The question that has been asked by the user",
    //       },
    //       sourcesArray: {
    //         type: "ARRAY",
    //         description: "A list of sources (Could be document names or website links)"
    //       },
    //       documentName: {
    //         type: 'STRING',
    //         description: "Name of a single source (Could be a document or a website link)"
    //       }
    //     },
    //     required: ["question", "sourcesArray", "documentName"],
    //   }
    // }

    // const askGeminiDeclaration = {
    //   name: 'askGemini',
    //   parameters: {
    //     type: "OBJECT",
    //     description: "Get the answer to the given question based on the contexts provided",
    //     properties: {
    //       question: {
    //         type: "STRING",
    //         description: "The question that has been asked by the user",
    //       },
    //       context: {
    //         type: "ARRAY",
    //         description: "A list of big texts that contain the answer to the asked question"
    //       },
    //       promptBody: {
    //         type: 'STRING',
    //         description: "The prompt that is given to the LLM"
    //       }
    //     },
    //     required: ["question", "context"],
    //   }
    // }

    // const toolCalls = {
    //   makeDecisionAboutVersionFromGemini: async ({question}) => {
    //     const versionLayer = await this.makeDecisionAboutVersionFromGemini(question)
    //     let documentName
    //     let oldVersionArray = [];
    //     if (versionLayer.isVersion == "No") {
    //       oldVersionArray = [
    //         "ONDC - API Contract for Logistics (v1.1.0)_Final.pdf",
    //         "ONDC - API Contract for Logistics (v1.1.0).pdf",
    //         "ONDC - API Contract for Retail (v1.1.0)_Final.pdf",
    //         "ONDC - API Contract for Retail (v1.1.0).pdf",
    //         "ONDC API Contract for IGM (MVP) v1.0.0.docx.pdf",
    //         "ONDC API Contract for IGM (MVP) v1.0.0.pdf",
    //         "ONDC API Contract for IGM MVP v1.0.0.pdf",
    //       ];
    //     } else {
    //       documentName = versionLayer.documentName
    //       finalQuestion = versionLayer.newQuestion;
    //     }
    //     return await this.getRelevantContextsBigQuery(versionLayer.newQuestion, oldVersionArray, documentName)
    //   },
    //   // getRelevantContextsBigQuery: async ({question, oldVersionArray, documentName}) => {
    //   //   return await this.getRelevantContextsBigQuery(question, oldVersionArray, documentName)
    //   // },
    //   askGemini: async ({question, context, promptBody}) => {
    //     return await this.askGemini(question, context, promptBody)
    //   }
    // };
    // return {
    //   tools: [makeDecisionAboutVersionFromGeminiDeclaration, askGeminiDeclaration],
    //   toolCalls: toolCalls
    // }
  }

  async makeToolDecision(request, model, toolName) {
    let result = await model.generateContent(request);
    if(result.response && typeof result.response.text() == 'string') {
      return {
        isAnswer: true,
        answer: result.response.text()
      }
    }
    console.log("Call", JSON.stringify(result.response.candidates[0].content));
    let modelResult = result.response.candidates[0].content
    request.contents.push(modelResult)

    let toolOutput
    if(toolName == 'makeDecisionAboutVersionFromGemini') {
      toolOutput = await this.makeDecisionAboutVersionFromGemini(modelResult.parts[0].functionCall.args)
    }
    else if(toolName == 'getRelevantContextsBigQuery') {
      toolOutput = await this.getRelevantContextsBigQuery(modelResult.parts[0].functionCall.args)
    }
    else if(toolName == 'askGemini') {
      toolOutput = await this.askGemini(modelResult.parts[0].functionCall.args)
    }
    request.contents.push({
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: toolName,
            response: toolOutput
          }
        }
      ]
    })
    return request
  }

  async askQnAViaFunctionCalling(question, prompt) {
    // const project = 'your-cloud-project';
    // const location = 'us-central1';
    const textModel =  'gemini-1.5-pro-preview-0409';

    const toolConfig = {
      function_calling_config: {
        mode: 'AUTO',
        // allowed_function_names: ['makeDecisionAboutVersionFromGemini', 'askGemini'],
      },
    };
    
    const declareFunctions = await this.functionDeclarations()
    console.log(declareFunctions)

    const vertexAI = new VertexAI({project: geminiKey.project_id, credentials: geminiKey});
    const generativeModel = vertexAI.preview.getGenerativeModel({
      model: textModel,
    });
    const oldVersionArray = [
      "ONDC - API Contract for Logistics (v1.1.0)_Final.pdf",
      "ONDC - API Contract for Logistics (v1.1.0).pdf",
      "ONDC - API Contract for Retail (v1.1.0)_Final.pdf",
      "ONDC - API Contract for Retail (v1.1.0).pdf",
      "ONDC API Contract for IGM (MVP) v1.0.0.docx.pdf",
      "ONDC API Contract for IGM (MVP) v1.0.0.pdf",
      "ONDC API Contract for IGM MVP v1.0.0.pdf",
    ];
    const finalPrompt = `You are a helpful agent. First call the 'makeDecisionAboutVersionFromGemini' tool. After receving its output, call the 'getRelevantContextsBigQuery' tool with the question provided, the sources provided and the 'documentName' from the previous tool output as input parameters. If the 'isVersion' from 'getRelevantContextsBigQuery' tool output is 'Yes', then keep the sources parameter as empty array ([]) and the question parameter as the 'newQuestion' field value from the previous tool output. Then, use that output along with the question in the 'newQuestion' field from the 'makeDecisionAboutVersionFromGemini' tool output as input for 'askGemini' tool. If the 'isVersion' from 'getRelevantContextsBigQuery' tool output is 'No', then keep the question parameter in the 'askGemini' tool same as the provided question.
    Question: ${question}
    Sources: ${oldVersionArray}`

    const request = {
      contents: [
        {
          role: 'user',
          parts: [
            {text: finalPrompt},
          ],
        },
      ],
      tools: declareFunctions,
      tool_config: toolConfig,
      // generation_config: generationConfig,
    };
    // let flag = true
    // let dummyRequest = request
    // while(flag) {
    //   dummyRequest = await this.makeToolDecision(dummyRequest, generativeModel)
    //   if(dummyRequest.isAnswer == true) {
    //     flag = false
    //   }
    // }
    // return dummyRequest.answer
    let result = await generativeModel.generateContent(request);
    console.log("Call 1", JSON.stringify(result.response.candidates[0].content));
    let modelResult = result.response.candidates[0].content
    request.contents.push(modelResult)
    if(modelResult.parts[0].functionCall.name == 'makeDecisionAboutVersionFromGemini') {
      const toolOutput = await this.makeDecisionAboutVersionFromGemini(modelResult.parts[0].functionCall.args)
      request.contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: 'makeDecisionAboutVersionFromGemini',
              response: toolOutput
            }
          }
        ]
      })
      result = await generativeModel.generateContent(request)
    }
    console.log("Call 2", JSON.stringify(result.response.candidates[0].content));
    modelResult = result.response.candidates[0].content
    request.contents.push(modelResult)
    if(modelResult.parts[0].functionCall.name == 'getRelevantContextsBigQuery') {
      const toolOutput = await this.getRelevantContextsBigQuery(modelResult.parts[0].functionCall.args)
      request.contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: 'getRelevantContextsBigQuery',
              response: toolOutput
            }
          }
        ]
      })
      result = await generativeModel.generateContent(request)
    }
    console.log("Call 3", JSON.stringify(result.response.candidates[0].content));
    modelResult = result.response.candidates[0].content
    request.contents.push(modelResult)
    if(modelResult.parts[0].functionCall.name == 'askGemini') {
      const toolOutput = await this.askGemini(modelResult.parts[0].functionCall.args)
      request.contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: 'askGemini',
              response: toolOutput
            }
          }
        ]
      })
      // return request
      result = await generativeModel.generateContent(request)
      console.log("This is result", result)
    }
    return result
    // const generativeModel = genAI.getGenerativeModel({
    //   // Use a model that supports function calling, like a Gemini 1.5 model
    //   model: "gemini-1.5-flash",
    
    //   // Specify the function declaration.
    //   tools: {
    //     functionDeclarations: declareFunctions.tools,
    //   },
    // });
    // const chat = generativeModel.startChat();
    // const prompt = "Dim the lights so the room feels cozy and warm.";
    // const result = await chat.sendMessage(finalPrompt);
    // console.log(result.response)
    // const call = result.response.functionCalls()[0];
    // if (call) {
    //   // Call the executable function named in the function call
    //   // with the arguments specified in the function call and
    //   // let it call the hypothetical API.
    //   const apiResponse = await declareFunctions.toolCalls[call.name](call.args);
    //   console.log(apiResponse)
    
    //   // Send the API response back to the model so it can generate
    //   // a text response that can be displayed to the user.
    //   const result2 = await chat.sendMessage([{functionResponse: {
    //     name: 'makeDecisionAboutVersionFromGemini',
    //     response: apiResponse
    //   }}]);
    
    //   // Log the text response.
    //   console.log(result2.response.text());
    //   return result2.response.text();
    // }
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
