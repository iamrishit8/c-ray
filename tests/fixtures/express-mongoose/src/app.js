const express = require('express');
const logger = require('./middleware/logger');
const usersRouter = require('./routes/users');
const ordersRouter = require('./routes/orders');

const app = express();

app.use(express.json());
app.use(logger);

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/users', usersRouter);
app.use('/api/orders', ordersRouter);

module.exports = app;
