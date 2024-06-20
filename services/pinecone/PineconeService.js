const fs = require("fs");
const keys = process.env.GOOGLE_SECRETS;
fs.writeFileSync(`${__dirname}/keys.json`, keys);

const { compile } = require("html-to-text");
const { v4: uuidv4 } = require("uuid");
const { RecursiveCharacterTextSplitter } = require("langchain/text_splitter");
const { BigQuery } = require("@google-cloud/bigquery");
const {
  RecursiveUrlLoader,
} = require("@langchain/community/document_loaders/web/recursive_url");
const RagDocs = require("../../mongooseSchema/RagDocs");
const path = require("path");
// const auth = require('your-auth-module'); // Replace with your actual auth module for getting access tokens
const getEmbedding = require("../pinecone/getEmbedding"); // Adjust the path as necessary

const bigquery = new BigQuery({
  keyFilename: path.join(__dirname, "./keys.json"), // Ensure this path points to your service account key
});

const { ChatVertexAI } = require("@langchain/google-vertexai");

const model = new ChatVertexAI({
  authOptions: {
    credentials: JSON.parse(process.env.GOOGLE_VERTEX_SECRETS),
  },
  temperature: 0.4,
  model: "gemini-1.5-flash-001",
});
const pdf_parse = require("pdf-parse");
const OpenAI = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const langchainOpenAI = require("@langchain/openai");
const { Pinecone } = require("@pinecone-database/pinecone");
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const index = pinecone.index("ondc-rag");
class PineconeService {
  async pushWebsiteDataToBigQuery(urls) {
    for (const url of urls) {
      try {
        console.log("inside tryy");
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
          doc.id = uuidv4();
        });
        console.log("docs>>>", docs.length);
        const batch_size = 100;
        for (let i = 0; i < docs.length; i += batch_size) {
          const i_end = Math.min(docs.length, i + batch_size);
          const meta_batch = docs.slice(i, i_end);
          const ids_batch = meta_batch.map((x) => x.id);
          const texts_batch = meta_batch.map((x) => x.pageContent);

          let embeddings = [];
          for (const text of texts_batch) {
            try {
              const embedding = await getEmbedding.getEmbedding(text);
              embeddings.push(embedding);
            } catch (error) {
              console.error("Failed to get embedding for text:", text);
              embeddings.push([]); // handle the error, e.g., push empty array or continue
            }
          }
          console.log("embeddings>>>>>", embeddings);
          const rows = meta_batch.map((doc, index) => ({
            id: doc.id,
            docIdInDb: ragDoc._id.toString(),
            source: doc.metadata.source || url,
            title: doc.metadata.title || "N/A",
            context: doc.pageContent,
            embedding: embeddings[index],
          }));
          console.log("outside lopp>>>>>>>>>", rows);

          try {
            await bigquery
              .dataset("ondc_dataset")
              .table("ondc_table")
              .insert(rows);
          } catch (error) {
            console.log(error.errors[0].errors);
          }

          console.log("Successfully uploaded batch", Math.floor(i / 100) + 1);
        }

        ragDoc.docChunks = docs;
        await ragDoc.save();
        console.log("URL Processed:", url);
      } catch (error) {
        console.log(error.message);
      }
    }
    return "Completed";
  }
  async pushDocumentsToPinecone(files) {
    // await this.deleteVectorsFromPinecone()
    // return "Doneeee"
    const fileData = files;
    // await index.deleteAll();
    let count = 1;
    for (const file of fileData) {
      const pdfData = await pdf_parse(file.buffer);
      let formattedText;
      try {
        formattedText = await this.formatTextOpenAI(pdfData.text);
      } catch (error) {
        formattedText = pdfData.text;
      }
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
          source: originalDocName,
        }));
        const to_upsert = ids_batch.map((id, i) => ({
          id: id,
          values: embeddings[i],
          metadata: meta_batch_cleaned[i],
        }));
        await index.upsert(to_upsert);
        console.log("Successfully uploaded", i / 100);
      }
      console.log("Saving in DB", originalDocName);
      try {
        ragDoc.docChunks = docs;
        await ragDoc.save();
      } catch (error) {
        console.log(error);
      }
      console.log("File Doneee", count);
      count++;
    }
    return "Doneeeeeeee";
  }
  async pushDocumentsToBigQuery(files) {
    console.log("inside pushDocumentsToBigQuery");
    const fileData = files;
    let count = 1;
    for (const file of fileData) {
      console.log("inside for loop", file.originalname);
      const pdfData = await pdf_parse(file.buffer);
      let formattedText = pdfData.text;
      // try {
      //   formattedText = await this.formatTextOpenAI(pdfData.text);
      // } catch (error) {
      //   formattedText = pdfData.text;
      // }
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
        doc.id = uuidv4();
      });
      const batch_size = 100;
      let embeddings = [];
      console.log("docs length", docs.length);
      for (let i = 0; i < docs.length; i += batch_size) {
        const i_end = Math.min(docs.length, i + batch_size);
        const meta_batch = docs.slice(i, i_end);
        const ids_batch = meta_batch.map((x) => x.id);
        const texts_batch = meta_batch.map((x) => x.pageContent);

        for (const text of texts_batch) {
          try {
            const embedding = await getEmbedding.getEmbedding(text);
            embeddings.push(embedding);
          } catch (error) {
            console.error("Failed to get embedding for text:", text);
            embeddings.push([]); // handle the error, e.g., push empty array or continue
          }
        }

        const rows = meta_batch.map((doc, index) => ({
          id: doc.id,
          docIdInDb: ragDoc._id.toString(),
          source: doc.metadata.source || originalDocName,
          title: doc.metadata.title || "N/A",
          context: doc.pageContent,
          embedding: embeddings[index],
        }));

        try {
          await bigquery
            .dataset("ondc_dataset")
            .table("ondc_table")
            .insert(rows);
        } catch (error) {
          console.log(error.errors[0].errors);
        }
        console.log("Successfully uploaded batch", Math.floor(i / 100) + 1);
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
    const uniqueSources = [...new Set(allSources)];
    const finalSources = uniqueSources.join(", ");
    console.log("Final Sources", finalSources);
    const finalObj = {
      contexts: finalContext,
      sources: finalSources,
    };
    return finalObj;
  }
  async getRelevantContextsBigQuery(question) {
    const questionEmbedding = await getEmbedding.getEmbedding(question);
    console.log("🚀 ~ PineconeService ~ getRelevantContextsBigQuery ~ questionEmbedding:", questionEmbedding);
  
    // Create the embedding structure for the query
    const formattedEmbedding = questionEmbedding.map(value => value.toString()).join(", ");
  
    const query = `SELECT base.context AS context, base.source AS source, distance FROM VECTOR_SEARCH( TABLE ondc_dataset.ondc_table, embedding, (SELECT ${questionEmbedding} AS embedding ), top_k => 5, distance_type => 'COSINE')`;
  
    try {
      const [rows] = await bigquery.query({ query });
      console.log("Rows>>>>", rows);
      const contexts = rows.map((row) => row.context);
      const allSources = rows.map((row) => row.source);
  
      const finalContext = contexts.join(" ");
      const uniqueSources = [...new Set(allSources)];
      const finalSources = uniqueSources.join(", ");
      console.log("Data>>>>>>>>", {
        contexts: finalContext,
        sources: finalSources,
      });
      return {
        contexts: finalContext,
        sources: finalSources,
      };
    } catch (error) {
      console.error("Error querying BigQuery:", error);
      throw error;
    }
  }
  

  async askGPT(question, context, promptBody) {
    let prompt = `You are a helpful assistant that answers the given question accurately based on the context provided to you. Make sure you answer the question in as much detail as possible, providing a comprehensive explanation. Do not hallucinate or answer the question by yourself. Give the final answer in the following JSON format: {\n  \"answer\": final answer of the question based on the context provided to you,\n}`;
    if (promptBody) {
      prompt = promptBody;
      prompt +=
        ' Give the final answer in the following JSON format: {\n  "answer": final answer of the question based on the context provided to you,\n}';
    }
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: prompt,
        },
        {
          role: "user",
          content: `Context: ${context}
            Question: ${question} and if possible explain the answer in detail`,
        },
      ],
      temperature: 0.4,
      response_format: {
        type: "json_object",
      },
    });
    return response.choices[0].message.content;
  }
  async askGemini(question, context, promptBody) {
    let prompt = `You are a helpful assistant that answers the given question accurately based on the context provided to you. Make sure you answer the question in as much detail as possible, providing a comprehensive explanation. Do not hallucinate or answer the question by yourself. Give the final answer in the following JSON format: {\n  \"answer\": final answer of the question based on the context provided to you,\n}`;
    if (promptBody) {
      prompt = promptBody;
      prompt +=
        ' Give the final answer in the following JSON format: {\n  "answer": final answer of the question based on the context provided to you,\n}';
    }

    try {
      const response = await model.invoke(
        prompt +
          "\n" +
          `Context: ${context}\nQuestion: ${question} and if possible explain the answer in detail`
      );
      return response.content;
    } catch (error) {
      console.error("Error invoking Gemini model:", error);
      throw error;
    }
  }
  // async formatTextOpenAI(text) {
  //   const response = await openai.chat.completions.create({
  //     messages: [
  //       {
  //         role: "system",
  //         content:
  //           "You are a helpful assistant that formats the given text properly. You will add proper punctuation, spaces between words and other necessary things to make the text more readable.",
  //       },
  //       {
  //         role: "user",
  //         content: `This is the text to be formatted
  //           Text: ${text}
  //           Return only the formatted text, nothing else extra`,
  //       },
  //       {
  //         role: "assistant",
  //         content: "Answer: ",
  //       },
  //     ],
  //     model: "gpt-4o",
  //   });
  //   return response.choices[0].message.content;
  // }
  async askQna(question, prompt) {
    // const finalQuestion = `
    // Question: ${question}
    // DocumentID: ${docId}`;
    // if (PineconeService.assistantId == "") {
    //   await this.createAssistant();
    //   console.log("Assistant Created");
    // }
    // if (PineconeService.assistantId != "" && PineconeService.threadId == "") {
    //   await this.createThread();
    //   console.log("Thread Created");
    // }
    // if (PineconeService.assistantId != "" && PineconeService.threadId != "") {
    //   await this.createMessage(question);
    //   console.log("Message Added to Thread");
    // }
    // if (
    //   PineconeService.assistantId != "" &&
    //   PineconeService.threadId != "" &&
    //   PineconeService.runId == ""
    // ) {
    //   await this.createRun();
    //   console.log("Run Created");
    // }
    // if (PineconeService.runId != "") {
    //   const status = await this.waitForRunCompletion();
    //   if (status == "completed") {
    //     PineconeService.runId = "";
    //     return await this.retrieveResponse();
    //   }
    //   return "Run Not Yet Complete";
    // }
    try {
      const context = await this.getRelevantContexts(question);
      let response = await this.askGemini(question, context.contexts, prompt);
      console.log("Response>>>>", response);
      // remove '```json and ```' from the response
      response = response.replace(/```json/g, "");
      response = response.replace(/```/g, "");

      response = JSON.parse(response);
      // response = JSON.parse(response);
      let sourcesArray = [];
      if (context.sources != "") {
        sourcesArray = context.sources.split(", ");
        response.sources = sourcesArray;
      }
      return response;
    } catch (error) {
      console.log(error);
      return __constants.RESPONSE_MESSAGES.ERROR_CALLING_PROVIDER;
    }
  }
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
module.exports = new PineconeService();
