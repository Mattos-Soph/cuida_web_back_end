const axios = require('axios');

// Configurações via variáveis de ambiente com fallbacks para testes
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'http://localhost:8080';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || '';
const WHATSAPP_INSTANCE = process.env.WHATSAPP_INSTANCE || 'cuida';

/**
 * Envia uma mensagem de texto simples
 * POST /api/whatsapp/enviar
 * Body: { "numero": "5514999999999", "mensagem": "Olá..." }
 */
exports.enviarMensagem = async (req, res) => {
  const { numero, mensagem } = req.body;

  if (!numero || !mensagem) {
    return res.status(400).json({
      error: 'Número e mensagem são obrigatórios.'
    });
  }

  // Higieniza o número (remove parênteses, traços e espaços)
  const numeroLimpo = String(numero).replace(/\D/g, '');

  try {
    // Chamada REST para o serviço de WhatsApp (padrão Evolution API / Z-API)
    const response = await axios.post(
      `${WHATSAPP_API_URL}/message/sendText/${WHATSAPP_INSTANCE}`,
      {
        number: numeroLimpo,
        options: {
          delay: 1200,
          presence: 'composing'
        },
        textMessage: {
          text: mensagem
        }
      },
      {
        headers: {
          'apikey': WHATSAPP_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(200).json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Erro ao disparar WhatsApp:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Falha ao enviar mensagem via WhatsApp.',
      detalhes: error.response?.data || error.message
    });
  }
};