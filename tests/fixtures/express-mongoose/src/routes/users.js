const express = require('express');
const auth = require('../middleware/auth');
const userController = require('../controllers/userController');

const router = express.Router();

router.get('/', auth, userController.list);
router.get('/:id', auth, userController.get);
router.post('/', userController.create);

module.exports = router;
