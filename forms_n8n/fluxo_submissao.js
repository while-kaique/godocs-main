const areas = [
  "AZ",
  "B2B Gobeaute",
  "B2B Gocase",
  "Contabilidade",
  "CSC",
  "CX",
  "CX - Agentes",
  "Dados",
  "Departamento Pessoal",
  "E-commerce",
  "Facilities",
  "Financeiro",
  "Fiscal",
  "FP&A",
  "Gente e Gestão",
  "Growth",
  "Ilustração",
  "Jurídico",
  "Logística",
  "M&A",
  "Marketing de Influência",
  "Offline - Administrativo",
  "Offline - Lojas",
  "Operações Gobeaute",
  "Operações Gocase - Administrativo",
  "Transportes",
  "Qualidade",
  "Manutenção",
  "Expedição",
  "Almoxarifado",
  "Produção",
  "Produto Gobeaute",
  "Produto Gocase",
  "Projetos e Integrações",
  "RPA",
  "Marketing - Branding",
  "Sourcing & Procurement Gobeaute",
  "Supply Gogroup",
  "Tecnologia"
];

const ferramentas = [
  "n8n","Python","Google Apps Script","Make",
  "Lovable", "Selenium","Puppeteer","Power BI", "Claude + Vercel", "Outros"
];

