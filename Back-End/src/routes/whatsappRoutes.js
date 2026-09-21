const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

router.post('/enviar', whatsappController.enviarMensagem);

module.exports = router;