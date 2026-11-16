const express = require('express');
const auth = require('../middleware/auth');
const orderController = require('../controllers/orderController');

const router = express.Router();

router.get('/', auth, orderController.list);
router.post('/', auth, orderController.create);
router.delete('/:id', auth, orderController.remove);

module.exports = router;