const areasOptions = areas.map(a => '<option value="' + a + '">' + a + '</option>').join('');
const ferramentasOptions = ferramentas.map(f => '<option value="' + f + '">' + f + '</option>').join('');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Triagem de Fluxos | RPA & IA</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    /* ══════════════════════════════════════════════
       GoGroup Design System — Triagem de Fluxos
       ══════════════════════════════════════════════ */

    :root {
      /* Primarias */
      --go-blue: #0059A9;
      --go-lime: #D7DB00;

      /* Superficies */
      --go-cream: #FBF4EE;
      --go-light-blue: #C7E9FD;
      --go-white: #FFFFFF;

      /* Texto */
      --go-text-primary: #333333;
      --go-text-dark: #000000;
      --go-text-on-blue: #FFFFFF;
      --go-text-heading: #0059A9;

      /* Semanticas */
      --go-bg-page: var(--go-cream);
      --go-bg-section-alt: var(--go-light-blue);
      --go-bg-hero: var(--go-blue);
      --go-accent: var(--go-lime);
      --go-border: var(--go-blue);

      /* Tipografia */
      --font-family: 'Poppins', sans-serif;
      --fw-regular: 400;
      --fw-semibold: 600;
      --fw-bold: 700;
      --fw-extrabold: 800;
      --fw-black: 900;

      --fs-display: clamp(2rem, 5vw, 4rem);
      --fs-h1: clamp(1.75rem, 4vw, 3rem);
      --fs-h2: clamp(1.375rem, 3vw, 2.25rem);
      --fs-h3: clamp(1.125rem, 2vw, 1.5rem);
      --fs-h4: clamp(0.9375rem, 1.5vw, 1.125rem);
      --fs-body: clamp(0.9375rem, 1.2vw, 1rem);
      --fs-small: clamp(0.8125rem, 1vw, 0.875rem);
      --fs-caption: clamp(0.6875rem, 0.8vw, 0.75rem);

      /* Espacamento */
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 24px;
      --space-6: 32px;
      --space-7: 48px;
      --space-8: 64px;

      /* Radius */
      --radius-sm: 8px;
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 24px;
      --radius-pill: 9999px;

      /* Sombras */
      --shadow-sm: 0 2px 8px rgba(0, 89, 169, 0.06);
      --shadow-md: 0 4px 16px rgba(0, 89, 169, 0.08);
      --shadow-lg: 0 8px 32px rgba(0, 89, 169, 0.10);
      --shadow-lime-glow: 0 4px 20px rgba(215, 219, 0, 0.3);
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font-family);
      background: var(--go-blue);
      min-height: 100vh;
      color: var(--go-text-primary);
      line-height: 1.6;
      padding: 10px;
    }

    /* ── PAGE FRAME ── */
    .page-frame { display: none; }

    .page-inner {
      background: var(--go-bg-page);
      min-height: calc(100vh - 20px);
      border-radius: var(--radius-xl);
      overflow: hidden;
    }

    .container {
      position: relative;
      z-index: 1;
      max-width: 680px;
      margin: 0 auto;
      padding: var(--space-7) var(--space-5) var(--space-6);
    }

    /* ── HEADER ── */
    .header {
      text-align: center;
      margin-bottom: var(--space-6);
    }
    .logo-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--space-4);
    }
    .logo-text {
      font-size: var(--fs-caption);
      font-weight: var(--fw-semibold);
      color: var(--go-blue);
      letter-spacing: 0.15em;
      text-transform: uppercase;
      background: var(--go-lime);
      padding: 4px 14px;
      border-radius: var(--radius-pill);
    }
    .header h1 {
      font-size: clamp(1.5rem, 3.5vw, 1.75rem);
      font-weight: var(--fw-extrabold);
      margin-bottom: var(--space-2);
      color: var(--go-text-heading);
      letter-spacing: -0.01em;
      line-height: 1.2;
    }
    .header p {
      color: var(--go-text-primary);
      font-size: var(--fs-body);
      max-width: 440px;
      margin: 0 auto;
      font-weight: var(--fw-regular);
    }
    .header p strong {
      color: var(--go-blue);
      font-weight: var(--fw-semibold);
    }

    /* ── FORM CARD ── */
    .form-card {
      background: var(--go-white);
      border: 1px solid rgba(0, 89, 169, 0.08);
      border-radius: var(--radius-xl);
      padding: var(--space-6) var(--space-6) var(--space-5);
      box-shadow: var(--shadow-lg);
      position: relative;
      overflow: hidden;
    }
    .form-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--go-blue) 0%, var(--go-blue) 60%, var(--go-lime) 100%);
    }
    @media (max-width: 640px) {
      .form-card { padding: var(--space-5) var(--space-4) var(--space-4); }
    }

    /* Browser dots */
    .browser-dots {
      display: flex;
      gap: 7px;
      margin-bottom: var(--space-5);
      padding-top: var(--space-3);
    }
    .browser-dots span {
      width: 10px; height: 10px;
      border-radius: 50%;
      background: var(--go-lime);
      display: block;
    }
    .browser-dots span:first-child { background: var(--go-blue); opacity: 0.25; }
    .browser-dots span:nth-child(2) { background: var(--go-blue); opacity: 0.15; }

    /* ── WIZARD PROGRESS ── */
    .wizard-progress {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      margin-bottom: var(--space-6);
      padding: 0 var(--space-2);
    }
    .wizard-step-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      cursor: default;
      position: relative;
      z-index: 1;
      min-width: 64px;
    }
    .wizard-step-indicator.clickable { cursor: pointer; }
    .step-circle {
      width: 36px; height: 36px;
      border-radius: 50%;
      border: 2.5px solid rgba(0, 89, 169, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: var(--fw-bold);
      color: rgba(0, 89, 169, 0.35);
      background: var(--go-white);
      transition: all 0.3s ease;
      flex-shrink: 0;
    }
    .step-circle.active {
      background: var(--go-blue);
      border-color: var(--go-blue);
      color: var(--go-white);
      box-shadow: 0 0 0 4px rgba(0, 89, 169, 0.1);
    }
    .step-circle.completed {
      background: var(--go-blue);
      border-color: var(--go-blue);
      color: var(--go-white);
    }
    .step-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: rgba(0, 89, 169, 0.4);
      font-weight: var(--fw-semibold);
      transition: color 0.3s;
      text-align: center;
    }
    .wizard-step-indicator.active .step-label { color: var(--go-blue); }
    .wizard-step-indicator.completed .step-label { color: var(--go-text-primary); }
    .step-connector {
      flex: 1;
      height: 2.5px;
      background: rgba(0, 89, 169, 0.1);
      position: relative;
      min-width: 32px;
      align-self: flex-start;
      margin-top: 17px;
      border-radius: 2px;
    }
    .connector-fill {
      position: absolute;
      top: 0; left: 0; bottom: 0;
      width: 100%;
      background: var(--go-blue);
      border-radius: 2px;
      transform: scaleX(0);
      transform-origin: left;
      transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .step-connector.filled .connector-fill { transform: scaleX(1); }
    @media (max-width: 480px) {
      .step-label { display: none; }
      .wizard-step-indicator { min-width: auto; }
      .step-circle { width: 30px; height: 30px; font-size: 12px; }
      .step-connector { min-width: 24px; margin-top: 14px; }
    }

    /* ── WIZARD STEPS ── */
    .wizard-steps-container { position: relative; min-height: 200px; }
    .wizard-step { display: none; }
    .wizard-step.active {
      display: block;
      animation: stepIn 0.35s cubic-bezier(0.4, 0, 0.2, 1) both;
    }
    .wizard-step.active.back { animation-name: stepInBack; }
    @keyframes stepIn {
      from { opacity: 0; transform: translateX(24px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes stepInBack {
      from { opacity: 0; transform: translateX(-24px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .wizard-step.active .form-group,
    .wizard-step.active .form-row,
    .wizard-step.active .saving-grid,
    .wizard-step.active .section-title {
      animation: fieldUp 0.3s ease both;
    }
    @keyframes fieldUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .wizard-step.active > :nth-child(1) { animation-delay: 0s; }
    .wizard-step.active > :nth-child(2) { animation-delay: .04s; }
    .wizard-step.active > :nth-child(3) { animation-delay: .08s; }
    .wizard-step.active > :nth-child(4) { animation-delay: .12s; }
    .wizard-step.active > :nth-child(5) { animation-delay: .16s; }
    .wizard-step.active > :nth-child(6) { animation-delay: .2s; }
    .wizard-step.active > :nth-child(7) { animation-delay: .24s; }
    .wizard-step.active > :nth-child(8) { animation-delay: .28s; }
    .wizard-step.active > :nth-child(9) { animation-delay: .32s; }

    /* ── WIZARD NAV ── */
    .wizard-nav {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: var(--space-5);
      gap: var(--space-3);
    }
    .btn-back {
      padding: 11px 24px;
      background: transparent;
      border: 2px solid var(--go-blue);
      border-radius: var(--radius-pill);
      color: var(--go-blue);
      font-size: var(--fs-small);
      font-weight: var(--fw-semibold);
      font-family: var(--font-family);
      cursor: pointer;
      transition: background 0.2s ease, color 0.2s ease;
    }
    .btn-back:hover {
      background: var(--go-blue);
      color: var(--go-white);
    }
    .btn-next {
      padding: 12px 32px;
      background: var(--go-lime);
      border: none;
      border-radius: var(--radius-pill);
      color: var(--go-blue);
      font-size: var(--fs-small);
      font-weight: var(--fw-semibold);
      font-family: var(--font-family);
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      margin-left: auto;
    }
    .btn-next:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lime-glow);
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-5px); }
      40% { transform: translateX(5px); }
      60% { transform: translateX(-3px); }
      80% { transform: translateX(3px); }
    }
    .shake { animation: shake 0.3s ease; }

    /* ── SUMMARY CARD ── */
    .summary-card {
      margin-top: var(--space-5);
      padding: var(--space-4);
      background: var(--go-light-blue);
      border: 1px solid rgba(0, 89, 169, 0.1);
      border-radius: var(--radius-md);
    }
    .summary-card-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--go-blue);
      margin-bottom: var(--space-3);
      font-weight: var(--fw-bold);
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 7px 0;
      border-bottom: 1px solid rgba(0, 89, 169, 0.06);
      font-size: 13px;
      gap: var(--space-3);
    }
    .summary-row:last-child { border-bottom: none; }
    .summary-label { color: var(--go-text-primary); flex-shrink: 0; font-weight: var(--fw-regular); }
    .summary-value {
      color: var(--go-blue);
      font-weight: var(--fw-semibold);
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── FORM ELEMENTS ── */
    .form-section { margin-bottom: 0; }
    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: var(--fw-bold);
      color: var(--go-text-heading);
      margin-bottom: 22px;
      padding-bottom: 10px;
      border-bottom: 1.5px solid rgba(0, 89, 169, 0.1);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .section-icon {
      width: 28px; height: 28px;
      background: rgba(0, 89, 169, 0.07);
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }
    .form-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--space-4);
    }
    @media (max-width: 640px) { .form-row { grid-template-columns: 1fr; } }
    .form-group { margin-bottom: 18px; }
    .form-label {
      display: block;
      font-size: 13px;
      font-weight: var(--fw-semibold);
      color: var(--go-text-primary);
      margin-bottom: 6px;
    }
    .label-hint {
      display: block;
      font-size: 11px;
      color: #8b8b9a;
      font-weight: var(--fw-regular);
      margin-top: 2px;
    }
    .required { color: #dc2626; margin-left: 3px; }

    .form-input, .form-select, .form-textarea {
      width: 100%;
      padding: 11px 14px;
      background: var(--go-white);
      border: 1.5px solid rgba(0, 89, 169, 0.18);
      border-radius: var(--radius-sm);
      color: var(--go-text-primary);
      font-size: 14px;
      font-family: var(--font-family);
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .form-input:focus, .form-select:focus, .form-textarea:focus {
      outline: none;
      border-color: var(--go-blue);
      box-shadow: 0 0 0 3px rgba(0, 89, 169, 0.08);
    }
    .form-input::placeholder, .form-textarea::placeholder { color: #b0b0b8; }
    .form-input.invalid, .form-select.invalid, .form-textarea.invalid {
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.08);
    }
    .form-input[type="date"] { cursor: pointer; }
    .form-input[type="date"]::-webkit-calendar-picker-indicator { filter: none; cursor: pointer; }
    .field-error { color: #dc2626; font-size: 11px; margin-top: 4px; display: none; font-weight: var(--fw-semibold); }
    .field-error.show { display: block; }

    .form-select {
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%230059A9' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 14px;
      padding-right: 36px;
    }
    .form-select option { background: var(--go-white); color: var(--go-text-primary); }
    .form-textarea { min-height: 100px; resize: vertical; }
    .form-textarea.large { min-height: 150px; }

    /* ── FILE UPLOAD ── */
    .file-upload {
      position: relative;
      border: 2px dashed rgba(0, 89, 169, 0.25);
      border-radius: var(--radius-md);
      padding: var(--space-5);
      text-align: center;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      background: rgba(199, 233, 253, 0.15);
    }
    .file-upload:hover {
      border-color: var(--go-blue);
      background: rgba(199, 233, 253, 0.3);
    }
    .file-upload.dragover {
      border-color: var(--go-blue);
      background: rgba(199, 233, 253, 0.4);
    }
    .file-upload.invalid { border-color: #dc2626; }
    .file-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 2; }
    .file-upload-icon { font-size: 28px; margin-bottom: var(--space-2); opacity: 0.6; }
    .file-upload-text { color: var(--go-text-primary); font-size: 12px; }
    .file-upload-text strong { color: var(--go-blue); }
    .file-name {
      margin-top: var(--space-2);
      padding: 7px 12px;
      background: rgba(0, 89, 169, 0.04);
      border-radius: var(--radius-sm);
      color: var(--go-blue);
      font-size: 12px;
      font-weight: var(--fw-semibold);
      display: none;
    }
    .file-name.show { display: block; }

    /* ── DOC HELPER ── */
    .doc-helper {
      margin-top: 10px;
      padding: 10px 12px;
      background: rgba(215, 219, 0, 0.05);
      border: 1px solid rgba(215, 219, 0, 0.2);
      border-radius: var(--radius-sm);
    }
    .doc-helper-header { display: flex; align-items: flex-start; gap: 7px; margin-bottom: var(--space-2); }
    .doc-helper-icon { font-size: 14px; flex-shrink: 0; }
    .doc-helper-text { font-size: 11px; color: var(--go-text-primary); line-height: 1.5; }
    .doc-helper-text strong { color: var(--go-blue); }
    .doc-helper-link-box {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0, 89, 169, 0.03);
      border: 1px solid rgba(0, 89, 169, 0.1);
      border-radius: var(--radius-sm);
      padding: 7px 9px;
    }
    .doc-helper-link-input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--go-blue);
      font-size: 10px;
      font-family: monospace;
      outline: none;
      min-width: 0;
    }
    .doc-helper-copy-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      background: var(--go-lime);
      border: none;
      border-radius: var(--radius-pill);
      color: var(--go-blue);
      font-size: 10px;
      font-weight: var(--fw-semibold);
      font-family: var(--font-family);
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      white-space: nowrap;
    }
    .doc-helper-copy-btn:hover { transform: translateY(-1px); box-shadow: var(--shadow-lime-glow); }
    .doc-helper-copy-btn.copied {
      background: rgba(34, 197, 94, 0.12);
      color: #16a34a;
    }
    .doc-helper-hint { margin-top: 5px; font-size: 10px; color: #8b8b9a; text-align: center; }

    /* ── RADIO GROUPS ── */
    .radio-group { display: flex; gap: 10px; }
    .radio-option { flex: 1; position: relative; }
    .radio-option input { position: absolute; opacity: 0; }
    .radio-label {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 11px 14px;
      background: transparent;
      border: 1.5px solid rgba(0, 89, 169, 0.18);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      font-weight: var(--fw-semibold);
      font-size: 13px;
      color: var(--go-text-primary);
    }
    .radio-option input:checked + .radio-label {
      background: rgba(0, 89, 169, 0.05);
      border-color: var(--go-blue);
      color: var(--go-blue);
    }
    .radio-label:hover { border-color: rgba(0, 89, 169, 0.4); }

    /* ── SAVING GRID ── */
    .saving-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }
    @media (max-width: 640px) { .saving-grid { grid-template-columns: 1fr; } }
    .saving-card {
      background: rgba(199, 233, 253, 0.25);
      border: 1px solid rgba(0, 89, 169, 0.08);
      border-radius: var(--radius-md);
      padding: var(--space-4);
    }
    .saving-card-header { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
    .saving-icon {
      width: 34px; height: 34px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 17px;
    }
    .saving-icon.hours { background: rgba(0, 89, 169, 0.07); }
    .saving-icon.money { background: rgba(215, 219, 0, 0.15); }
    .saving-card-title { font-size: 12px; font-weight: var(--fw-bold); color: var(--go-text-heading); }
    .saving-card-subtitle { font-size: 10px; color: #8b8b9a; }

    /* ── BUTTONS SUBMIT ── */
    .btn-submit {
      width: 100%;
      padding: 13px 28px;
      background: var(--go-lime);
      border: none;
      border-radius: var(--radius-pill);
      color: var(--go-blue);
      font-size: 15px;
      font-weight: var(--fw-bold);
      font-family: var(--font-family);
      cursor: pointer;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-left: auto;
    }
    .btn-submit:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lime-glow);
    }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .spinner {
      width: 18px; height: 18px;
      border: 2.5px solid rgba(0, 89, 169, 0.2);
      border-top-color: var(--go-blue);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-message {
      background: rgba(220, 38, 38, 0.04);
      border: 1px solid rgba(220, 38, 38, 0.15);
      border-radius: var(--radius-sm);
      padding: 12px;
      margin-top: 14px;
      color: #dc2626;
      font-size: 12px;
      font-weight: var(--fw-semibold);
      display: none;
    }
    .error-message.show { display: block; }

    /* ── FOOTER ── */
    .footer {
      text-align: center;
      margin-top: var(--space-5);
      color: var(--go-text-primary);
      font-size: 11px;
      opacity: 0.7;
    }
    .footer a { color: var(--go-blue); text-decoration: none; font-weight: var(--fw-semibold); }
    .footer a:hover { text-decoration: underline; }

    /* ── INPUT PREFIX ── */
    .input-prefix { position: relative; }
    .input-prefix .prefix {
      position: absolute;
      left: 14px; top: 50%;
      transform: translateY(-50%);
      color: var(--go-blue);
      font-weight: var(--fw-semibold);
      font-size: 14px;
    }
    .input-prefix .form-input { padding-left: 40px; }

    /* ── CONDITIONAL FIELDS ── */
    .conditional-field {
      margin-top: 10px;
      display: none;
      animation: slideDown 0.25s ease;
    }
    .conditional-field.show { display: block; }
    @keyframes slideDown {
      from { opacity: 0; transform: translateY(-6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .conditional-field .form-input,
    .conditional-field .form-textarea {
      border-color: rgba(215, 219, 0, 0.35);
    }
    .conditional-field .form-input:focus,
    .conditional-field .form-textarea:focus {
      border-color: #b8a600;
      box-shadow: 0 0 0 3px rgba(215, 219, 0, 0.08);
    }
    .conditional-label {
      font-size: 11px;
      color: #8a7d00;
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: var(--fw-semibold);
    }

    /* ── EXAMPLE BOX ── */
    .example-box {
      background: rgba(0, 89, 169, 0.03);
      border: 1px solid rgba(0, 89, 169, 0.08);
      border-radius: var(--radius-sm);
      padding: 12px;
      margin-top: 8px;
      font-size: 11px;
      color: var(--go-text-primary);
    }
    .example-box strong { color: var(--go-blue); display: block; margin-bottom: 5px; }
    .example-box ul { margin: 0; padding-left: 16px; }
    .example-box li { margin-bottom: 2px; }

    .step-divider { height: 1.5px; background: rgba(0, 89, 169, 0.08); margin: 22px 0; }

    /* ── N8N ALERTS ── */
    .n8n-name-alert {
      display: none;
      margin-top: 8px;
      padding: 10px 12px;
      background: rgba(215, 219, 0, 0.06);
      border: 1px solid rgba(215, 219, 0, 0.2);
      border-radius: var(--radius-sm);
      animation: slideDown 0.25s ease;
    }
    .n8n-name-alert.show { display: block; }
    .n8n-name-alert-title {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: var(--fw-bold);
      color: #8a7d00;
      margin-bottom: 5px;
    }
    .n8n-name-alert-body { font-size: 11px; color: var(--go-text-primary); line-height: 1.5; }
    .n8n-name-alert-body strong { color: #8a7d00; }
    .n8n-name-alert-steps { margin: 5px 0 0; padding-left: 14px; color: #8b8b9a; font-size: 10px; }
    .n8n-name-alert-steps li { margin-bottom: 2px; }
    .n8n-name-status {
      display: none;
      margin-top: 5px;
      font-size: 10px;
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      font-weight: var(--fw-semibold);
    }
    .n8n-name-status.show { display: inline-flex; align-items: center; gap: 4px; }
    .n8n-name-status.ok {
      background: rgba(34, 197, 94, 0.06);
      color: #16a34a;
      border: 1px solid rgba(34, 197, 94, 0.15);
    }
    .n8n-name-status.warn {
      background: rgba(215, 219, 0, 0.06);
      color: #8a7d00;
      border: 1px solid rgba(215, 219, 0, 0.2);
    }

    .doc-no-json-warning {
      display: flex;
      align-items: flex-start;
      gap: 7px;
      margin-bottom: 8px;
      padding: 9px 11px;
      background: rgba(220, 38, 38, 0.03);
      border: 1px solid rgba(220, 38, 38, 0.12);
      border-radius: var(--radius-sm);
      font-size: 11px;
      color: #dc2626;
      line-height: 1.5;
    }
    .doc-no-json-warning strong { color: #b91c1c; }
    .doc-no-json-warning-icon { font-size: 14px; flex-shrink: 0; margin-top: 1px; }

    /* ── CHIPS ── */
    .chips-input {
      width: 100%;
      min-height: 42px;
      padding: 5px 7px;
      background: var(--go-white);
      border: 1.5px solid rgba(0, 89, 169, 0.18);
      border-radius: var(--radius-sm);
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
      cursor: text;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .chips-input:focus-within {
      border-color: var(--go-blue);
      box-shadow: 0 0 0 3px rgba(0, 89, 169, 0.08);
    }
    .chips-input.invalid {
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.08);
    }
    .conditional-field .chips-input { border-color: rgba(215, 219, 0, 0.35); }
    .conditional-field .chips-input:focus-within {
      border-color: #b8a600;
      box-shadow: 0 0 0 3px rgba(215, 219, 0, 0.08);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 4px 3px 9px;
      background: rgba(0, 89, 169, 0.06);
      border: 1px solid rgba(0, 89, 169, 0.18);
      border-radius: var(--radius-pill);
      color: var(--go-blue);
      font-size: 11px;
      font-weight: var(--fw-semibold);
      max-width: 100%;
      animation: chipIn 0.15s ease;
    }
    .chip.invalid-email {
      background: rgba(220, 38, 38, 0.05);
      border-color: rgba(220, 38, 38, 0.2);
      color: #dc2626;
    }
    .chip-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; }
    .chip-remove {
      width: 15px; height: 15px;
      border-radius: 50%;
      background: rgba(0, 89, 169, 0.1);
      border: none;
      color: inherit;
      font-size: 12px;
      line-height: 1;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .chip-remove:hover { background: rgba(0, 89, 169, 0.2); }
    .chip.invalid-email .chip-remove { background: rgba(220, 38, 38, 0.12); }
    .chip.invalid-email .chip-remove:hover { background: rgba(220, 38, 38, 0.25); }
    .chips-field {
      flex: 1;
      min-width: 160px;
      border: none;
      outline: none;
      background: transparent;
      color: var(--go-text-primary);
      font-size: 14px;
      font-family: var(--font-family);
      padding: 4px 3px;
    }
    .chips-field::placeholder { color: #b0b0b8; }
    @keyframes chipIn {
      from { opacity: 0; transform: scale(0.9); }
      to   { opacity: 1; transform: scale(1); }
    }
    .chip-invalid-tip {
      display: none;
      margin-top: 4px;
      padding: 4px 9px;
      background: rgba(220, 38, 38, 0.03);
      border: 1px solid rgba(220, 38, 38, 0.12);
      border-radius: var(--radius-sm);
      color: #dc2626;
      font-size: 11px;
      font-weight: var(--fw-semibold);
      animation: slideDown 0.2s ease;
    }
    .chip-invalid-tip.show { display: block; }

    /* ── PRODUCTION GATE ── */
    .prod-gate {
      margin-bottom: var(--space-5);
      padding: var(--space-4);
      background: rgba(199, 233, 253, 0.3);
      border: 1px solid rgba(0, 89, 169, 0.08);
      border-radius: var(--radius-md);
      position: relative;
    }
    .prod-gate-label {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      font-weight: var(--fw-bold);
      color: var(--go-text-heading);
      margin-bottom: 14px;
    }
    .prod-gate-label .info-icon { position: relative; top: 0; }
    .prod-gate .radio-group { flex-direction: column; gap: 8px; }
    .prod-gate .radio-label { justify-content: flex-start; padding: 12px 14px; font-size: 13px; }
    .prod-gate-block {
      display: none;
      margin-top: 14px;
      padding: 14px 16px;
      background: rgba(220, 38, 38, 0.03);
      border: 1px solid rgba(220, 38, 38, 0.12);
      border-radius: var(--radius-sm);
      animation: slideDown 0.3s ease;
    }
    .prod-gate-block.show { display: block; }
    .prod-gate-block-icon { font-size: 20px; margin-bottom: 6px; }
    .prod-gate-block-title { font-size: 13px; font-weight: var(--fw-bold); color: #dc2626; margin-bottom: 4px; }
    .prod-gate-block-text { font-size: 12px; color: var(--go-text-primary); line-height: 1.6; }
    .prod-gate-block-text strong { color: #dc2626; }
    .prod-gate-divider {
      height: 1px;
      background: rgba(0, 89, 169, 0.08);
      margin: 0 -18px;
      width: calc(100% + 36px);
    }
    .prod-gate-ok {
      display: none;
      margin-top: 12px;
      padding: 10px 12px;
      background: rgba(34, 197, 94, 0.05);
      border: 1px solid rgba(34, 197, 94, 0.12);
      border-radius: var(--radius-sm);
      font-size: 12px;
      color: #16a34a;
      font-weight: var(--fw-semibold);
      animation: slideDown 0.25s ease;
    }
    .prod-gate-ok.show { display: flex; align-items: center; gap: 6px; }

    /* ── SAVING RATIO TIP ── */
    .saving-ratio-tip {
      display: none;
      margin-top: 12px;
      padding: 11px 12px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: var(--fw-semibold);
      animation: slideDown 0.2s ease;
    }
    .saving-ratio-tip.show { display: block; }
    .saving-ratio-tip.error {
      background: rgba(220, 38, 38, 0.03);
      border: 1px solid rgba(220, 38, 38, 0.12);
      color: #dc2626;
    }
    .saving-ratio-tip.warn {
      background: rgba(215, 219, 0, 0.06);
      border: 1px solid rgba(215, 219, 0, 0.2);
      color: #8a7d00;
    }
    .saving-ratio-tip .ratio-msg { margin-bottom: 8px; line-height: 1.5; }
    .saving-ratio-tip .ratio-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      background: rgba(0, 89, 169, 0.05);
      border: 1px solid rgba(0, 89, 169, 0.12);
      border-radius: var(--radius-pill);
      color: var(--go-blue);
      font-size: 10px;
      font-weight: var(--fw-bold);
      cursor: pointer;
      transition: background 0.2s;
    }
    .saving-ratio-tip .ratio-toggle:hover { background: rgba(0, 89, 169, 0.1); }
    .saving-ratio-tip .ratio-table-wrap {
      display: none;
      margin-top: 8px;
      animation: slideDown 0.25s ease;
    }
    .saving-ratio-tip .ratio-table-wrap.show { display: block; }
    .saving-ratio-tip table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .saving-ratio-tip thead th {
      text-align: left;
      padding: 6px 7px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--go-blue);
      border-bottom: 1.5px solid rgba(0, 89, 169, 0.12);
      font-weight: var(--fw-bold);
    }
    .saving-ratio-tip tbody td {
      padding: 6px 7px;
      border-bottom: 1px solid rgba(0, 89, 169, 0.04);
    }
    .saving-ratio-tip tbody tr:last-child td { border-bottom: none; }
    .saving-ratio-tip tbody td:first-child { color: var(--go-text-primary); font-weight: var(--fw-semibold); }
    .saving-ratio-tip tbody td:last-child {
      color: #16a34a;
      font-weight: var(--fw-bold);
      font-family: monospace;
      text-align: right;
    }
    .saving-ratio-tip tbody tr:hover td { background: rgba(0, 89, 169, 0.02); }
    .saving-ratio-tip .ratio-table-hint {
      margin-top: 5px;
      font-size: 9px;
      color: #8b8b9a;
      text-align: center;
    }

    /* ── INFO TOOLTIP ── */
    .label-with-info { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .info-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px; height: 16px;
      border-radius: 50%;
      background: rgba(0, 89, 169, 0.08);
      border: 1px solid rgba(0, 89, 169, 0.2);
      color: var(--go-blue);
      font-size: 9px;
      font-weight: var(--fw-bold);
      cursor: help;
      font-family: serif;
      font-style: italic;
      position: relative;
      user-select: none;
      transition: background 0.2s;
    }
    .info-icon:hover, .info-icon:focus { background: rgba(0, 89, 169, 0.15); outline: none; }
    .info-tooltip {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 50%;
      transform: translateX(-50%);
      width: 280px;
      max-width: 90vw;
      padding: 11px 13px;
      background: var(--go-blue);
      border: none;
      border-radius: var(--radius-sm);
      color: rgba(255, 255, 255, 0.9);
      font-size: 11px;
      font-weight: var(--fw-regular);
      font-family: var(--font-family);
      font-style: normal;
      line-height: 1.5;
      text-align: left;
      box-shadow: 0 8px 24px rgba(0, 89, 169, 0.3);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s, visibility 0.15s;
      z-index: 100;
      pointer-events: none;
    }
    .info-tooltip::after {
      content: "";
      position: absolute;
      top: 100%; left: 50%;
      transform: translateX(-50%);
      border: 5px solid transparent;
      border-top-color: var(--go-blue);
    }
    .info-tooltip strong { color: var(--go-white); display: block; margin-bottom: 2px; }
    .info-tooltip em { color: var(--go-lime); font-style: normal; font-weight: var(--fw-bold); }
    .info-icon:hover .info-tooltip,
    .info-icon:focus .info-tooltip,
    .info-icon.show .info-tooltip { opacity: 1; visibility: visible; }
    .info-tooltip.below { bottom: auto; top: calc(100% + 10px); }
    .info-tooltip.below::after {
      top: auto; bottom: 100%;
      border-top-color: transparent;
      border-bottom-color: var(--go-blue);
    }
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
      <p>Submeta projetos e automações que <strong>já estão em produção</strong> para avaliação da equipe de RPA & IA</p>
    </header>
    <div class="form-card">
      <div class="browser-dots"><span></span><span></span><span></span></div>
      <div class="wizard-progress">
        <div class="wizard-step-indicator active" data-target="1"><div class="step-circle active">1</div><span class="step-label">Envio</span></div>
        <div class="step-connector"><div class="connector-fill"></div></div>
        <div class="wizard-step-indicator" data-target="2"><div class="step-circle">2</div><span class="step-label">Projeto</span></div>
        <div class="step-connector"><div class="connector-fill"></div></div>
        <div class="wizard-step-indicator" data-target="3"><div class="step-circle">3</div><span class="step-label">Impacto</span></div>
        <div class="step-connector"><div class="connector-fill"></div></div>
        <div class="wizard-step-indicator" data-target="4"><div class="step-circle">4</div><span class="step-label">Enviar</span></div>
      </div>
      <form id="triagemForm" enctype="multipart/form-data" novalidate>
        <div class="wizard-steps-container">

          <!-- STEP 1: Quem Envia -->
          <div class="wizard-step active" data-step="1">
            <div class="prod-gate" id="prodGate">
              <label class="prod-gate-label">
                Este projeto já está em produção?
                <span class="info-icon" tabindex="0" role="button" aria-label="O que significa estar em produção?">i
                  <span class="info-tooltip below" style="width:300px">
                    <strong>Somente projetos em produção</strong>
                    O projeto precisa estar <em>ativo e sendo utilizado</em> no dia a dia, com engajamento real de usuários ou processos. Projetos em fase de ideia, desenvolvimento ou que nunca foram utilizados não devem ser submetidos.
                  </span>
                </span>
              </label>
              <div class="radio-group">
                <div class="radio-option">
                  <input type="radio" name="prod_status" id="prod_sim" value="sim">
                  <label class="radio-label" for="prod_sim">🟢 Sim, já está em produção e sendo utilizado</label>
                </div>
                <div class="radio-option">
                  <input type="radio" name="prod_status" id="prod_dev" value="dev">
                  <label class="radio-label" for="prod_dev">🔧 Não, ainda está sendo desenvolvido</label>
                </div>
                <div class="radio-option">
                  <input type="radio" name="prod_status" id="prod_idle" value="idle">
                  <label class="radio-label" for="prod_idle">⏸️ Está pronto, mas ainda não é utilizado</label>
                </div>
              </div>
              <div class="field-error" data-field="prod_status">Selecione o status do projeto</div>
              <div class="prod-gate-block" id="prodGateBlock">
                <div class="prod-gate-block-icon">🚫</div>
                <div class="prod-gate-block-title">Submissão não permitida neste momento</div>
                <div class="prod-gate-block-text" id="prodGateBlockText">
                  Só aceitamos submissões de projetos que <strong>já estejam em produção</strong>, sendo utilizados ativamente com engajamento real. Quando seu projeto estiver rodando e sendo utilizado, volte e submeta!
                </div>
              </div>
              <div class="prod-gate-ok" id="prodGateOk">✅ Ótimo! Prossiga com o preenchimento abaixo.</div>
            </div>
            <div class="section-title"><div class="section-icon">👤</div> Dados do Responsável</div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Nome Completo<span class="required">*</span></label>
                <input type="text" name="nome" class="form-input" placeholder="Seu nome completo" required>
                <div class="field-error" data-field="nome">Este campo é obrigatório</div>
              </div>
              <div class="form-group">
                <label class="form-label">Email<span class="required">*</span></label>
                <input type="email" name="email" class="form-input" placeholder="seu.email@gocase.com.br" required>
                <div class="field-error" data-field="email">Informe um email válido</div>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Área<span class="required">*</span></label>
                <select name="area" id="areaSelect" class="form-select" required>
                  <option value="">Selecione sua área</option>
                  ${areasOptions}
                </select>
                <div class="field-error" data-field="area">Selecione sua área</div>
              </div>
              <div class="form-group">
                <label class="form-label">Ferramenta Utilizada<span class="required">*</span></label>
                <select name="ferramenta" id="ferramentaSelect" class="form-select" required>
                  <option value="">Selecione a ferramenta</option>
                  ${ferramentasOptions}
                </select>
                <div class="field-error" data-field="ferramenta">Selecione a ferramenta</div>
                <div class="conditional-field" id="outraFerramentaContainer">
                  <label class="conditional-label">✏️ Especifique a ferramenta:</label>
                  <input type="text" name="ferramenta_outra" id="outraFerramentaInput" class="form-input" placeholder="Nome da ferramenta...">
                  <div class="field-error" data-field="ferramenta_outra">Especifique a ferramenta utilizada</div>
                </div>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Projeto desenvolvido em equipe?<span class="required">*</span></label>
              <div class="radio-group">
                <div class="radio-option">
                  <input type="radio" name="em_equipe" id="equipe_sim" value="Sim" required>
                  <label class="radio-label" for="equipe_sim">👥 Sim, em equipe</label>
                </div>
                <div class="radio-option">
                  <input type="radio" name="em_equipe" id="equipe_nao" value="Não">
                  <label class="radio-label" for="equipe_nao">👤 Não, individual</label>
                </div>
              </div>
              <div class="field-error" data-field="em_equipe">Selecione uma opção</div>
              <div class="conditional-field" id="participantesContainer">
                <label class="conditional-label">👥 Emails dos participantes:</label>
                <div class="chips-input" id="chipsContainer">
                  <input type="text" id="chipsField" class="chips-field" placeholder="exemplo@gocase.com.br" autocomplete="off">
                </div>
                <div class="chip-invalid-tip" id="chipInvalidTip">Insira um email válido (ex: nome@empresa.com)</div>
                <input type="hidden" name="participantes" id="participantesInput" value="">
                <div class="field-error" data-field="participantes">Informe ao menos um email de participante da equipe</div>
              </div>
            </div>
          </div>

          <!-- STEP 2: O Projeto -->
          <div class="wizard-step" data-step="2">
            <div class="section-title"><div class="section-icon">📋</div> Dados do Projeto</div>
            <div class="form-group">
              <label class="form-label" id="nomeProjetoLabel">
                <span id="nomeProjetoTitulo">Nome do Projeto</span><span class="required">*</span>
                <span class="label-hint" id="nomeProjetoHint">Informe um nome descritivo para o projeto</span>
              </label>
              <input type="text" name="nome_projeto" id="nomeProjetoInput" class="form-input" placeholder="Ex: Automação de Relatórios de Vendas" required>
              <div class="field-error" data-field="nome_projeto">Informe o nome do projeto</div>
              <div class="n8n-name-alert" id="n8nNameAlert">
                <div class="n8n-name-alert-title">⚠️ Atenção: nome deve ser idêntico ao do n8n</div>
                <div class="n8n-name-alert-body">
                  O nome informado aqui precisa ser <strong>copiado exatamente</strong> como aparece no n8n — incluindo maiúsculas, minúsculas, espaços e o prefixo entre colchetes.<br>
                  <ol class="n8n-name-alert-steps">
                    <li>Abra o n8n e localize o fluxo principal do projeto</li>
                    <li>Copie o nome que aparece no topo do editor</li>
                    <li>Cole aqui sem modificar nada</li>
                  </ol>
                </div>
              </div>
              <div class="n8n-name-status" id="n8nNameStatus"></div>
            </div>
            <div class="form-group">
              <label class="form-label">Data de Criação do Projeto<span class="required">*</span><span class="label-hint">Quando o projeto foi desenvolvido</span></label>
              <input type="date" name="data_criacao" id="dataCriacaoInput" class="form-input" required>
              <div class="field-error" data-field="data_criacao">Informe a data de criação do projeto</div>
            </div>
            <div class="form-group">
              <label class="form-label">Descrição do Projeto<span class="required">*</span></label>
              <textarea name="descricao" class="form-textarea" placeholder="Descreva brevemente o que o fluxo faz, qual problema resolve e os principais benefícios..." required></textarea>
              <div class="field-error" data-field="descricao">Descreva o projeto (mínimo 10 caracteres)</div>
            </div>
            <div class="form-group">
              <label class="form-label">Documentação do Projeto<span class="required">*</span></label>
              <div class="doc-no-json-warning">
                <span class="doc-no-json-warning-icon">🚫</span>
                <span><strong>Não envie o JSON do fluxo.</strong> Este campo é para a <strong>documentação escrita</strong> explicando como o projeto funciona. Formatos aceitos: PDF, DOCX, DOC, TXT ou MD.</span>
              </div>
              <div class="file-upload" id="fileUploadArea">
                <input type="file" name="documentacao" accept=".pdf,.docx,.doc,.txt,.md,text/markdown" required>
                <div class="file-upload-icon">📄</div>
                <div class="file-upload-text">
                  <strong>Clique para selecionar</strong> ou arraste o arquivo<br>
                  <small>PDF, DOCX, DOC, TXT, MD — max. 10MB</small>
                </div>
              </div>
              <div class="file-name" id="fileName"></div>
              <div class="field-error" data-field="documentacao">Envie a documentação do projeto</div>
              <div class="doc-helper">
                <div class="doc-helper-header">
                  <span class="doc-helper-icon">🤖</span>
                  <span class="doc-helper-text">Ainda não tem? Use nosso <strong>Agente Construtor de Documentações</strong> para criar automaticamente!</span>
                </div>
                <div class="doc-helper-link-box">
                  <input type="text" class="doc-helper-link-input" id="geminiLinkInput" value="https://gemini.google.com/gem/1xDpt0qEhDq1WAPuXgqbDkhUWad5aRqZR" readonly>
                  <button type="button" class="doc-helper-copy-btn" id="copyGeminiBtn">📋 Copiar</button>
                </div>
                <div class="doc-helper-hint">Cole o link em uma nova aba do navegador</div>
              </div>
            </div>
          </div>

          <!-- STEP 3: Impacto -->
          <div class="wizard-step" data-step="3">
            <div class="section-title"><div class="section-icon">📊</div> Impacto e Mercado</div>
            <div class="form-group">
              <label class="form-label">Existe solução similar paga no mercado?<span class="required">*</span></label>
              <div class="radio-group">
                <div class="radio-option">
                  <input type="radio" name="check_mercado" id="mercado_sim" value="Sim" required>
                  <label class="radio-label" for="mercado_sim">✅ Sim</label>
                </div>
                <div class="radio-option">
                  <input type="radio" name="check_mercado" id="mercado_nao" value="Não">
                  <label class="radio-label" for="mercado_nao">❌ Não</label>
                </div>
              </div>
              <div class="field-error" data-field="check_mercado">Selecione uma opção</div>
            </div>
            <div class="step-divider"></div>
            <div class="form-group" style="margin-bottom:10px">
              <label class="form-label" style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:var(--go-blue);font-weight:700">Saving Mensal Estimado</label>
            </div>
            <div class="saving-grid">
              <div class="saving-card">
                <div class="saving-card-header">
                  <div class="saving-icon hours">⏱️</div>
                  <div><div class="saving-card-title">Horas Economizadas</div><div class="saving-card-subtitle">Por mês</div></div>
                </div>
                <input type="number" name="saving_horas" id="savingHorasInput" class="form-input" placeholder="Ex: 40" min="0.01" step="0.01" required>
                <div class="field-error" data-field="saving_horas">Informe as horas economizadas (maior que 0)</div>
              </div>
              <div class="saving-card">
                <div class="saving-card-header">
                  <div class="saving-icon money">💵</div>
                  <div><div class="saving-card-title">Valor Economizado</div><div class="saving-card-subtitle">Em reais por mês</div></div>
                </div>
                <div class="input-prefix">
                  <span class="prefix">R$</span>
                  <input type="number" name="saving_reais" id="savingReaisInput" class="form-input" placeholder="Ex: 5000.00" min="0.01" step="0.01" required>
                </div>
                <div class="field-error" data-field="saving_reais">Informe o valor economizado (maior que 0)</div>
              </div>
            </div>
            <div class="saving-ratio-tip" id="savingRatioTip">
              <div class="ratio-msg">O valor por hora (R$/h) ficou abaixo de R$ 8,00. Confira se os valores informados estão corretos.</div>
              <span class="ratio-toggle" id="ratioToggle">📊 Ver tabela de custo/hora por cargo</span>
              <div class="ratio-table-wrap" id="ratioTableWrap">
                <table>
                  <thead><tr><th>Cargo</th><th style="text-align:right">R$/hora + encargos</th></tr></thead>
                  <tbody>
                    <tr><td>Estagiário</td><td>R$ 10,78</td></tr>
                    <tr><td>Assistente</td><td>R$ 13,94</td></tr>
                    <tr><td>Analista Júnior</td><td>R$ 21,29</td></tr>
                    <tr><td>Analista Pleno</td><td>R$ 29,90</td></tr>
                    <tr><td>Analista Sênior</td><td>R$ 33,10</td></tr>
                    <tr><td>Coordenador / Especialista</td><td>R$ 55,15</td></tr>
                  </tbody>
                </table>
                <div class="ratio-table-hint">Valores com encargos — use como referência para o cálculo do saving</div>
              </div>
            </div>
            <div class="form-group" style="margin-top:20px">
              <label class="form-label">
                <span class="label-with-info">
                  Esse saving é de qual tipo?<span class="required">*</span>
                  <span class="info-icon" tabindex="0" role="button" aria-label="Mais informações sobre tipo de saving">i
                    <span class="info-tooltip">
                      <strong>Mensal</strong>O saving acontece <em>todo mês</em>, de forma recorrente. Ex: uma automação que economiza 40h/mês enquanto o fluxo estiver rodando.
                      <br><br>
                      <strong>Pontual</strong>O saving acontece <em>uma única vez</em> e não se repete. Ex: uma automação criada para um projeto específico ou mutirão que terminou.
                    </span>
                  </span>
                </span>
              </label>
              <div class="radio-group">
                <div class="radio-option">
                  <input type="radio" name="tipo_saving" id="tipo_saving_mensal" value="Mensal" required>
                  <label class="radio-label" for="tipo_saving_mensal">🔁 Mensal</label>
                </div>
                <div class="radio-option">
                  <input type="radio" name="tipo_saving" id="tipo_saving_pontual" value="Pontual">
                  <label class="radio-label" for="tipo_saving_pontual">📍 Pontual</label>
                </div>
              </div>
              <div class="field-error" data-field="tipo_saving">Selecione o tipo de saving</div>
            </div>
          </div>

          <!-- STEP 4: Memorial + Summary -->
          <div class="wizard-step" data-step="4">
            <div class="section-title"><div class="section-icon">🧮</div> Memorial de Cálculo</div>
            <div class="form-group">
              <label class="form-label">Descreva o memorial de cálculo<span class="required">*</span><span class="label-hint">Detalhe como chegou ao número de horas/valor economizado</span></label>
              <textarea name="memorial_calculo" class="form-textarea large" placeholder="Explique detalhadamente como calculou o saving informado. Inclua: tempo gasto antes da automação, frequência da tarefa, número de pessoas envolvidas, etc." required></textarea>
              <div class="field-error" data-field="memorial_calculo">Descreva o memorial de cálculo (mínimo 20 caracteres)</div>
              <div class="example-box">
                <strong>💡 Exemplo de memorial:</strong>
                <ul>
                  <li>Tarefa executada 4x por dia, 5 dias por semana</li>
                  <li>Tempo médio por execução: 30 minutos</li>
                  <li>Total mensal: 4 × 5 × 4 × 0,5h = 40 horas/mês</li>
                  <li>Custo hora do colaborador: R$ 50,00</li>
                  <li>Saving mensal: 40h x R$ 50 = R$ 2.000,00</li>
                </ul>
              </div>
            </div>
            <div class="summary-card" id="summaryCard">
              <div class="summary-card-title">Resumo da submissão</div>
              <div class="summary-row"><span class="summary-label">Projeto</span><span class="summary-value" id="sumProjeto">—</span></div>
              <div class="summary-row"><span class="summary-label">Ferramenta</span><span class="summary-value" id="sumFerramenta">—</span></div>
              <div class="summary-row"><span class="summary-label">Área</span><span class="summary-value" id="sumArea">—</span></div>
              <div class="summary-row"><span class="summary-label">Horas/mês</span><span class="summary-value" id="sumHoras">—</span></div>
              <div class="summary-row"><span class="summary-label">Valor/mês</span><span class="summary-value" id="sumReais">—</span></div>
              <div class="summary-row"><span class="summary-label">Tipo</span><span class="summary-value" id="sumTipo">—</span></div>
            </div>
          </div>

        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-back" id="btnBack" style="visibility:hidden">← Voltar</button>
          <button type="button" class="btn-next" id="btnNext">Proximo →</button>
          <button type="submit" class="btn-submit" id="submitBtn" style="display:none">
            <span id="btnText">Enviar para Triagem</span>
            <div class="spinner" id="btnSpinner" style="display:none"></div>
          </button>
        </div>
        <div id="errorMessage" class="error-message"></div>
      </form>
    </div>
    <footer class="footer">
      Desenvolvido pela equipe de <a href="#">RPA & IA</a> · GoGroup © 2025
    </footer>
  </div>
  </div>
  <script>
    (function() {
      var form = document.getElementById("triagemForm");
      var errorMessage = document.getElementById("errorMessage");
      var submitBtn = document.getElementById("submitBtn");
      var btnText = document.getElementById("btnText");
      var btnSpinner = document.getElementById("btnSpinner");
      var fileInput = document.querySelector("input[type=file]");
      var fileUploadArea = document.getElementById("fileUploadArea");
      var fileNameDisplay = document.getElementById("fileName");
      var areaSelect = document.getElementById("areaSelect");
      var ferramentaSelect = document.getElementById("ferramentaSelect");
      var outraFerramentaContainer = document.getElementById("outraFerramentaContainer");
      var outraFerramentaInput = document.getElementById("outraFerramentaInput");
      var equipeSimRadio = document.getElementById("equipe_sim");
      var equipeNaoRadio = document.getElementById("equipe_nao");
      var participantesContainer = document.getElementById("participantesContainer");
      var participantesInput = document.getElementById("participantesInput");
      var nomeProjetoTitulo = document.getElementById("nomeProjetoTitulo");
      var nomeProjetoHint = document.getElementById("nomeProjetoHint");
      var nomeProjetoInput = document.getElementById("nomeProjetoInput");
      var savingHorasInput = document.getElementById("savingHorasInput");
      var savingReaisInput = document.getElementById("savingReaisInput");
      var dataCriacaoInput = document.getElementById("dataCriacaoInput");
      var n8nNameAlert = document.getElementById("n8nNameAlert");
      var n8nNameStatus = document.getElementById("n8nNameStatus");
      var chipsContainer = document.getElementById("chipsContainer");
      var chipsField = document.getElementById("chipsField");
      var chips = [];
      var EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;

      /* ── PRODUCTION GATE ── */
      var prodGateBlock = document.getElementById("prodGateBlock");
      var prodGateOk = document.getElementById("prodGateOk");
      var prodGateBlockText = document.getElementById("prodGateBlockText");
      var prodSimRadio = document.getElementById("prod_sim");
      var prodDevRadio = document.getElementById("prod_dev");
      var prodIdleRadio = document.getElementById("prod_idle");

      function handleProdGateChange() {
        var errorEl = document.querySelector('.field-error[data-field="prod_status"]');
        if (errorEl) errorEl.classList.remove("show");
        if (prodSimRadio.checked) {
          prodGateBlock.classList.remove("show");
          prodGateOk.classList.add("show");
        } else if (prodDevRadio.checked) {
          prodGateBlockText.innerHTML = 'Projetos <strong>ainda em desenvolvimento</strong> não podem ser submetidos. Finalize a implementação, coloque em produção com engajamento real e então submeta para avaliação.';
          prodGateBlock.classList.add("show");
          prodGateOk.classList.remove("show");
        } else if (prodIdleRadio.checked) {
          prodGateBlockText.innerHTML = 'Projetos prontos mas <strong>sem utilização ativa</strong> não podem ser submetidos. É necessário que o projeto esteja sendo usado no dia a dia, com engajamento real, antes da submissão.';
          prodGateBlock.classList.add("show");
          prodGateOk.classList.remove("show");
        }
      }
      prodSimRadio.addEventListener("change", handleProdGateChange);
      prodDevRadio.addEventListener("change", handleProdGateChange);
      prodIdleRadio.addEventListener("change", handleProdGateChange);

      /* ── WIZARD ── */
      var currentStep = 1;
      var totalSteps = 4;
      var completedSteps = {};
      var btnBack = document.getElementById("btnBack");
      var btnNext = document.getElementById("btnNext");
      var wizSteps = document.querySelectorAll(".wizard-step");
      var wizIndicators = document.querySelectorAll(".wizard-step-indicator");
      var wizConnectors = document.querySelectorAll(".step-connector");

      function updateSummary() {
        document.getElementById("sumProjeto").textContent = nomeProjetoInput.value || "—";
        var ft = ferramentaSelect.value;
        if (ft === "Outros" && outraFerramentaInput.value.trim()) ft = "Outros: " + outraFerramentaInput.value.trim();
        document.getElementById("sumFerramenta").textContent = ft || "—";
        document.getElementById("sumArea").textContent = areaSelect.value || "—";
        document.getElementById("sumHoras").textContent = savingHorasInput.value ? savingHorasInput.value + "h" : "—";
        document.getElementById("sumReais").textContent = savingReaisInput.value ? "R$ " + savingReaisInput.value : "—";
        var ts = document.querySelector('input[name="tipo_saving"]:checked');
        document.getElementById("sumTipo").textContent = ts ? ts.value : "—";
      }

      function showStep(n, direction) {
        for (var i = 0; i < wizSteps.length; i++) wizSteps[i].classList.remove("active", "back");
        var target = document.querySelector('.wizard-step[data-step="' + n + '"]');
        if (direction === "back") target.classList.add("back");
        target.classList.add("active");

        for (var j = 0; j < wizIndicators.length; j++) {
          var sn = parseInt(wizIndicators[j].getAttribute("data-target"));
          var circle = wizIndicators[j].querySelector(".step-circle");
          circle.classList.remove("active", "completed");
          wizIndicators[j].classList.remove("clickable", "active", "completed");
          if (sn === n) {
            circle.classList.add("active");
            circle.textContent = sn;
            wizIndicators[j].classList.add("active");
          } else if (completedSteps[sn]) {
            circle.classList.add("completed");
            circle.innerHTML = "&#10003;";
            wizIndicators[j].classList.add("clickable", "completed");
          } else {
            circle.textContent = sn;
          }
        }
        for (var k = 0; k < wizConnectors.length; k++) {
          if (k < n - 1) wizConnectors[k].classList.add("filled");
          else wizConnectors[k].classList.remove("filled");
        }

        btnBack.style.visibility = (n === 1) ? "hidden" : "visible";
        if (n === totalSteps) {
          btnNext.style.display = "none";
          submitBtn.style.display = "flex";
          updateSummary();
        } else {
          btnNext.style.display = "block";
          submitBtn.style.display = "none";
        }
        currentStep = n;
        errorMessage.classList.remove("show");
        document.querySelector(".form-card").scrollIntoView({ behavior: "smooth", block: "start" });
      }

      btnNext.addEventListener("click", function() {
        if (validateStep(currentStep)) {
          completedSteps[currentStep] = true;
          showStep(currentStep + 1, "forward");
        } else {
          this.classList.add("shake");
          var self = this;
          setTimeout(function() { self.classList.remove("shake"); }, 350);
          var curEl = document.querySelector('.wizard-step[data-step="' + currentStep + '"]');
          var fe = curEl.querySelector(".form-input.invalid, .form-select.invalid, .form-textarea.invalid, .file-upload.invalid");
          if (fe) { fe.scrollIntoView({ behavior: "smooth", block: "center" }); if (fe.focus) fe.focus(); }
        }
      });

      btnBack.addEventListener("click", function() {
        if (currentStep > 1) showStep(currentStep - 1, "back");
      });

      for (var si = 0; si < wizIndicators.length; si++) {
        wizIndicators[si].addEventListener("click", function() {
          var t = parseInt(this.getAttribute("data-target"));
          if (completedSteps[t] && t !== currentStep) {
            showStep(t, t < currentStep ? "back" : "forward");
          }
        });
      }

      /* ── CHIPS ── */
      function syncParticipantes() {
        participantesInput.value = chips.map(function(c) { return c.value; }).join(", ");
      }
      function renderChips() {
        var existing = chipsContainer.querySelectorAll(".chip");
        for (var i = 0; i < existing.length; i++) existing[i].remove();
        for (var j = 0; j < chips.length; j++) {
          var c = chips[j];
          var chip = document.createElement("span");
          chip.className = "chip" + (c.valid ? "" : " invalid-email");
          chip.setAttribute("data-index", j);
          chip.title = c.valid ? c.value : "Email inválido";
          var text = document.createElement("span");
          text.className = "chip-text";
          text.textContent = c.value;
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "chip-remove";
          btn.setAttribute("aria-label", "Remover " + c.value);
          btn.textContent = "\\u00D7";
          btn.addEventListener("click", function(e) {
            e.stopPropagation();
            var idx = parseInt(this.parentNode.getAttribute("data-index"));
            chips.splice(idx, 1);
            renderChips();
          });
          chip.appendChild(text);
          chip.appendChild(btn);
          chipsContainer.insertBefore(chip, chipsField);
        }
        syncParticipantes();
      }
      var chipInvalidTip = document.getElementById("chipInvalidTip");
      function addChip(value) {
        value = (value || "").trim().replace(/[,;]+$/, "").trim();
        if (!value) return false;
        for (var i = 0; i < chips.length; i++) {
          if (chips[i].value.toLowerCase() === value.toLowerCase()) return false;
        }
        if (!EMAIL_RE.test(value)) {
          chipsContainer.classList.add("invalid");
          if (chipInvalidTip) chipInvalidTip.classList.add("show");
          return false;
        }
        if (chipInvalidTip) chipInvalidTip.classList.remove("show");
        chips.push({ value: value, valid: true });
        renderChips();
        chipsContainer.classList.remove("invalid");
        var errorEl = document.querySelector('.field-error[data-field="participantes"]');
        if (errorEl) errorEl.classList.remove("show");
        return true;
      }
      function clearChips() { chips = []; renderChips(); }
      chipsContainer.addEventListener("click", function(e) { if (e.target === chipsContainer) chipsField.focus(); });
      chipsField.addEventListener("input", function() {
        if (chipInvalidTip) chipInvalidTip.classList.remove("show");
        chipsContainer.classList.remove("invalid");
      });
      chipsField.addEventListener("keydown", function(e) {
        if (e.key === " " || e.key === "Enter" || e.key === "," || e.key === ";" || e.key === "Tab") {
          var v = this.value.trim();
          if (v) { e.preventDefault(); if (addChip(v)) this.value = ""; }
          else if (e.key === "Enter") { e.preventDefault(); }
        } else if (e.key === "Backspace" && this.value === "" && chips.length > 0) {
          chips.pop(); renderChips();
        }
      });
      chipsField.addEventListener("blur", function() { var v = this.value.trim(); if (v) { if (addChip(v)) this.value = ""; } });
      chipsField.addEventListener("paste", function(e) {
        var text = (e.clipboardData || window.clipboardData).getData("text");
        if (text && /[,;\\s]/.test(text)) {
          e.preventDefault();
          var parts = text.split(/[,;\\s]+/);
          for (var i = 0; i < parts.length; i++) { if (parts[i].trim()) addChip(parts[i]); }
          this.value = "";
        }
      });

      /* ── DATE INIT ── */
      var hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Fortaleza" });
      dataCriacaoInput.value = hoje;
      dataCriacaoInput.max = hoje;

      /* ── SAVING RATIO ── */
      var savingRatioTip = document.getElementById("savingRatioTip");
      var ratioMsg = null;
      function checkSavingRatio() {
        if (!ratioMsg) ratioMsg = savingRatioTip.querySelector(".ratio-msg");
        var horas = parseFloat(savingHorasInput.value);
        var reais = parseFloat(savingReaisInput.value);
        if (horas > 0 && reais > 0) {
          var ratio = reais / horas;
          if (ratio <= 8) {
            ratioMsg.textContent = "O valor por hora (R$/h) ficou abaixo de R$ 8,00. Confira se os valores informados estão corretos.";
            savingRatioTip.className = "saving-ratio-tip show error";
            return false;
          }
          if (ratio > 60) {
            ratioMsg.textContent = "O valor por hora (R$/h) ficou acima de R$ 60,00 — confira se os valores estão proporcionais.";
            savingRatioTip.className = "saving-ratio-tip show warn";
            return true;
          }
        }
        savingRatioTip.className = "saving-ratio-tip";
        return true;
      }
      savingHorasInput.addEventListener("input", checkSavingRatio);
      savingReaisInput.addEventListener("input", checkSavingRatio);
      var ratioToggle = document.getElementById("ratioToggle");
      var ratioTableWrap = document.getElementById("ratioTableWrap");
      ratioToggle.addEventListener("click", function() {
        var open = ratioTableWrap.classList.toggle("show");
        this.textContent = open ? "✕ Fechar tabela" : "📊 Ver tabela de custo/hora por cargo";
      });

      /* ── VALIDATION HELPERS ── */
      function validateField(field, minLength) {
        minLength = minLength || 1;
        var value = field.value.trim();
        var isValid = value.length >= minLength;
        var errorEl = document.querySelector('.field-error[data-field="' + field.name + '"]');
        if (!isValid) { field.classList.add("invalid"); if (errorEl) errorEl.classList.add("show"); }
        else { field.classList.remove("invalid"); if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }
      function validateSelect(field) {
        var isValid = field.value !== "";
        var errorEl = document.querySelector('.field-error[data-field="' + field.name + '"]');
        if (!isValid) { field.classList.add("invalid"); if (errorEl) errorEl.classList.add("show"); }
        else { field.classList.remove("invalid"); if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }
      function validateNumber(field) {
        var isValid = field.value !== "" && !isNaN(field.value) && parseFloat(field.value) > 0;
        var errorEl = document.querySelector('.field-error[data-field="' + field.name + '"]');
        if (!isValid) { field.classList.add("invalid"); if (errorEl) errorEl.classList.add("show"); }
        else { field.classList.remove("invalid"); if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }
      function validateEmail(field) {
        var value = field.value.trim();
        var isValid = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value);
        var errorEl = document.querySelector('.field-error[data-field="' + field.name + '"]');
        if (!isValid) { field.classList.add("invalid"); if (errorEl) errorEl.classList.add("show"); }
        else { field.classList.remove("invalid"); if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }
      function validateFile() {
        var isValid = fileInput.files.length > 0;
        var errorEl = document.querySelector('.field-error[data-field="documentacao"]');
        if (!isValid) { fileUploadArea.classList.add("invalid"); if (errorEl) errorEl.classList.add("show"); }
        else { fileUploadArea.classList.remove("invalid"); if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }
      function validateRadio(name) {
        var radios = document.querySelectorAll('input[name="' + name + '"]');
        var isValid = false;
        for (var i = 0; i < radios.length; i++) { if (radios[i].checked) { isValid = true; break; } }
        var errorEl = document.querySelector('.field-error[data-field="' + name + '"]');
        if (!isValid) { if (errorEl) errorEl.classList.add("show"); }
        else { if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }

      function validateParticipantes() {
        var errorElPart = document.querySelector('.field-error[data-field="participantes"]');
        if (chips.length === 0) {
          chipsContainer.classList.add("invalid");
          if (errorElPart) { errorElPart.textContent = "Informe ao menos um email de participante"; errorElPart.classList.add("show"); }
          return false;
        }
        chipsContainer.classList.remove("invalid");
        if (errorElPart) errorElPart.classList.remove("show");
        return true;
      }

      /* ── PER-STEP VALIDATION ── */
      function validateProdGate() {
        if (!prodSimRadio.checked && !prodDevRadio.checked && !prodIdleRadio.checked) {
          var errorEl = document.querySelector('.field-error[data-field="prod_status"]');
          if (errorEl) errorEl.classList.add("show");
          return false;
        }
        if (!prodSimRadio.checked) {
          return false;
        }
        return true;
      }

      function validateStep(n) {
        var valid = true;
        if (n === 1) {
          if (!validateProdGate()) valid = false;
          var nomeField = form.querySelector('[name="nome"]');
          if (!validateField(nomeField, 2)) valid = false;
          else if (/[0-9]/.test(nomeField.value)) { nomeField.classList.add("invalid"); var nErr = document.querySelector('.field-error[data-field="nome"]'); if (nErr) { nErr.textContent = "O nome não pode conter números"; nErr.classList.add("show"); } valid = false; }
          if (!validateEmail(form.querySelector('[name="email"]'))) valid = false;
          if (!validateSelect(areaSelect)) valid = false;
          if (!validateSelect(ferramentaSelect)) valid = false;
          if (ferramentaSelect.value === "Outros") { if (!validateField(outraFerramentaInput, 2)) valid = false; }
          if (!validateRadio("em_equipe")) valid = false;
          if (equipeSimRadio.checked) { if (!validateParticipantes()) valid = false; }
        } else if (n === 2) {
          if (!validateField(form.querySelector('[name="nome_projeto"]'), 3)) valid = false;
          if (!validateField(form.querySelector('[name="data_criacao"]'), 1)) valid = false;
          if (!validateField(form.querySelector('[name="descricao"]'), 10)) valid = false;
          if (!validateFile()) valid = false;
        } else if (n === 3) {
          if (!validateRadio("check_mercado")) valid = false;
          if (!validateNumber(savingHorasInput)) valid = false;
          if (!validateNumber(savingReaisInput)) valid = false;
          if (!checkSavingRatio()) valid = false;
          if (!validateRadio("tipo_saving")) valid = false;
        } else if (n === 4) {
          if (!validateField(form.querySelector('[name="memorial_calculo"]'), 20)) valid = false;
        }
        return valid;
      }

      function validateForm() {
        var isValid = true;
        for (var s = 1; s <= totalSteps; s++) { if (!validateStep(s)) isValid = false; }
        return isValid;
      }

      /* ── REAL-TIME FIELD CLEANUP ── */
      var formFields = document.querySelectorAll(".form-input, .form-textarea");
      for (var i = 0; i < formFields.length; i++) {
        formFields[i].addEventListener("input", function() {
          this.classList.remove("invalid");
          var errorEl = document.querySelector('.field-error[data-field="' + this.name + '"]');
          if (errorEl) errorEl.classList.remove("show");
        });
        formFields[i].addEventListener("blur", function() {
          if (this.type !== "number" && this.type !== "email") this.value = this.value.trim();
        });
      }
      var formSelects = document.querySelectorAll(".form-select");
      for (var i = 0; i < formSelects.length; i++) {
        formSelects[i].addEventListener("change", function() {
          this.classList.remove("invalid");
          var errorEl = document.querySelector('.field-error[data-field="' + this.name + '"]');
          if (errorEl) errorEl.classList.remove("show");
        });
      }

      /* ── N8N NAME LOGIC ── */
      function atualizarStatusNomeN8n(valor) {
        if (!valor || valor.length < 3) { n8nNameStatus.className = "n8n-name-status"; return; }
        if (/^\\[.+\\]/.test(valor)) {
          n8nNameStatus.className = "n8n-name-status show ok";
          n8nNameStatus.innerHTML = "✅ Prefixo detectado — parece um nome de fluxo n8n válido";
        } else {
          n8nNameStatus.className = "n8n-name-status show warn";
          n8nNameStatus.innerHTML = "⚠️ Nenhum prefixo detectado — verifique se copiou o nome correto do n8n";
        }
      }
      function atualizarCampoNomeProjeto(ferramenta) {
        if (ferramenta === "n8n") {
          nomeProjetoTitulo.textContent = "Nome exato do Fluxo Principal do projeto";
          nomeProjetoHint.textContent = "Copie e cole o nome do fluxo principal exatamente como aparece no n8n";
          nomeProjetoInput.placeholder = "Ex: [CX] Envio de NPS Automático";
          n8nNameAlert.classList.add("show");
          atualizarStatusNomeN8n(nomeProjetoInput.value);
        } else {
          nomeProjetoTitulo.textContent = "Nome do Projeto";
          nomeProjetoHint.textContent = "Informe um nome descritivo para o projeto";
          nomeProjetoInput.placeholder = "Ex: Automação de Relatórios de Vendas";
          n8nNameAlert.classList.remove("show");
          n8nNameStatus.className = "n8n-name-status";
        }
      }
      nomeProjetoInput.addEventListener("input", function() {
        if (ferramentaSelect.value === "n8n") atualizarStatusNomeN8n(this.value.trim());
      });

      /* ── CONDITIONAL FIELDS ── */
      ferramentaSelect.addEventListener("change", function() {
        atualizarCampoNomeProjeto(this.value);
        if (this.value === "Outros") {
          outraFerramentaContainer.classList.add("show");
          outraFerramentaInput.required = true;
          outraFerramentaInput.focus();
        } else {
          outraFerramentaContainer.classList.remove("show");
          outraFerramentaInput.required = false;
          outraFerramentaInput.value = "";
          outraFerramentaInput.classList.remove("invalid");
          var errorEl = document.querySelector('.field-error[data-field="ferramenta_outra"]');
          if (errorEl) errorEl.classList.remove("show");
        }
      });
      equipeSimRadio.addEventListener("change", function() {
        if (this.checked) {
          participantesContainer.classList.add("show");
          setTimeout(function() { chipsField.focus(); }, 50);
          var errorEl = document.querySelector('.field-error[data-field="em_equipe"]');
          if (errorEl) errorEl.classList.remove("show");
        }
      });
      equipeNaoRadio.addEventListener("change", function() {
        if (this.checked) {
          participantesContainer.classList.remove("show");
          clearChips(); chipsField.value = "";
          chipsContainer.classList.remove("invalid");
          var errorEl = document.querySelector('.field-error[data-field="participantes"]');
          if (errorEl) errorEl.classList.remove("show");
          var errorElEquipe = document.querySelector('.field-error[data-field="em_equipe"]');
          if (errorElEquipe) errorElEquipe.classList.remove("show");
        }
      });

      /* ── RADIO CLEANUP ── */
      document.getElementById("mercado_sim").addEventListener("change", function() { var e = document.querySelector('.field-error[data-field="check_mercado"]'); if (e) e.classList.remove("show"); });
      document.getElementById("mercado_nao").addEventListener("change", function() { var e = document.querySelector('.field-error[data-field="check_mercado"]'); if (e) e.classList.remove("show"); });
      document.getElementById("tipo_saving_mensal").addEventListener("change", function() { var e = document.querySelector('.field-error[data-field="tipo_saving"]'); if (e) e.classList.remove("show"); });
      document.getElementById("tipo_saving_pontual").addEventListener("change", function() { var e = document.querySelector('.field-error[data-field="tipo_saving"]'); if (e) e.classList.remove("show"); });

      /* ── TOOLTIPS ── */
      var infoIcons = document.querySelectorAll(".info-icon");
      for (var ii = 0; ii < infoIcons.length; ii++) {
        infoIcons[ii].addEventListener("click", function(e) { e.preventDefault(); e.stopPropagation(); this.classList.toggle("show"); });
      }
      document.addEventListener("click", function(e) {
        if (!e.target.closest(".info-icon")) {
          var icons = document.querySelectorAll(".info-icon.show");
          for (var k = 0; k < icons.length; k++) icons[k].classList.remove("show");
        }
      });

      /* ── FILE UPLOAD ── */
      var ALLOWED_EXTS = ["pdf", "docx", "doc", "txt", "md"];
      function handleFileSelection(file) {
        if (!file) return;
        var ext = file.name.split(".").pop().toLowerCase();
        if (ALLOWED_EXTS.indexOf(ext) === -1) {
          fileInput.value = "";
          fileNameDisplay.classList.remove("show");
          fileUploadArea.classList.add("invalid");
          var errorEl = document.querySelector('.field-error[data-field="documentacao"]');
          if (errorEl) { errorEl.textContent = "❌ Formato ." + ext + " não é aceito. Envie a documentação em PDF, DOCX, DOC, TXT ou MD."; errorEl.classList.add("show"); }
          return;
        }
        if (ext === "md") {
          var fixed = new File([file], file.name, { type: "text/markdown" });
          var dt = new DataTransfer();
          dt.items.add(fixed);
          fileInput.files = dt.files;
        }
        fileNameDisplay.textContent = "📎 " + file.name;
        fileNameDisplay.classList.add("show");
        fileUploadArea.classList.remove("invalid");
        var errorEl = document.querySelector('.field-error[data-field="documentacao"]');
        if (errorEl) { errorEl.textContent = "Envie a documentação do projeto"; errorEl.classList.remove("show"); }
      }
      fileInput.addEventListener("change", function() { handleFileSelection(this.files[0] || null); });
      fileUploadArea.addEventListener("dragenter", function(e) { e.preventDefault(); fileUploadArea.classList.add("dragover"); });
      fileUploadArea.addEventListener("dragover", function(e) { e.preventDefault(); fileUploadArea.classList.add("dragover"); });
      fileUploadArea.addEventListener("dragleave", function(e) { e.preventDefault(); fileUploadArea.classList.remove("dragover"); });
      fileUploadArea.addEventListener("drop", function(e) {
        e.preventDefault(); fileUploadArea.classList.remove("dragover");
        var files = e.dataTransfer.files;
        if (files.length > 0) {
          var ext = files[0].name.split(".").pop().toLowerCase();
          if (ext !== "md") { try { fileInput.files = files; } catch(err) {} }
          handleFileSelection(files[0]);
        }
      });

      /* ── FORM SUBMIT ── */
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        if (equipeSimRadio.checked) {
          var pending = chipsField.value.trim();
          if (pending) { addChip(pending); chipsField.value = ""; }
        }
        if (!validateForm()) {
          errorMessage.textContent = "⚠️ Preencha todos os campos corretamente.";
          errorMessage.classList.add("show");
          for (var s = 1; s <= totalSteps; s++) {
            if (!validateStep(s)) {
              if (s !== currentStep) showStep(s, s < currentStep ? "back" : "forward");
              var firstErr = document.querySelector('.wizard-step[data-step="' + s + '"] .form-input.invalid, .wizard-step[data-step="' + s + '"] .form-select.invalid, .wizard-step[data-step="' + s + '"] .form-textarea.invalid, .wizard-step[data-step="' + s + '"] .file-upload.invalid');
              if (firstErr) { firstErr.scrollIntoView({ behavior: "smooth", block: "center" }); if (firstErr.focus) firstErr.focus(); }
              break;
            }
          }
          return;
        }
        errorMessage.classList.remove("show");
        submitBtn.disabled = true;
        btnText.textContent = "Enviando...";
        btnSpinner.style.display = "block";
        var formData = new FormData(form);
        var entries = formData.entries();
        var entry = entries.next();
        while (!entry.done) {
          if (typeof entry.value[1] === "string") formData.set(entry.value[0], entry.value[1].trim());
          entry = entries.next();
        }
        if (ferramentaSelect.value === "Outros" && outraFerramentaInput.value.trim()) {
          formData.set("ferramenta", "Outros: " + outraFerramentaInput.value.trim());
        }
        formData.delete("prod_status");
        fetch("https://n8n-study.gogroupgl.com/webhook/submit_workflows_post", { method: "POST", body: formData })
        .then(function(response) { if (response.ok) return response.text(); else throw new Error("Erro no servidor"); })
        .then(function(html) { document.open(); document.write(html); document.close(); })
        .catch(function(error) {
          console.error("Erro:", error);
          errorMessage.textContent = "❌ Erro ao enviar. Tente novamente.";
          errorMessage.classList.add("show");
          submitBtn.disabled = false;
          btnText.textContent = "Enviar para Triagem";
          btnSpinner.style.display = "none";
        });
      });

      /* ── COPY LINK ── */
      var copyBtn = document.getElementById("copyGeminiBtn");
      var linkInput = document.getElementById("geminiLinkInput");
      copyBtn.addEventListener("click", function() {
        var url = linkInput.value;
        linkInput.select(); linkInput.setSelectionRange(0, 99999);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCopied).catch(fallback);
        } else { fallback(); }
        function fallback() { try { document.execCommand("copy"); showCopied(); } catch(err) { alert("Link: " + url); } }
        function showCopied() {
          copyBtn.innerHTML = "✅ Copiado!"; copyBtn.classList.add("copied");
          setTimeout(function() { copyBtn.innerHTML = "📋 Copiar"; copyBtn.classList.remove("copied"); }, 2000);
        }
      });
      linkInput.addEventListener("click", function() { this.select(); });
    })();
  </scr` + `ipt>
</body>
</html>`;

return [{ json: { html } }];
