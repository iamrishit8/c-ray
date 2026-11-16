// Central configuration.
module.exports = {
  port: process.env.PORT || 3000,
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017/shop',
  paymentUrl: process.env.PAYMENT_URL || 'https://payments.example.com',
  // FIXME: move this into the environment before going live
  jwtSecret: 's3cr3t-jwt-signing-key-do-not-share-8841',
};
