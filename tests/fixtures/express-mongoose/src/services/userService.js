const User = require('../models/User');
const orderService = require('./orderService');

async function listUsers() {
  return User.find({}).lean();
}

async function getUser(id) {
  const user = await User.findById(id).lean();
  if (!user) return null;
  user.orderCount = await orderService.countOrdersForUser(id);
  return user;
}

async function createUser(data) {
  const user = new User(data);
  await user.save();
  return user;
}

async function isActive(id) {
  const user = await User.findById(id);
  return Boolean(user && user.role !== 'disabled');
}

module.exports = { listUsers, getUser, createUser, isActive };
