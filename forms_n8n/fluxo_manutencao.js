const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manutenção | Triagem de Fluxos</title>
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
    .maintenance-card{background:var(--go-white);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-xl);padding:40px 32px 32px;text-align:center;box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
    .maintenance-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg, var(--go-blue) 0%, var(--go-lime) 100%)}
    @media(max-width:640px){.maintenance-card{padding:28px 18px 24px}}
    .browser-dots{display:flex;gap:7px;margin-bottom:24px;justify-content:center}
    .browser-dots span{width:10px;height:10px;border-radius:50%;background:var(--go-lime);display:block}
    .browser-dots span:first-child{background:var(--go-blue);opacity:0.25}
    .browser-dots span:nth-child(2){background:var(--go-blue);opacity:0.15}
    .maintenance-icon-wrapper{width:72px;height:72px;background:rgba(0,89,169,0.06);border:2px solid rgba(0,89,169,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 24px;animation:pulse 2.5s ease-in-out infinite}
    .maintenance-icon-inner{width:48px;height:48px;background:rgba(0,89,169,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center}
    .maintenance-icon-inner svg{width:26px;height:26px;stroke:var(--go-blue);stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
    @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(0,89,169,0.08)}50%{box-shadow:0 0 0 12px rgba(0,89,169,0)}}
    .maintenance-card h2{font-size:22px;font-weight:var(--fw-extrabold);color:var(--go-text-heading);margin-bottom:10px;letter-spacing:-0.01em}
    .maintenance-card .subtitle{color:var(--go-text-primary);font-size:14px;margin-bottom:28px;line-height:1.6}
    .info-box{background:var(--go-light-blue);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-md);padding:22px 20px;margin-bottom:28px;text-align:left}
    .info-box p{font-size:13px;color:var(--go-text-primary);line-height:1.7}
    .info-box p strong{color:var(--go-blue);font-weight:var(--fw-semibold)}
    .status-badge-maintenance{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;background:rgba(0,89,169,0.08);border:1px solid rgba(0,89,169,0.15);border-radius:var(--radius-pill);color:var(--go-blue);font-size:12px;font-weight:var(--fw-semibold);margin-bottom:24px}
    .status-badge-maintenance::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--go-lime);display:inline-block;animation:blink 1.5s ease-in-out infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}
    .divider{height:1.5px;background:rgba(0,89,169,0.08);margin:24px 0}
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
    <div class="maintenance-card">
      <div class="browser-dots"><span></span><span></span><span></span></div>
      <div class="maintenance-icon-wrapper">
        <div class="maintenance-icon-inner">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </div>
      </div>
      <h2>Formulário em Manutenção</h2>
      <p class="subtitle">
        O formulário de submissão de fluxos está temporariamente<br>
        indisponível para melhorias e ajustes.
      </p>
      <span class="status-badge-maintenance">Em manutenção</span>
      <div class="info-box">
        <p>
          Estamos trabalhando para trazer melhorias ao processo de submissão.
          <strong>Em breve abriremos novamente para novas submissões.</strong><br><br>
          Enquanto isso, caso tenha urgência, entre em contato diretamente com a equipe de RPA & IA.
        </p>
      </div>
      <span class="help-text">Agradecemos a compreensão!</span>
    </div>
    <footer class="footer">
      Desenvolvido pela equipe de <a href="#">RPA & IA</a> · GoGroup © 2025
    </footer>
  </div>
  </div>
</body>
</html>`;

return [{ json: { html } }];
