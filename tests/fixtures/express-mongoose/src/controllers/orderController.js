const orderService = require('../services/orderService');
const Order = require('../models/Order');

exports.list = async (req, res) => {
  // Planted layering violation: the controller queries the model directly
  // instead of going through orderService.
  const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
  res.json(orders);
};

exports.create = async (req, res) => {
  const order = await orderService.placeOrder(req.user.id, req.body.items);
  res.status(201).json(order);
};

exports.remove = async (req, res) => {
  await orderService.cancelOrder(req.params.id);
  res.status(204).end();
};
