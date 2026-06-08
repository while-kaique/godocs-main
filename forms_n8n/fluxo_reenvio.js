const rows = $input.all().map(i => i.json);
const projetos = rows
  .filter(r => r.Projeto && String(r.Projeto).trim())
  .map(r => ({
    projeto: String(r.Projeto || ''),
    area: String(r['Área'] || ''),
    ferramenta: String(r.Ferramenta || ''),
    descricao: String(r['Descrição'] || ''),
    url: String(r.URL || ''),
    saving_horas: String(r['Saving Horas'] || '0'),
    saving_reais: String(r['Saving Reais'] || '0'),
    memorial: String(r['Memorial de Saving'] || ''),
    participantes: String(r.Participantes || ''),
    status: String(r.Status || '')
  }));

const projJSON = JSON.stringify(projetos);

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reenvio de Fluxos | RPA & IA</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{--go-blue:#0059A9;--go-lime:#D7DB00;--go-cream:#FBF4EE;--go-light-blue:#C7E9FD;--go-white:#FFFFFF;--go-text-primary:#333333;--go-text-heading:#0059A9;--font-family:'Poppins',sans-serif;--fw-regular:400;--fw-semibold:600;--fw-bold:700;--fw-extrabold:800;--radius-sm:8px;--radius-md:12px;--radius-lg:16px;--radius-xl:24px;--radius-pill:9999px;--shadow-md:0 4px 16px rgba(0,89,169,0.08);--shadow-lg:0 8px 32px rgba(0,89,169,0.10);--shadow-lime-glow:0 4px 20px rgba(215,219,0,0.3);--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;--space-7:48px}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:var(--font-family);background:var(--go-blue);min-height:100vh;color:var(--go-text-primary);line-height:1.6;padding:10px}
    .page-inner{background:var(--go-cream);min-height:calc(100vh - 20px);border-radius:var(--radius-xl);overflow:hidden}
    .container{position:relative;z-index:1;max-width:680px;margin:0 auto;padding:var(--space-7) var(--space-5) var(--space-6)}
    .header{text-align:center;margin-bottom:var(--space-6)}
    .header h1{font-size:clamp(1.5rem,3.5vw,1.75rem);font-weight:var(--fw-extrabold);margin-bottom:8px;color:var(--go-text-heading);letter-spacing:-0.01em}
    .header p{color:var(--go-text-primary);font-size:14px;max-width:440px;margin:0 auto}
    .logo-container{display:inline-flex;align-items:center;justify-content:center;margin-bottom:var(--space-4)}
    .logo-text{font-size:11px;font-weight:var(--fw-semibold);color:var(--go-blue);letter-spacing:0.15em;text-transform:uppercase;background:var(--go-lime);padding:4px 14px;border-radius:var(--radius-pill)}
    .form-card{background:var(--go-white);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-xl);padding:var(--space-6) var(--space-6) var(--space-5);box-shadow:var(--shadow-lg);position:relative;overflow:hidden}
    .form-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--go-blue) 0%,var(--go-blue) 60%,var(--go-lime) 100%)}
    @media(max-width:640px){.form-card{padding:var(--space-5) var(--space-4) var(--space-4)}}
    .browser-dots{display:flex;gap:7px;margin-bottom:var(--space-5);padding-top:var(--space-3)}
    .browser-dots span{width:10px;height:10px;border-radius:50%;background:var(--go-lime);display:block}
    .browser-dots span:first-child{background:var(--go-blue);opacity:0.25}
    .browser-dots span:nth-child(2){background:var(--go-blue);opacity:0.15}

    /* -- FORM ELEMENTS -- */
    .form-section{margin-bottom:0}
    .section-title{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:var(--fw-bold);color:var(--go-text-heading);margin-bottom:22px;padding-bottom:10px;border-bottom:1.5px solid rgba(0,89,169,0.1);text-transform:uppercase;letter-spacing:0.05em}
    .section-icon{width:28px;height:28px;background:rgba(0,89,169,0.07);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:14px}
    .form-row{display:grid;grid-template-columns:repeat(2,1fr);gap:var(--space-4)}
    @media(max-width:640px){.form-row{grid-template-columns:1fr}}
    .form-group{margin-bottom:18px}
    .form-label{display:block;font-size:13px;font-weight:var(--fw-semibold);color:var(--go-text-primary);margin-bottom:6px}
    .label-hint{display:block;font-size:11px;color:#8b8b9a;font-weight:var(--fw-regular);margin-top:2px}
    .required{color:#dc2626;margin-left:3px}
    .form-input,.form-select,.form-textarea{width:100%;padding:11px 14px;background:var(--go-white);border:1.5px solid rgba(0,89,169,0.18);border-radius:var(--radius-sm);color:var(--go-text-primary);font-size:14px;font-family:var(--font-family);transition:border-color 0.2s,box-shadow 0.2s}
    .form-input:focus,.form-select:focus,.form-textarea:focus{outline:none;border-color:var(--go-blue);box-shadow:0 0 0 3px rgba(0,89,169,0.08)}
    .form-input::placeholder,.form-textarea::placeholder{color:#b0b0b8}
    .form-input.invalid,.form-select.invalid,.form-textarea.invalid{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,0.08)}
    .field-error{color:#dc2626;font-size:11px;margin-top:4px;display:none;font-weight:var(--fw-semibold)}
    .field-error.show{display:block}
    .form-textarea{min-height:100px;resize:vertical}
    .form-textarea.large{min-height:150px}
    .input-prefix{position:relative}
    .input-prefix .prefix{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--go-blue);font-weight:var(--fw-semibold);font-size:14px}
    .input-prefix .form-input{padding-left:40px}

    /* -- SEARCHABLE DROPDOWN -- */
    .search-select{position:relative;width:100%}
    .search-select-trigger{width:100%;padding:11px 36px 11px 14px;background:var(--go-white);border:1.5px solid rgba(0,89,169,0.18);border-radius:var(--radius-sm);color:var(--go-text-primary);font-size:14px;font-family:var(--font-family);cursor:pointer;transition:border-color 0.2s,box-shadow 0.2s;display:flex;align-items:center;min-height:42px;position:relative}
    .search-select-trigger::after{content:'';position:absolute;right:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%230059A9' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");background-size:contain;background-repeat:no-repeat;transition:transform 0.2s ease}
    .search-select.open .search-select-trigger::after{transform:translateY(-50%) rotate(180deg)}
    .search-select-trigger:hover{border-color:rgba(0,89,169,0.4)}
    .search-select.open .search-select-trigger{border-color:var(--go-blue);box-shadow:0 0 0 3px rgba(0,89,169,0.08);border-bottom-left-radius:0;border-bottom-right-radius:0}
    .search-select-trigger.invalid{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,0.08)}
    .search-select-placeholder{color:#b0b0b8}
    .search-select-value{color:var(--go-text-primary);font-weight:var(--fw-semibold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:20px}
    .search-select-dropdown{position:absolute;top:100%;left:0;right:0;background:var(--go-white);border:1.5px solid var(--go-blue);border-top:1px solid rgba(0,89,169,0.1);border-bottom-left-radius:var(--radius-sm);border-bottom-right-radius:var(--radius-sm);z-index:1000;display:none;box-shadow:0 8px 24px rgba(0,89,169,0.12);max-height:300px;overflow:hidden;flex-direction:column}
    .search-select.open .search-select-dropdown{display:flex}
    .search-select-search{padding:10px 12px;border-bottom:1px solid rgba(0,89,169,0.08);flex-shrink:0}
    .search-select-search input{width:100%;padding:8px 12px 8px 32px;background:var(--go-cream);border:1.5px solid rgba(0,89,169,0.12);border-radius:6px;color:var(--go-text-primary);font-size:13px;font-family:var(--font-family);outline:none;transition:border-color 0.2s;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230059A9' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E");background-repeat:no-repeat;background-position:10px center}
    .search-select-search input::placeholder{color:#b0b0b8}
    .search-select-search input:focus{border-color:var(--go-blue)}
    .search-select-options{overflow-y:auto;max-height:220px;padding:4px 0}
    .search-select-options::-webkit-scrollbar{width:5px}
    .search-select-options::-webkit-scrollbar-track{background:transparent}
    .search-select-options::-webkit-scrollbar-thumb{background:rgba(0,89,169,0.15);border-radius:3px}
    .search-select-option{padding:9px 13px;color:var(--go-text-primary);font-size:13px;cursor:pointer;transition:all 0.15s ease;display:flex;align-items:center;gap:8px}
    .search-select-option:hover,.search-select-option.highlighted{background:rgba(0,89,169,0.05);color:var(--go-blue)}
    .search-select-option.selected{background:rgba(0,89,169,0.08);color:var(--go-blue);font-weight:var(--fw-semibold)}
    .search-select-option .opt-icon{font-size:14px;flex-shrink:0}
    .search-select-option .opt-text{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .search-select-option mark{background:rgba(215,219,0,0.35);color:var(--go-blue);border-radius:2px;padding:0 1px}
    .search-select-empty{padding:16px 13px;text-align:center;color:#8b8b9a;font-size:13px}
    .search-select-count{padding:6px 13px;border-top:1px solid rgba(0,89,169,0.08);font-size:11px;color:#8b8b9a;text-align:center;flex-shrink:0}

    /* -- INFO BOX -- */
    .info-box{background:var(--go-light-blue);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-md);padding:18px;margin-top:14px}
    .info-row{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(0,89,169,0.06);font-size:13px;gap:12px}
    .info-row:last-child{border-bottom:none}
    .info-label{color:var(--go-text-primary);flex-shrink:0}
    .info-value{color:var(--go-blue);font-weight:var(--fw-semibold);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* -- EDITABLE FIELDS -- */
    .editable-block{margin-bottom:18px;border:1.5px solid rgba(0,89,169,0.1);border-radius:var(--radius-md);overflow:hidden;transition:border-color 0.3s,box-shadow 0.3s}
    .editable-block.active{border-color:rgba(0,89,169,0.25);box-shadow:0 0 0 3px rgba(0,89,169,0.05)}
    .editable-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(199,233,253,0.2);cursor:pointer;transition:background 0.2s;user-select:none}
    .editable-header:hover{background:rgba(199,233,253,0.4)}
    .editable-header-left{display:flex;align-items:center;gap:8px}
    .editable-header-icon{font-size:14px}
    .editable-header-title{font-size:12px;font-weight:var(--fw-bold);color:var(--go-text-heading);text-transform:uppercase;letter-spacing:0.04em}
    .editable-header-preview{font-size:12px;color:#8b8b9a;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:8px;font-weight:var(--fw-regular)}
    .editable-header-action{font-size:10px;color:var(--go-blue);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:4px;padding:4px 10px;border:1px solid rgba(0,89,169,0.15);border-radius:var(--radius-pill);transition:all 0.2s}
    .editable-header:hover .editable-header-action{background:rgba(0,89,169,0.06);border-color:rgba(0,89,169,0.3)}
    .editable-block.active .editable-header-action{background:rgba(0,89,169,0.08);border-color:rgba(0,89,169,0.3);color:var(--go-blue)}
    .editable-body{display:none;padding:16px;animation:slideDown 0.25s ease}
    .editable-block.active .editable-body{display:block}
    @keyframes slideDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}

    /* -- EDIT HINT BANNER -- */
    .edit-hint{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(199,233,253,0.3);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-sm);margin-bottom:20px;font-size:12px;color:var(--go-blue);font-weight:var(--fw-semibold)}
    .edit-hint-icon{font-size:16px;flex-shrink:0}

    /* -- FILE UPLOAD -- */
    .file-upload{position:relative;border:2px dashed rgba(0,89,169,0.25);border-radius:var(--radius-md);padding:var(--space-5);text-align:center;cursor:pointer;transition:border-color 0.2s,background 0.2s;background:rgba(199,233,253,0.15)}
    .file-upload:hover{border-color:var(--go-blue);background:rgba(199,233,253,0.3)}
    .file-upload.dragover{border-color:var(--go-blue);background:rgba(199,233,253,0.4)}
    .file-upload.invalid{border-color:#dc2626}
    .file-upload input{position:absolute;inset:0;opacity:0;cursor:pointer;z-index:2}
    .file-upload-icon{font-size:28px;margin-bottom:8px;opacity:0.6}
    .file-upload-text{color:var(--go-text-primary);font-size:12px}
    .file-upload-text strong{color:var(--go-blue)}
    .file-name{margin-top:8px;padding:7px 12px;background:rgba(0,89,169,0.04);border-radius:var(--radius-sm);color:var(--go-blue);font-size:12px;font-weight:var(--fw-semibold);display:none}
    .file-name.show{display:block}

    /* -- SAVING CARDS -- */
    .saving-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
    @media(max-width:640px){.saving-grid{grid-template-columns:1fr}}
    .saving-card{background:rgba(199,233,253,0.25);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-md);padding:var(--space-4)}
    .saving-card-header{display:flex;align-items:center;gap:9px;margin-bottom:10px}
    .saving-icon{width:34px;height:34px;border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;font-size:17px}
    .saving-icon.hours{background:rgba(0,89,169,0.07)}
    .saving-icon.money{background:rgba(215,219,0,0.15)}
    .saving-card-title{font-size:12px;font-weight:var(--fw-bold);color:var(--go-text-heading)}
    .saving-card-subtitle{font-size:10px;color:#8b8b9a}

    /* -- SAVING RATIO TIP -- */
    .saving-ratio-tip{display:none;margin-top:12px;padding:11px 12px;border-radius:var(--radius-sm);font-size:11px;font-weight:var(--fw-semibold);animation:slideDown 0.2s ease}
    .saving-ratio-tip.show{display:block}
    .saving-ratio-tip.error{background:rgba(220,38,38,0.03);border:1px solid rgba(220,38,38,0.12);color:#dc2626}
    .saving-ratio-tip.warn{background:rgba(215,219,0,0.06);border:1px solid rgba(215,219,0,0.2);color:#8a7d00}
    .saving-ratio-tip .ratio-msg{margin-bottom:8px;line-height:1.5}
    .saving-ratio-tip .ratio-toggle{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:rgba(0,89,169,0.05);border:1px solid rgba(0,89,169,0.12);border-radius:var(--radius-pill);color:var(--go-blue);font-size:10px;font-weight:var(--fw-bold);cursor:pointer;transition:background 0.2s}
    .saving-ratio-tip .ratio-toggle:hover{background:rgba(0,89,169,0.1)}
    .saving-ratio-tip .ratio-table-wrap{display:none;margin-top:8px;animation:slideDown 0.25s ease}
    .saving-ratio-tip .ratio-table-wrap.show{display:block}
    .saving-ratio-tip table{width:100%;border-collapse:collapse;font-size:11px}
    .saving-ratio-tip thead th{text-align:left;padding:6px 7px;font-size:9px;text-transform:uppercase;letter-spacing:0.05em;color:var(--go-blue);border-bottom:1.5px solid rgba(0,89,169,0.12);font-weight:var(--fw-bold)}
    .saving-ratio-tip tbody td{padding:6px 7px;border-bottom:1px solid rgba(0,89,169,0.04)}
    .saving-ratio-tip tbody tr:last-child td{border-bottom:none}
    .saving-ratio-tip tbody td:first-child{color:var(--go-text-primary);font-weight:var(--fw-semibold)}
    .saving-ratio-tip tbody td:last-child{color:#16a34a;font-weight:var(--fw-bold);font-family:monospace;text-align:right}
    .saving-ratio-tip tbody tr:hover td{background:rgba(0,89,169,0.02)}
    .saving-ratio-tip .ratio-table-hint{margin-top:5px;font-size:9px;color:#8b8b9a;text-align:center}

    /* -- CHIPS -- */
    .chips-input{width:100%;min-height:42px;padding:5px 7px;background:var(--go-white);border:1.5px solid rgba(0,89,169,0.18);border-radius:var(--radius-sm);display:flex;flex-wrap:wrap;gap:4px;align-items:center;cursor:text;transition:border-color 0.2s,box-shadow 0.2s}
    .chips-input:focus-within{border-color:var(--go-blue);box-shadow:0 0 0 3px rgba(0,89,169,0.08)}
    .chips-input.invalid{border-color:#dc2626;box-shadow:0 0 0 3px rgba(220,38,38,0.08)}
    .chip{display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 9px;background:rgba(0,89,169,0.06);border:1px solid rgba(0,89,169,0.18);border-radius:var(--radius-pill);color:var(--go-blue);font-size:11px;font-weight:var(--fw-semibold);max-width:100%;animation:chipIn 0.15s ease}
    .chip.invalid-email{background:rgba(220,38,38,0.05);border-color:rgba(220,38,38,0.2);color:#dc2626}
    .chip.original{background:rgba(0,89,169,0.08);border-color:rgba(0,89,169,0.25)}
    .chip-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px}
    .chip-remove{width:15px;height:15px;border-radius:50%;background:rgba(0,89,169,0.1);border:none;color:inherit;font-size:12px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;flex-shrink:0;transition:background 0.15s}
    .chip-remove:hover{background:rgba(0,89,169,0.2)}
    .chip.invalid-email .chip-remove{background:rgba(220,38,38,0.12)}
    .chip.invalid-email .chip-remove:hover{background:rgba(220,38,38,0.25)}
    .chips-field{flex:1;min-width:160px;border:none;outline:none;background:transparent;color:var(--go-text-primary);font-size:14px;font-family:var(--font-family);padding:4px 3px}
    .chips-field::placeholder{color:#b0b0b8}
    @keyframes chipIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}
    .chip-invalid-tip{display:none;margin-top:4px;padding:4px 9px;background:rgba(220,38,38,0.03);border:1px solid rgba(220,38,38,0.12);border-radius:var(--radius-sm);color:#dc2626;font-size:11px;font-weight:var(--fw-semibold);animation:slideDown 0.2s ease}
    .chip-invalid-tip.show{display:block}

    /* -- CHIP REMOVE WARNING -- */
    .chip-remove-warning{display:none;margin-top:6px;padding:8px 11px;background:rgba(215,219,0,0.06);border:1px solid rgba(215,219,0,0.2);border-radius:var(--radius-sm);font-size:11px;color:#8a7d00;line-height:1.5;animation:slideDown 0.2s ease}
    .chip-remove-warning.show{display:flex;align-items:flex-start;gap:6px}
    .chip-remove-warning-icon{font-size:13px;flex-shrink:0;margin-top:1px}
    .chip-remove-warning-btns{display:flex;gap:6px;margin-top:6px}
    .chip-remove-warning-btn{padding:3px 10px;border-radius:var(--radius-pill);font-size:10px;font-weight:var(--fw-bold);cursor:pointer;border:1px solid;transition:background 0.2s;font-family:var(--font-family)}
    .chip-remove-warning-btn.confirm{background:rgba(220,38,38,0.06);border-color:rgba(220,38,38,0.2);color:#dc2626}
    .chip-remove-warning-btn.confirm:hover{background:rgba(220,38,38,0.12)}
    .chip-remove-warning-btn.cancel{background:rgba(0,89,169,0.06);border-color:rgba(0,89,169,0.2);color:var(--go-blue)}
    .chip-remove-warning-btn.cancel:hover{background:rgba(0,89,169,0.12)}

    /* -- BUTTONS -- */
    .btn-submit{width:100%;padding:13px 28px;background:var(--go-lime);border:none;border-radius:var(--radius-pill);color:var(--go-blue);font-size:15px;font-weight:var(--fw-bold);font-family:var(--font-family);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;display:flex;align-items:center;justify-content:center;gap:8px;margin-top:var(--space-5)}
    .btn-submit:hover:not(:disabled){transform:translateY(-2px);box-shadow:var(--shadow-lime-glow)}
    .btn-submit:disabled{opacity:0.5;cursor:not-allowed}
    .spinner{width:18px;height:18px;border:2.5px solid rgba(0,89,169,0.2);border-top-color:var(--go-blue);border-radius:50%;animation:spin 0.8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .error-message{background:rgba(220,38,38,0.04);border:1px solid rgba(220,38,38,0.15);border-radius:var(--radius-sm);padding:12px;margin-top:14px;color:#dc2626;font-size:12px;font-weight:var(--fw-semibold);display:none}
    .error-message.show{display:block}
    .footer{text-align:center;margin-top:var(--space-5);color:var(--go-text-primary);font-size:11px;opacity:0.7}
    .footer a{color:var(--go-blue);text-decoration:none;font-weight:var(--fw-semibold)}
    .footer a:hover{text-decoration:underline}

    .step-divider{height:1.5px;background:rgba(0,89,169,0.08);margin:22px 0}

    /* -- EXAMPLE BOX -- */
    .example-box{background:rgba(0,89,169,0.03);border:1px solid rgba(0,89,169,0.08);border-radius:var(--radius-sm);padding:12px;margin-top:8px;font-size:11px;color:var(--go-text-primary)}
    .example-box strong{color:var(--go-blue);display:block;margin-bottom:5px}
    .example-box ul{margin:0;padding-left:16px}
    .example-box li{margin-bottom:2px}

    /* -- DOC HELPER -- */
    .doc-helper{margin-top:10px;padding:10px 12px;background:rgba(215,219,0,0.05);border:1px solid rgba(215,219,0,0.2);border-radius:var(--radius-sm)}
    .doc-helper-header{display:flex;align-items:flex-start;gap:7px;margin-bottom:8px}
    .doc-helper-icon{font-size:14px;flex-shrink:0}
    .doc-helper-text{font-size:11px;color:var(--go-text-primary);line-height:1.5}
    .doc-helper-text strong{color:var(--go-blue)}
    .doc-helper-link-box{display:flex;align-items:center;gap:6px;background:rgba(0,89,169,0.03);border:1px solid rgba(0,89,169,0.1);border-radius:var(--radius-sm);padding:7px 9px}
    .doc-helper-link-input{flex:1;background:transparent;border:none;color:var(--go-blue);font-size:10px;font-family:monospace;outline:none;min-width:0}
    .doc-helper-copy-btn{display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--go-lime);border:none;border-radius:var(--radius-pill);color:var(--go-blue);font-size:10px;font-weight:var(--fw-semibold);font-family:var(--font-family);cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;white-space:nowrap}
    .doc-helper-copy-btn:hover{transform:translateY(-1px);box-shadow:var(--shadow-lime-glow)}
    .doc-helper-copy-btn.copied{background:rgba(34,197,94,0.12);color:#16a34a}
    .doc-helper-hint{margin-top:5px;font-size:10px;color:#8b8b9a;text-align:center}

    /* -- DOC WARNING -- */
    .doc-no-json-warning{display:flex;align-items:flex-start;gap:7px;margin-bottom:8px;padding:9px 11px;background:rgba(220,38,38,0.03);border:1px solid rgba(220,38,38,0.12);border-radius:var(--radius-sm);font-size:11px;color:#dc2626;line-height:1.5}
    .doc-no-json-warning strong{color:#b91c1c}
    .doc-no-json-warning-icon{font-size:14px;flex-shrink:0;margin-top:1px}
  </style>
</head>
<body>
  <div class="background-decoration">
    <div class="bg-circle bg-circle-1"></div>
    <div class="bg-circle bg-circle-2"></div>
    <div class="bg-circle bg-circle-3"></div>
  </div>
  <div class="container">
    <header class="header">
      <div class="logo-container">
        <div class="logo-icon">🔄</div>
        <span class="logo-text">RPA & IA</span>
      </div>
      <h1>Reenvio de Fluxos</h1>
      <p>Reenvie um projeto ja cadastrado com dados atualizados</p>
    </header>
    <div class="form-card">
      <form id="reenvioForm" enctype="multipart/form-data" novalidate>

        <!-- DADOS DO RESPONSAVEL -->
        <div class="form-section" style="margin-bottom:22px">
          <div class="section-title"><div class="section-icon">👤</div> Dados do Responsavel</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Nome Completo<span class="required">*</span></label>
              <input type="text" name="nome" class="form-input" placeholder="Seu nome completo" required>
              <div class="field-error" data-field="nome">Este campo e obrigatorio</div>
            </div>
            <div class="form-group">
              <label class="form-label">Email<span class="required">*</span></label>
              <input type="email" name="email" class="form-input" placeholder="seu.email@gocase.com.br" required>
              <div class="field-error" data-field="email">Informe um email valido</div>
            </div>
          </div>
        </div>

        <!-- SELECAO DO PROJETO -->
        <div class="form-section" style="margin-bottom:22px">
          <div class="section-title"><div class="section-icon">📂</div> Selecao do Projeto</div>
          <div class="form-group">
            <label class="form-label">Selecione o projeto que deseja reenviar<span class="required">*</span></label>
            <input type="hidden" name="projeto" id="projetoHidden" value="">
            <div class="search-select" id="projetoSearchSelect">
              <div class="search-select-trigger" id="projetoTrigger">
                <span class="search-select-placeholder">Selecione um projeto</span>
              </div>
              <div class="search-select-dropdown">
                <div class="search-select-search">
                  <input type="text" id="projetoSearchInput" placeholder="Pesquisar projeto..." autocomplete="off">
                </div>
                <div class="search-select-options" id="projetoOptions"></div>
                <div class="search-select-count" id="projetoCount"></div>
              </div>
            </div>
            <div class="field-error" data-field="projeto">Selecione um projeto</div>
          </div>
          <div id="projectInfo" style="display:none">
            <div class="info-box">
              <div class="info-row"><span class="info-label">Area</span><span class="info-value" id="infoArea">-</span></div>
              <div class="info-row"><span class="info-label">Ferramenta</span><span class="info-value" id="infoFerramenta">-</span></div>
              <div class="info-row"><span class="info-label">Status Atual</span><span class="info-value" id="infoStatus" style="color:#a5b4fc">-</span></div>
            </div>
          </div>
        </div>

        <!-- CAMPOS EDITAVEIS -->
        <div id="editableSection" style="display:none">
          <div class="edit-hint">
            <span class="edit-hint-icon">✏️</span>
            <span>Clique em qualquer campo abaixo para edita-lo. Apenas os campos que voce abrir serao atualizados.</span>
          </div>

          <!-- DESCRICAO -->
          <div class="editable-block" data-block="descricao">
            <div class="editable-header">
              <div class="editable-header-left">
                <span class="editable-header-icon">📋</span>
                <span class="editable-header-title">Descricao</span>
                <span class="editable-header-preview" id="previewDescricao"></span>
              </div>
              <span class="editable-header-action">✏️ Editar</span>
            </div>
            <div class="editable-body">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Descricao do Projeto<span class="required">*</span></label>
                <textarea name="descricao" class="form-textarea" placeholder="Atualize a descricao do projeto..." required></textarea>
                <div class="field-error" data-field="descricao">Descreva o projeto (minimo 10 caracteres)</div>
              </div>
            </div>
          </div>

          <!-- DOCUMENTACAO -->
          <div class="editable-block" data-block="documentacao">
            <div class="editable-header">
              <div class="editable-header-left">
                <span class="editable-header-icon">📄</span>
                <span class="editable-header-title">Documentacao</span>
                <span class="editable-header-preview">Opcional — clique para enviar nova</span>
              </div>
              <span class="editable-header-action">✏️ Editar</span>
            </div>
            <div class="editable-body">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Nova Documentacao<span class="label-hint">Opcional — se nao enviar, a documentacao atual sera mantida</span></label>
                <div class="doc-no-json-warning">
                  <span class="doc-no-json-warning-icon">🚫</span>
                  <span><strong>Nao envie o JSON do fluxo.</strong> Este campo e para a <strong>documentacao escrita</strong>. Formatos aceitos: PDF, DOCX, DOC, TXT ou MD.</span>
                </div>
                <div class="file-upload" id="fileUploadArea">
                  <input type="file" name="documentacao" accept=".pdf,.docx,.doc,.txt,.md,text/markdown">
                  <div class="file-upload-icon">📄</div>
                  <div class="file-upload-text">
                    <strong>Clique para selecionar</strong> ou arraste o arquivo<br>
                    <small>PDF, DOCX, DOC, TXT, MD — max. 10MB</small>
                  </div>
                </div>
                <div class="file-name" id="fileName"></div>
                <div class="field-error" data-field="documentacao">Formato de arquivo invalido</div>
                <div class="doc-helper">
                  <div class="doc-helper-header">
                    <span class="doc-helper-icon">🤖</span>
                    <span class="doc-helper-text">Ainda nao tem? Use nosso <strong>Agente Construtor de Documentacoes</strong> para criar automaticamente!</span>
                  </div>
                  <div class="doc-helper-link-box">
                    <input type="text" class="doc-helper-link-input" id="geminiLinkInput" value="https://gemini.google.com/gem/1xDpt0qEhDq1WAPuXgqbDkhUWad5aRqZR" readonly>
                    <button type="button" class="doc-helper-copy-btn" id="copyGeminiBtn">📋 Copiar</button>
                  </div>
                  <div class="doc-helper-hint">Cole o link em uma nova aba do navegador</div>
                </div>
              </div>
            </div>
          </div>

          <!-- SAVING -->
          <div class="editable-block" data-block="saving">
            <div class="editable-header">
              <div class="editable-header-left">
                <span class="editable-header-icon">📊</span>
                <span class="editable-header-title">Saving</span>
                <span class="editable-header-preview" id="previewSaving"></span>
              </div>
              <span class="editable-header-action">✏️ Editar</span>
            </div>
            <div class="editable-body">
              <div class="saving-grid">
                <div class="saving-card">
                  <div class="saving-card-header">
                    <div class="saving-icon hours">⏱️</div>
                    <div><div class="saving-card-title">Horas Economizadas</div><div class="saving-card-subtitle">Por mes</div></div>
                  </div>
                  <input type="number" name="saving_horas" id="savingHorasInput" class="form-input" placeholder="Ex: 40" min="0.01" step="0.01" required>
                  <div class="field-error" data-field="saving_horas">Informe as horas economizadas (maior que 0)</div>
                </div>
                <div class="saving-card">
                  <div class="saving-card-header">
                    <div class="saving-icon money">💵</div>
                    <div><div class="saving-card-title">Valor Economizado</div><div class="saving-card-subtitle">Em reais por mes</div></div>
                  </div>
                  <div class="input-prefix">
                    <span class="prefix">R$</span>
                    <input type="number" name="saving_reais" id="savingReaisInput" class="form-input" placeholder="Ex: 5000.00" min="0.01" step="0.01" required>
                  </div>
                  <div class="field-error" data-field="saving_reais">Informe o valor economizado (maior que 0)</div>
                </div>
              </div>
              <div class="saving-ratio-tip" id="savingRatioTip">
                <div class="ratio-msg">O valor por hora (R$/h) ficou abaixo de R$ 8,00. Confira se os valores informados estao corretos.</div>
                <span class="ratio-toggle" id="ratioToggle">📊 Ver tabela de custo/hora por cargo</span>
                <div class="ratio-table-wrap" id="ratioTableWrap">
                  <table>
                    <thead><tr><th>Cargo</th><th style="text-align:right">R$/hora + encargos</th></tr></thead>
                    <tbody>
                      <tr><td>Estagiario</td><td>R$ 10,78</td></tr>
                      <tr><td>Assistente</td><td>R$ 13,94</td></tr>
                      <tr><td>Analista Junior</td><td>R$ 21,29</td></tr>
                      <tr><td>Analista Pleno</td><td>R$ 29,90</td></tr>
                      <tr><td>Analista Senior</td><td>R$ 33,10</td></tr>
                      <tr><td>Coordenador / Especialista</td><td>R$ 55,15</td></tr>
                    </tbody>
                  </table>
                  <div class="ratio-table-hint">Valores com encargos — use como referencia para o calculo do saving</div>
                </div>
              </div>
            </div>
          </div>

          <!-- MEMORIAL -->
          <div class="editable-block" data-block="memorial">
            <div class="editable-header">
              <div class="editable-header-left">
                <span class="editable-header-icon">🧮</span>
                <span class="editable-header-title">Memorial de Calculo</span>
                <span class="editable-header-preview" id="previewMemorial"></span>
              </div>
              <span class="editable-header-action">✏️ Editar</span>
            </div>
            <div class="editable-body">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Descreva o memorial de calculo<span class="required">*</span><span class="label-hint">Detalhe como chegou ao numero de horas/valor economizado</span></label>
                <textarea name="memorial_calculo" class="form-textarea large" placeholder="Explique detalhadamente como calculou o saving informado..." required></textarea>
                <div class="field-error" data-field="memorial_calculo">Descreva o memorial de calculo (minimo 20 caracteres)</div>
                <div class="example-box">
                  <strong>💡 Exemplo de memorial:</strong>
                  <ul>
                    <li>Tarefa executada 4x por dia, 5 dias por semana</li>
                    <li>Tempo medio por execucao: 30 minutos</li>
                    <li>Total mensal: 4 x 5 x 4 x 0,5h = 40 horas/mes</li>
                    <li>Custo hora do colaborador: R$ 50,00</li>
                    <li>Saving mensal: 40h x R$ 50 = R$ 2.000,00</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <!-- PARTICIPANTES -->
          <div class="editable-block" data-block="participantes">
            <div class="editable-header">
              <div class="editable-header-left">
                <span class="editable-header-icon">👥</span>
                <span class="editable-header-title">Participantes</span>
                <span class="editable-header-preview" id="previewParticipantes">Nenhum</span>
              </div>
              <span class="editable-header-action">✏️ Editar</span>
            </div>
            <div class="editable-body">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">Participantes do projeto<span class="label-hint">Opcional — adicione ou remova participantes</span></label>
                <div class="chips-input" id="chipsContainer">
                  <input type="text" id="chipsField" class="chips-field" placeholder="exemplo@gocase.com.br" autocomplete="off">
                </div>
                <div class="chip-invalid-tip" id="chipInvalidTip">Insira um email valido (ex: nome@empresa.com)</div>
                <input type="hidden" name="participantes" id="participantesInput" value="">
                <div class="chip-remove-warning" id="chipRemoveWarning">
                  <span class="chip-remove-warning-icon">⚠️</span>
                  <div>
                    <div id="chipRemoveWarningText">Voce esta removendo um participante original do projeto.</div>
                    <div class="chip-remove-warning-btns">
                      <span class="chip-remove-warning-btn confirm" id="chipRemoveConfirm">Remover mesmo assim</span>
                      <span class="chip-remove-warning-btn cancel" id="chipRemoveCancel">Cancelar</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="step-divider"></div>

          <!-- MOTIVO DO REENVIO (sempre visivel, nao e editable-block) -->
          <div class="form-section" style="margin-bottom:0;margin-top:18px">
            <div class="section-title"><div class="section-icon">📝</div> Motivo do Reenvio</div>
            <div class="form-group">
              <label class="form-label">Por que esta reenviando este projeto?<span class="required">*</span></label>
              <textarea name="motivo_reenvio" class="form-textarea" placeholder="Ex: Documentacao atualizada com novos detalhes, calculo de saving corrigido..." required></textarea>
              <div class="field-error" data-field="motivo_reenvio">Informe o motivo do reenvio (minimo 8 caracteres)</div>
            </div>
          </div>
        </div>

        <input type="hidden" name="documentacao_url_atual" id="docUrlAtual" value="">
        <input type="hidden" name="campos_editados" id="camposEditados" value="">
        <div id="errorMessage" class="error-message"></div>
        <button type="submit" class="btn-submit" id="submitBtn" disabled>
          <span id="btnText">🔄 Reenviar para Triagem</span>
          <div class="spinner" id="btnSpinner" style="display:none"></div>
        </button>
      </form>
    </div>
    <footer class="footer">
      Desenvolvido pela equipe de <a href="#">RPA & IA</a> · Gocase © 2025
    </footer>
  </div>
  <script>
    (function() {
      var projetos = ` + projJSON + `;
      var projetoHidden = document.getElementById("projetoHidden");
      var searchSelect = document.getElementById("projetoSearchSelect");
      var trigger = document.getElementById("projetoTrigger");
      var searchInput = document.getElementById("projetoSearchInput");
      var optionsContainer = document.getElementById("projetoOptions");
      var countDisplay = document.getElementById("projetoCount");
      var projectInfo = document.getElementById("projectInfo");
      var editableSection = document.getElementById("editableSection");
      var submitBtn = document.getElementById("submitBtn");
      var fileInput = document.querySelector('input[type="file"]');
      var fileUploadArea = document.getElementById("fileUploadArea");
      var fileNameDisplay = document.getElementById("fileName");
      var form = document.getElementById("reenvioForm");
      var errorMessage = document.getElementById("errorMessage");
      var btnText = document.getElementById("btnText");
      var btnSpinner = document.getElementById("btnSpinner");
      var savingHorasInput = document.getElementById("savingHorasInput");
      var savingReaisInput = document.getElementById("savingReaisInput");
      var chipsContainer = document.getElementById("chipsContainer");
      var chipsField = document.getElementById("chipsField");
      var participantesInput = document.getElementById("participantesInput");
      var chipInvalidTip = document.getElementById("chipInvalidTip");
      var chipRemoveWarning = document.getElementById("chipRemoveWarning");
      var chipRemoveWarningText = document.getElementById("chipRemoveWarningText");
      var chipRemoveConfirm = document.getElementById("chipRemoveConfirm");
      var chipRemoveCancel = document.getElementById("chipRemoveCancel");
      var camposEditados = document.getElementById("camposEditados");
      var highlightedIndex = -1;
      var filteredProjetos = projetos.slice();
      var EMAIL_RE = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
      var chips = [];
      var originalChips = [];
      var pendingRemoveIdx = -1;
      var activeBlocks = {};
      var currentProjectData = null;

      /* -- ESCAPE HTML -- */
      function escapeHtml(str) {
        var div = document.createElement("div");
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
      }

      /* -- HIGHLIGHT MATCH -- */
      function highlightMatch(text, query) {
        if (!query) return escapeHtml(text);
        var escaped = escapeHtml(text);
        var lower = escaped.toLowerCase();
        var lq = escapeHtml(query).toLowerCase();
        var idx = lower.indexOf(lq);
        if (idx === -1) return escaped;
        return escaped.substring(0, idx) + "<mark>" + escaped.substring(idx, idx + lq.length) + "</mark>" + escaped.substring(idx + lq.length);
      }

      /* -- SEARCHABLE DROPDOWN -- */
      function renderOptions(query) {
        query = (query || "").trim().toLowerCase();
        filteredProjetos = projetos.filter(function(p) {
          return !query || p.projeto.toLowerCase().indexOf(query) !== -1;
        });
        highlightedIndex = -1;
        var html = "";
        if (filteredProjetos.length === 0) {
          html = '<div class="search-select-empty">Nenhum projeto encontrado</div>';
        } else {
          for (var i = 0; i < filteredProjetos.length; i++) {
            var p = filteredProjetos[i];
            var isSelected = projetoHidden.value === p.projeto;
            html += '<div class="search-select-option' + (isSelected ? " selected" : "") + '" data-index="' + i + '">';
            html += '<span class="opt-icon">' + (isSelected ? "✔️" : "📋") + "</span>";
            html += '<span class="opt-text">' + highlightMatch(p.projeto, query) + "</span>";
            html += "</div>";
          }
        }
        optionsContainer.innerHTML = html;
        countDisplay.textContent = filteredProjetos.length + " de " + projetos.length + " projetos";
      }

      function openDropdown() {
        searchSelect.classList.add("open");
        searchInput.value = "";
        renderOptions("");
        setTimeout(function() { searchInput.focus(); }, 50);
      }
      function closeDropdown() {
        searchSelect.classList.remove("open");
        highlightedIndex = -1;
      }
      function setHighlight(idx) {
        var opts = optionsContainer.querySelectorAll(".search-select-option");
        for (var i = 0; i < opts.length; i++) opts[i].classList.remove("highlighted");
        if (idx >= 0 && idx < opts.length) {
          opts[idx].classList.add("highlighted");
          opts[idx].scrollIntoView({ block: "nearest" });
        }
        highlightedIndex = idx;
      }

      trigger.addEventListener("click", function(e) {
        e.stopPropagation();
        if (searchSelect.classList.contains("open")) closeDropdown(); else openDropdown();
      });
      searchInput.addEventListener("input", function() { renderOptions(this.value); });
      searchInput.addEventListener("keydown", function(e) {
        var opts = optionsContainer.querySelectorAll(".search-select-option");
        if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(Math.min(highlightedIndex + 1, opts.length - 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(Math.max(highlightedIndex - 1, 0)); }
        else if (e.key === "Enter") { e.preventDefault(); if (highlightedIndex >= 0 && filteredProjetos[highlightedIndex]) selectProject(filteredProjetos[highlightedIndex].projeto); }
        else if (e.key === "Escape") closeDropdown();
      });
      optionsContainer.addEventListener("click", function(e) {
        var opt = e.target.closest(".search-select-option");
        if (opt) {
          var idx = parseInt(opt.getAttribute("data-index"));
          if (filteredProjetos[idx]) selectProject(filteredProjetos[idx].projeto);
        }
      });
      document.addEventListener("click", function(e) {
        if (!searchSelect.contains(e.target)) closeDropdown();
      });

      /* -- TRUNCATE TEXT -- */
      function truncate(str, max) {
        str = (str || "").trim();
        return str.length > max ? str.substring(0, max) + "..." : str;
      }

      /* -- UPDATE PREVIEWS -- */
      function updatePreviews() {
        if (!currentProjectData) return;
        var descVal = form.querySelector('[name="descricao"]').value || currentProjectData.descricao;
        document.getElementById("previewDescricao").textContent = truncate(descVal, 40);
        var h = savingHorasInput.value || currentProjectData.saving_horas;
        var r = savingReaisInput.value || currentProjectData.saving_reais;
        document.getElementById("previewSaving").textContent = h + "h / R$ " + r;
        var memVal = form.querySelector('[name="memorial_calculo"]').value || currentProjectData.memorial;
        document.getElementById("previewMemorial").textContent = truncate(memVal, 40);
        var partCount = chips.length;
        document.getElementById("previewParticipantes").textContent = partCount > 0 ? partCount + " participante" + (partCount > 1 ? "s" : "") : "Nenhum";
      }

      /* -- SELECT PROJECT -- */
      function selectProject(projeto) {
        var sel = projetos.find(function(p) { return p.projeto === projeto; });
        if (!sel) return;
        currentProjectData = sel;
        projetoHidden.value = sel.projeto;
        trigger.innerHTML = '<span class="search-select-value">' + escapeHtml(sel.projeto) + "</span>";
        trigger.classList.remove("invalid");
        var errP = document.querySelector('.field-error[data-field="projeto"]');
        if (errP) errP.classList.remove("show");

        document.getElementById("infoArea").textContent = sel.area;
        document.getElementById("infoFerramenta").textContent = sel.ferramenta;
        document.getElementById("infoStatus").textContent = sel.status;
        document.getElementById("docUrlAtual").value = sel.url;

        form.querySelector('[name="descricao"]').value = sel.descricao;
        savingHorasInput.value = sel.saving_horas;
        savingReaisInput.value = sel.saving_reais;
        form.querySelector('[name="memorial_calculo"]').value = sel.memorial;

        // Parse participantes into chips
        chips = [];
        originalChips = [];
        var parts = (sel.participantes || "").split(/[,;\\n]+/);
        for (var i = 0; i < parts.length; i++) {
          var v = parts[i].trim();
          if (v) {
            var isEmail = EMAIL_RE.test(v);
            chips.push({ value: v, valid: isEmail, original: true });
            originalChips.push(v.toLowerCase());
          }
        }
        renderChips();

        // Reset all editable blocks to closed
        activeBlocks = {};
        var blocks = document.querySelectorAll(".editable-block");
        for (var b = 0; b < blocks.length; b++) blocks[b].classList.remove("active");
        updateActiveBlocksInput();
        updatePreviews();

        // Reset motivo
        form.querySelector('[name="motivo_reenvio"]').value = "";

        // Reset file
        fileInput.value = "";
        fileNameDisplay.classList.remove("show");

        projectInfo.style.display = "block";
        editableSection.style.display = "block";
        submitBtn.disabled = false;
        closeDropdown();
      }

      /* -- EDITABLE BLOCKS -- */
      var editableHeaders = document.querySelectorAll(".editable-header");
      for (var eh = 0; eh < editableHeaders.length; eh++) {
        editableHeaders[eh].addEventListener("click", function() {
          var block = this.parentNode;
          var key = block.getAttribute("data-block");
          if (block.classList.contains("active")) {
            block.classList.remove("active");
            delete activeBlocks[key];
          } else {
            block.classList.add("active");
            activeBlocks[key] = true;
            // Focus first input
            var firstInput = block.querySelector(".form-input, .form-textarea, .chips-field");
            if (firstInput) setTimeout(function() { firstInput.focus(); }, 100);
          }
          updateActiveBlocksInput();
        });
      }

      function updateActiveBlocksInput() {
        camposEditados.value = Object.keys(activeBlocks).join(",");
      }

      /* -- CHIPS SYSTEM -- */
      function syncParticipantes() {
        participantesInput.value = chips.map(function(c) { return c.value; }).join(", ");
      }

      function renderChips() {
        var existing = chipsContainer.querySelectorAll(".chip");
        for (var i = 0; i < existing.length; i++) existing[i].remove();
        for (var j = 0; j < chips.length; j++) {
          var c = chips[j];
          var chip = document.createElement("span");
          chip.className = "chip" + (c.valid ? "" : " invalid-email") + (c.original ? " original" : "");
          chip.setAttribute("data-index", j);
          chip.title = c.valid ? c.value : "Email invalido";
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
            attemptRemoveChip(idx);
          });
          chip.appendChild(text);
          chip.appendChild(btn);
          chipsContainer.insertBefore(chip, chipsField);
        }
        syncParticipantes();
        updatePreviews();
      }

      function attemptRemoveChip(idx) {
        var c = chips[idx];
        if (c && c.original) {
          pendingRemoveIdx = idx;
          chipRemoveWarningText.textContent = 'Cuidado! Voce esta excluindo "' + c.value + '", um participante original do projeto.';
          chipRemoveWarning.classList.add("show");
        } else {
          chips.splice(idx, 1);
          renderChips();
        }
      }

      chipRemoveConfirm.addEventListener("click", function() {
        if (pendingRemoveIdx >= 0 && pendingRemoveIdx < chips.length) {
          chips.splice(pendingRemoveIdx, 1);
          renderChips();
        }
        pendingRemoveIdx = -1;
        chipRemoveWarning.classList.remove("show");
      });
      chipRemoveCancel.addEventListener("click", function() {
        pendingRemoveIdx = -1;
        chipRemoveWarning.classList.remove("show");
      });

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
        var isOrig = originalChips.indexOf(value.toLowerCase()) !== -1;
        chips.push({ value: value, valid: true, original: isOrig });
        renderChips();
        chipsContainer.classList.remove("invalid");
        return true;
      }

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
          attemptRemoveChip(chips.length - 1);
        }
      });
      chipsField.addEventListener("blur", function() { var v = this.value.trim(); if (v) addChip(v); });
      chipsField.addEventListener("paste", function(e) {
        var text = (e.clipboardData || window.clipboardData).getData("text");
        if (text && /[,;\\s]/.test(text)) {
          e.preventDefault();
          var parts = text.split(/[,;\\s]+/);
          for (var i = 0; i < parts.length; i++) { if (parts[i].trim()) addChip(parts[i]); }
          this.value = "";
        }
      });

      /* -- SAVING RATIO CHECK -- */
      var savingRatioTip = document.getElementById("savingRatioTip");
      var ratioMsg = null;
      function checkSavingRatio() {
        if (!ratioMsg) ratioMsg = savingRatioTip.querySelector(".ratio-msg");
        var horas = parseFloat(savingHorasInput.value);
        var reais = parseFloat(savingReaisInput.value);
        if (horas > 0 && reais > 0) {
          var ratio = reais / horas;
          if (ratio <= 8) {
            ratioMsg.textContent = "O valor por hora (R$/h) ficou abaixo de R$ 8,00. Confira se os valores informados estao corretos.";
            savingRatioTip.className = "saving-ratio-tip show error";
            return false;
          }
          if (ratio > 60) {
            ratioMsg.textContent = "O valor por hora (R$/h) ficou acima de R$ 60,00 — confira se os valores estao proporcionais.";
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

      /* -- FILE UPLOAD -- */
      var ALLOWED_EXTS = ["pdf", "docx", "doc", "txt", "md"];
      function handleFileSelection(file) {
        if (!file) return;
        var ext = file.name.split(".").pop().toLowerCase();
        if (ALLOWED_EXTS.indexOf(ext) === -1) {
          fileInput.value = "";
          fileNameDisplay.classList.remove("show");
          fileUploadArea.classList.add("invalid");
          var errorEl = document.querySelector('.field-error[data-field="documentacao"]');
          if (errorEl) { errorEl.textContent = "❌ Formato ." + ext + " nao e aceito. Envie em PDF, DOCX, DOC, TXT ou MD."; errorEl.classList.add("show"); }
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
        if (errorEl) { errorEl.textContent = "Formato de arquivo invalido"; errorEl.classList.remove("show"); }
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

      /* -- VALIDATION HELPERS -- */
      function validateField(field, minLength) {
        minLength = minLength || 1;
        var value = field.value.trim();
        var isValid = value.length >= minLength;
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
      function validateNumber(field) {
        var isValid = field.value !== "" && !isNaN(field.value) && parseFloat(field.value) > 0;
        var errorEl = document.querySelector('.field-error[data-field="' + field.name + '"]');
        if (!isValid) { field.classList.add("invalid"); if (errorEl) errorEl.classList.add("show"); }
        else { field.classList.remove("invalid"); if (errorEl) errorEl.classList.remove("show"); }
        return isValid;
      }

      /* -- REAL-TIME FIELD CLEANUP -- */
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

      /* -- VALIDATE FORM -- */
      function validateForm() {
        var valid = true;

        // Nome (obrigatorio, sem numeros)
        var nomeField = form.querySelector('[name="nome"]');
        if (!validateField(nomeField, 2)) { valid = false; }
        else if (/[0-9]/.test(nomeField.value)) {
          nomeField.classList.add("invalid");
          var nErr = document.querySelector('.field-error[data-field="nome"]');
          if (nErr) { nErr.textContent = "O nome nao pode conter numeros"; nErr.classList.add("show"); }
          valid = false;
        }

        // Email
        if (!validateEmail(form.querySelector('[name="email"]'))) valid = false;

        // Projeto selecionado
        if (!projetoHidden.value) {
          trigger.classList.add("invalid");
          var errP = document.querySelector('.field-error[data-field="projeto"]');
          if (errP) errP.classList.add("show");
          valid = false;
        }

        // Descricao (sempre validada, mesmo fechada — usa o valor preenchido)
        if (!validateField(form.querySelector('[name="descricao"]'), 10)) valid = false;

        // Saving
        if (!validateNumber(savingHorasInput)) valid = false;
        if (!validateNumber(savingReaisInput)) valid = false;
        if (activeBlocks.saving && !checkSavingRatio()) valid = false;

        // Memorial
        if (!validateField(form.querySelector('[name="memorial_calculo"]'), 20)) valid = false;

        // Motivo
        if (!validateField(form.querySelector('[name="motivo_reenvio"]'), 8)) valid = false;

        return valid;
      }

      /* -- FORM SUBMIT -- */
      form.addEventListener("submit", function(e) {
        e.preventDefault();
        // Commit pending chip
        var pending = chipsField.value.trim();
        if (pending) { addChip(pending); chipsField.value = ""; }

        if (!validateForm()) {
          errorMessage.textContent = "⚠️ Preencha todos os campos corretamente.";
          errorMessage.classList.add("show");
          // Open first block with error
          var blocks = document.querySelectorAll(".editable-block");
          for (var b = 0; b < blocks.length; b++) {
            var err = blocks[b].querySelector(".form-input.invalid, .form-textarea.invalid");
            if (err && !blocks[b].classList.contains("active")) {
              blocks[b].classList.add("active");
              var key = blocks[b].getAttribute("data-block");
              activeBlocks[key] = true;
              updateActiveBlocksInput();
              setTimeout(function() { err.scrollIntoView({ behavior: "smooth", block: "center" }); if (err.focus) err.focus(); }, 100);
              break;
            }
          }
          // Also check non-block fields
          var topErr = form.querySelector('.form-section .form-input.invalid');
          if (topErr) { topErr.scrollIntoView({ behavior: "smooth", block: "center" }); topErr.focus(); }
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
        fetch("https://n8n-study.gogroupgl.com/webhook/reenvio_workflows_post", { method: "POST", body: formData })
        .then(function(response) { if (response.ok) return response.text(); else throw new Error("Erro no servidor"); })
        .then(function(html) { document.open(); document.write(html); document.close(); })
        .catch(function(error) {
          console.error("Erro:", error);
          errorMessage.textContent = "❌ Erro ao enviar. Tente novamente.";
          errorMessage.classList.add("show");
          submitBtn.disabled = false;
          btnText.textContent = "🔄 Reenviar para Triagem";
          btnSpinner.style.display = "none";
        });
      });

      /* -- COPY LINK -- */
      var copyBtn = document.getElementById("copyGeminiBtn");
      var linkInput = document.getElementById("geminiLinkInput");
      if (copyBtn && linkInput) {
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
      }
    })();
  </scr` + `ipt>
</body>
</html>`;

return [{ json: { html } }];