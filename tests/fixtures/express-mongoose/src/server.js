const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config');
const { startCleanupJob } = require('./jobs/cleanup');

async function main() {
  await mongoose.connect(config.mongoUrl);
  startCleanupJob();
  app.listen(config.port, () => {
    console.log(`listening on ${config.port}`);
  });
}

main();
