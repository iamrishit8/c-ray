const Order = require('../models/Order');
const userService = require('./userService');
const paymentClient = require('./paymentClient');

async function countOrdersForUser(userId) {
  return Order.countDocuments({ user: userId });
}

async function placeOrder(userId, items) {
  const active = await userService.isActive(userId);
  if (!active) {
    throw new Error('user is not active');
  }
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  const order = await Order.create({ user: userId, items, total, status: 'pending' });
  await paymentClient.charge(order.id, total);
  return order;
}

async function cancelOrder(id) {
  await Order.updateOne({ _id: id }, { status: 'cancelled' });
}

module.exports = { countOrdersForUser, placeOrder, cancelOrder };
