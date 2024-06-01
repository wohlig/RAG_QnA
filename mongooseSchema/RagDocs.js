const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema({
  docChunks: {
    type: Array
  },
  fullText: {
    type: String
  },
  docName: {
    type: String
  },
},
{ timestamps: true })
module.exports = mongoose.model('RagDocs', schema)
