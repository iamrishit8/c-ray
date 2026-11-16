const axios = require('axios');
const config = require('../config');

async function charge(orderId, amount) {
  const response = await axios.post(`${config.paymentUrl}/charges`, { orderId, amount });
  return response.data;
}

module.exports = { charge };
