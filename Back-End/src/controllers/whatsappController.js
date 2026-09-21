const axios = require('axios');
const Favorito = require('../models/Favorito');
const { enviarEmail } = require('../services/emailService');

// Configurações via variáveis de ambiente com fallbacks para testes
const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || 'http://localhost:8080';
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || '';
const WHATSAPP_INSTANCE = process.env.WHATSAPP_INSTANCE || 'cuida';

/**
 * Função interna reutilizável: dispara um texto para um número via API do WhatsApp.
 * Retorna os dados da API ou lança erro.
 */
async function dispararTexto(numero, mensagem) {
  const numeroLimpo = String(numero).replace(/\D/g, '');

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

  return response.data;
}

/**
 * Pega o primeiro campo preenchido dentre vários nomes possíveis de coluna.
 * Evita quebrar caso a tabela use 'celular' em vez de 'telefone', etc.
 */
function primeiroCampo(obj, nomes) {
  if (!obj) return null;
  for (const nome of nomes) {
    if (obj[nome]) return obj[nome];
  }
  return null;
}

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

  try {
    const data = await dispararTexto(numero, mensagem);

    return res.status(200).json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Erro ao disparar WhatsApp:', error.response?.data || error.message);
    return res.status(500).json({
      error: 'Falha ao enviar mensagem via WhatsApp.',
      detalhes: error.response?.data || error.message
    });
  }
};

/**
 * Notifica todos os cidadãos que favoritaram um medicamento em uma unidade,
 * avisando que o estoque foi reposto. Dispara WhatsApp e e-mail.
 *
 * POST /api/whatsapp/notificar-disponibilidade
 * Body: { "id_medicamento": 12, "id_unidade": 3 }
 */
exports.notificarDisponibilidade = async (req, res) => {
  const { id_medicamento, id_unidade } = req.body;

  if (!id_medicamento || !id_unidade) {
    return res.status(400).json({
      error: 'id_medicamento e id_unidade são obrigatórios.'
    });
  }

  try {
    const inscritos = await Favorito.buscarInteressados(id_medicamento, id_unidade);

    if (!inscritos.length) {
      return res.status(200).json({
        success: true,
        total_notificados: 0,
        message: 'Nenhum cidadão cadastrado para este medicamento nesta unidade.'
      });
    }

    const resultados = await Promise.all(
      inscritos.map(async (item) => {
        const cliente = item.cliente || {};
        const nome = primeiroCampo(cliente, ['nome', 'nome_cliente']) || 'cidadão';
        const telefone = primeiroCampo(cliente, ['telefone', 'celular', 'whatsapp']);
        const email = primeiroCampo(cliente, ['email', 'e_mail']);

        const medicamento = item.medicamento?.nome || 'seu medicamento';
        const unidade = item.unidade?.nome_unidade || 'sua unidade de saúde';

        const texto =
          `Olá, ${nome}! O medicamento *${medicamento}* já está disponível ` +
          `para retirada na UBS *${unidade}*. ` +
          `Compareça com seu documento e receita médica.`;

        const status = {
          id_favorito: item.id_favorito,
          id_cliente: item.id_cliente,
          nome,
          whatsapp: 'nao_enviado',
          email: 'nao_enviado'
        };

        // 1. Disparo WhatsApp
        if (telefone) {
          try {
            await dispararTexto(telefone, texto);
            status.whatsapp = 'enviado';
          } catch (err) {
            status.whatsapp = 'erro';
            status.erro_whatsapp = err.response?.data || err.message;
            console.error(`Erro WhatsApp para ${nome}:`, status.erro_whatsapp);
          }
        }

        // 2. Disparo E-mail
        if (email) {
          try {
            await enviarEmail({
              para: email,
              assunto: `[CUIDA] Medicamento disponível: ${medicamento}`,
              html:
                `<p>Olá <strong>${nome}</strong>,</p>` +
                `<p>O medicamento <strong>${medicamento}</strong> já está disponível na unidade <strong>${unidade}</strong>.</p>` +
                `<p>Compareça com seu documento e receita médica.</p>` +
                `<p>Equipe CUIDA</p>`
            });
            status.email = 'enviado';
          } catch (err) {
            status.email = 'erro';
            status.erro_email = err.message;
            console.error(`Erro e-mail para ${nome}:`, err.message);
          }
        }

        return status;
      })
    );

    const totalWhatsapp = resultados.filter((r) => r.whatsapp === 'enviado').length;
    const totalEmail = resultados.filter((r) => r.email === 'enviado').length;

    return res.status(200).json({
      success: true,
      total_inscritos: inscritos.length,
      total_whatsapp_enviados: totalWhatsapp,
      total_emails_enviados: totalEmail,
      detalhes: resultados
    });
  } catch (error) {
    console.error('Erro no broadcast de notificação:', error);
    return res.status(500).json({
      error: 'Falha ao processar notificações.',
      detalhes: error.message
    });
  }
};