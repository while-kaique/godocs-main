const dados = $('Formatar Dados').item.json;

const fmtReais = Number(dados.saving_reais).toLocaleString('pt-BR', {minimumFractionDigits: 2});

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sucesso | Triagem de Fluxos</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --go-blue: #0059A9;
      --go-lime: #D7DB00;
      --go-cream: #FBF4EE;
      --go-light-blue: #C7E9FD;
      --go-white: #FFFFFF;
      --go-text-primary: #333333;
      --go-text-heading: #0059A9;
      --font-family: 'Poppins', sans-serif;
      --fw-regular: 400;
      --fw-semibold: 600;
      --fw-bold: 700;
      --fw-extrabold: 800;
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 24px;
      --radius-pill: 9999px;
      --shadow-lg: 0 8px 32px rgba(0, 89, 169, 0.10);
      --shadow-lime-glow: 0 4px 20px rgba(215, 219, 0, 0.3);
    }
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--font-family);background:var(--go-blue);min-height:100vh;color:var(--go-text-primary);line-height:1.6;padding:10px}
    .page-frame{display:none}
    .page-inner{background:var(--go-cream);min-height:calc(100vh - 20px);border-radius:var(--radius-xl);display:flex;align-items:center;justify-content:center;padding:20px}
    .container{position:relative;z-index:1;max-width:540px;width:100%}
    .header{text-align:center;margin-bottom:24px}
    .header h1{font-size:clamp(1.5rem, 3.5vw, 1.75rem);font-weight:var(--fw-extrabold);color:var(--go-text-heading);letter-spacing:-0.01em;margin-bottom:8px}
    .logo-container{display:inline-flex;align-items:center;justify-content:center}
    .logo-text{font-size:11px;font-weight:var(--fw-semibold);color:var(--go-blue);letter-spacing:0.15em;text-transform:uppercase;background:var(--go-lime);padding:4px 14px;border-radius:var(--radius-pill)}
    .success-card{background:var(--go-white);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-xl);padding:40px 32px 32px;text-align:center;box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
    .success-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg, #16a34a 0%, #4ade80 50%, var(--go-lime) 100%)}
    @media(max-width:640px){.success-card{padding:28px 18px 24px}}
    .browser-dots{display:flex;gap:7px;margin-bottom:24px;justify-content:center}
    .browser-dots span{width:10px;height:10px;border-radius:50%;background:var(--go-lime);display:block}
    .browser-dots span:first-child{background:var(--go-blue);opacity:0.25}
    .browser-dots span:nth-child(2){background:var(--go-blue);opacity:0.15}
    .success-icon-wrapper{width:72px;height:72px;background:rgba(22,163,74,0.06);border:2px solid rgba(22,163,74,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;animation:pulse 2.5s ease-in-out infinite}
    .success-icon-inner{width:48px;height:48px;background:rgba(22,163,74,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center}
    .success-icon-inner svg{width:24px;height:24px;stroke:#16a34a;stroke-width:2.5;fill:none;stroke-linecap:round;stroke-linejoin:round}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(22,163,74,0.08)}50%{box-shadow:0 0 0 12px rgba(22,163,74,0)}}
    .success-card h2{font-size:22px;font-weight:var(--fw-extrabold);color:var(--go-text-heading);margin-bottom:10px;letter-spacing:-0.01em}
    .success-card .subtitle{color:var(--go-text-primary);font-size:14px;margin-bottom:28px;line-height:1.6}
    .info-box{background:var(--go-light-blue);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-md);padding:18px;margin-bottom:28px;text-align:left}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid rgba(0,89,169,0.06);font-size:13px;gap:12px}
    .info-row:last-child{border-bottom:none}
    .info-label{color:var(--go-text-primary);flex-shrink:0;font-weight:var(--fw-regular)}
    .info-value{color:var(--go-blue);font-weight:var(--fw-semibold);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .status-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;background:rgba(215,219,0,0.12);border:1px solid rgba(215,219,0,0.3);border-radius:var(--radius-pill);color:#8a7d00;font-size:12px;font-weight:var(--fw-semibold)}
    .saving-highlight{display:inline-flex;align-items:center;gap:4px;color:#16a34a;font-weight:var(--fw-bold)}
    .divider{height:1.5px;background:rgba(0,89,169,0.08);margin:24px 0}
    .actions{display:flex;flex-direction:column;align-items:center;gap:12px}
    .btn-primary{display:inline-flex;align-items:center;gap:8px;padding:12px 32px;background:var(--go-lime);border:none;border-radius:var(--radius-pill);color:var(--go-blue);font-size:14px;font-weight:var(--fw-bold);font-family:var(--font-family);text-decoration:none;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s}
    .btn-primary:hover{transform:translateY(-2px);box-shadow:var(--shadow-lime-glow)}
    .help-text{color:#8b8b9a;font-size:12px}
    .footer{text-align:center;margin-top:20px;color:var(--go-text-primary);font-size:11px;opacity:0.7}
    .footer a{color:var(--go-blue);text-decoration:none;font-weight:var(--fw-semibold)}
    .footer a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="page-frame"></div>
  <div class="page-inner">
  <div class="container">
    <header class="header">
      <h1>Triagem de Fluxos</h1>
      <div class="logo-container">
        <span class="logo-text">RPA & IA</span>
      </div>
    </header>
    <div class="success-card">
      <div class="browser-dots"><span></span><span></span><span></span></div>
      <div class="success-icon-wrapper">
        <div class="success-icon-inner">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
      </div>
      <h2>Enviado com Sucesso!</h2>
      <p class="subtitle">
        Sua submissão foi recebida e será analisada pela equipe de RPA/IA.<br>
        Você receberá um retorno em breve.
      </p>
      <div class="info-box">
        <div class="info-row">
          <span class="info-label">Projeto</span>
          <span class="info-value">${dados.nome_projeto}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Área</span>
          <span class="info-value">${dados.area}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Saving Horas</span>
          <span class="info-value"><span class="saving-highlight">${dados.saving_horas}h/mês</span></span>
        </div>
        <div class="info-row">
          <span class="info-label">Saving Reais</span>
          <span class="info-value"><span class="saving-highlight">R$ ${fmtReais}/mês</span></span>
        </div>
        <div class="info-row">
          <span class="info-label">Status</span>
          <span class="info-value"><span class="status-badge">Pendente de análise</span></span>
        </div>
      </div>
      <div class="actions">
        <a href="https://n8n-study.gogroupgl.com/webhook/submit_workflows" class="btn-primary">Submeter outro fluxo</a>
        <span class="help-text">Dúvidas? Entre em contato com a equipe de RPA/IA</span>
      </div>
    </div>
    <footer class="footer">
      Desenvolvido pela equipe de <a href="#">RPA & IA</a> · GoGroup © 2025
    </footer>
  </div>
  </div>
</body>
</html>`;

return [{ json: { html } }];
