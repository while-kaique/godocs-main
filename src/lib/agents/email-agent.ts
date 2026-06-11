// Agente de Email (Brevo)
// Dispara emails de aprovação ou rejeição para o responsável pelo projeto

import type { DocumentacaoGerada } from './types';
import type { ResultadoValidacao } from './validator';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'noreply@gocase.com';

  if (!apiKey) throw new Error('BREVO_API_KEY não configurada.');

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'GoDocs', email: from },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Brevo error ${res.status}: ${err}`);
  }
}

export async function enviarEmailAprovacao(
  doc: DocumentacaoGerada,
  validacao: ResultadoValidacao
): Promise<void> {
  const subject = `✅ Projeto aprovado: ${doc.titulo}`;

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="background: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
    <h2 style="margin: 0; color: #15803d;">✅ Projeto Aprovado</h2>
  </div>

  <p>Olá, <strong>${doc.responsavel.nome}</strong>!</p>

  <p>Seu projeto <strong>"${doc.titulo}"</strong> foi analisado e <strong>aprovado</strong> para ir à produção.</p>

  <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin-top: 0; color: #374151;">Parecer do analista</h3>
    <p style="margin: 0; line-height: 1.6;">${validacao.parecer}</p>
  </div>

  <h3 style="color: #374151;">Resumo do projeto</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr><td style="padding: 8px 0; color: #6b7280; width: 40%;">Ferramenta</td><td style="padding: 8px 0;"><strong>${doc.ferramenta}</strong></td></tr>
    <tr><td style="padding: 8px 0; color: #6b7280;">Área</td><td style="padding: 8px 0;"><strong>${doc.responsavel.area ?? '—'}</strong></td></tr>
    <tr><td style="padding: 8px 0; color: #6b7280;">O que faz</td><td style="padding: 8px 0;">${doc.o_que_faz}</td></tr>
    <tr><td style="padding: 8px 0; color: #6b7280;">Execução</td><td style="padding: 8px 0;">${doc.execucao}</td></tr>
  </table>

  <p style="margin-top: 32px; color: #6b7280; font-size: 13px;">GoDocs · Sistema interno de auditoria de automações · Gocase</p>
</body>
</html>`;

  await sendEmail(doc.responsavel.email, subject, html);
}

export async function enviarEmailRejeicao(
  doc: DocumentacaoGerada,
  validacao: ResultadoValidacao
): Promise<void> {
  const subject = `🔍 Projeto em revisão: ${doc.titulo}`;

  const criteriosReprovados = validacao.criterios
    .filter((c) => !c.aprovado)
    .map((c) => `<li><strong>${c.criterio}:</strong> ${c.observacao}</li>`)
    .join('');

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="font-family: Arial, sans-serif; color: #1a1a1a; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="background: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; border-radius: 4px; margin-bottom: 24px;">
    <h2 style="margin: 0; color: #92400e;">🔍 Projeto em Revisão</h2>
  </div>

  <p>Olá, <strong>${doc.responsavel.nome}</strong>!</p>

  <p>Seu projeto <strong>"${doc.titulo}"</strong> foi analisado e a nossa análise identificou alguns pontos que precisam de atenção. O time de RPA entrará em contato para conversar sobre os ajustes necessários.</p>

  <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin-top: 0; color: #374151;">Parecer da análise</h3>
    <p style="margin: 0; line-height: 1.6;">${validacao.parecer}</p>
  </div>

  ${criteriosReprovados ? `
  <h3 style="color: #374151;">Pontos de atenção</h3>
  <ul style="line-height: 1.8; color: #374151;">
    ${criteriosReprovados}
  </ul>` : ''}

  <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <p style="margin: 0; color: #1d4ed8;">
      <strong>Próximo passo:</strong> Aguarde o contato do time de RPA. Vocês irão revisar juntos os pontos acima e, se necessário, você poderá ajustar e reenviar o projeto.
    </p>
  </div>

  <p style="margin-top: 32px; color: #6b7280; font-size: 13px;">GoDocs · Sistema interno de auditoria de automações · Gocase</p>
</body>
</html>`;

  await sendEmail(doc.responsavel.email, subject, html);
}
