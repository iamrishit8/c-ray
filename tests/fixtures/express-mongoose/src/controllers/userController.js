const userService = require('../services/userService');

async function list(req, res) {
  const users = await userService.listUsers();
  res.json(users);
}

async function get(req, res) {
  const user = await userService.getUser(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json(user);
}

async function create(req, res) {
  const user = await userService.createUser(req.body);
  res.status(201).json(user);
}

module.exports = { list, get, create };
