const cron = require('node-cron');
const Order = require('../models/Order');

function startCleanupJob() {
  cron.schedule('0 3 * * *', async () => {
    await Order.deleteMany({ status: 'cancelled' });
  });
}

module.exports = { startCleanupJob };
