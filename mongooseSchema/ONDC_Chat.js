const mongoose = require('mongoose')
const Schema = mongoose.Schema

const schema = new Schema({
  sessionId: {
    type: String
  },
  chatHistory: {
    type: Array,
    default: []
  },
  status: {
    type: String,
    default: 'active',
    enum: ["active", "archived"]
  },
  // llmChain: {
  //   type: Object
  // },
  // llmMemory: {
  //   type: Object
  // }
},
{ timestamps: true })
module.exports = mongoose.model('ONDC_Chat', schema)
