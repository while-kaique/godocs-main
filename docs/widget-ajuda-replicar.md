# Widget de Ajuda & Sugestões — Guia de Replicação (padrão GoGroup)

Guia passo a passo para colocar a **caixinha flutuante de ajuda** (dúvida · problema · sugestão)
em **qualquer site da empresa**, com a identidade visual GoGroup e enviando os chamados para um
espaço do **Google Chat**. É portátil: copie os blocos, ajuste o endpoint e está no ar.

> Implementação de referência: o widget já roda no **GoDocs** (`godocs.devgogroup.com`). Este
> documento extrai o essencial num formato genérico para reuso. A decisão de produto/arquitetura
> original está em `spec-docs/SPEC_WIDGET_AJUDA.md`.

---

## Como funciona (visão rápida)

```
  [qualquer página]                          seu backend                Google Chat
  ┌───────────────┐                       ┌──────────────┐           ┌──────────────┐
  │   ( ? ) FAB    │  ── POST /api/ajuda ─▶│  guarda o     │ ── POST ─▶│ espaço de     │
  │   ▼ painel     │   { tipo, mensagem,   │  webhook (secret)         │ suporte:      │
  │  Dúvida        │     pagina, print? }  │  monta a msg  │           │ ❓/🐞/💡 ...   │
  │  Problema      │                       │  e dispara    │           └──────────────┘
  │  Sugestão      │                       └──────────────┘
  └───────────────┘
```

- **Mão única:** a pessoa envia; o time lê no Google Chat e responde por fora (Chat direto/e-mail).
  Não há resposta voltando para dentro do site.
- **3 tipos**, cada um com **emoji/cabeçalho próprio** na mensagem do Chat, pra bater o olho:
  **❓ DÚVIDA** · **🐞 PROBLEMA / ERRO** · **💡 SUGESTÃO DE MELHORIA**.
- **Print opcional** (anexar / colar / arrastar uma imagem).

---

## ⚠️ Regra de ouro de segurança (leia antes de tudo)

**NUNCA** chame o webhook do Google Chat direto do navegador. Dois motivos:

1. **Vazaria o segredo** — a URL do webhook (`...?key=...&token=...`) ficaria no código do front,
   visível pra qualquer um, que poderia spammar o espaço.
2. **CORS** — o endpoint do Google Chat não aceita chamadas de browser de qualquer forma.

✅ O fluxo correto: o front chama **o SEU backend** (`/api/ajuda`); o backend guarda o webhook como
**secret** (variável de ambiente) e faz o POST para o Google Chat **no servidor**.

---

## Pré-requisitos

- Um **espaço no Google Chat** onde o time vai acompanhar os chamados + permissão para criar um
  *Incoming Webhook* nele.
- Um **backend** no seu site capaz de expor uma rota e ler uma variável de ambiente (worker do
  Godeploy, Node/Express, Next API route, etc.).
- **Frontend:** React + [`lucide-react`](https://lucide.dev) (ícones). Dá pra adaptar para outros
  frameworks — o que importa é a marcação/CSS.

---

## Passo 1 — Criar o webhook do Google Chat

1. Abra o **espaço** no Google Chat onde quer receber os chamados (crie um, ex.: `suporte-meusite`).
2. No nome do espaço → **Apps e integrações** → **Webhooks** (ou *Gerenciar webhooks*) → **Adicionar**.
3. Dê um nome (ex.: `Widget de Ajuda`) e, se quiser, um avatar → **Salvar**.
4. **Copie a URL** gerada (formato `https://chat.googleapis.com/v1/spaces/AAA.../messages?key=...&token=...`).
5. Guarde essa URL como **secret** no seu backend (ex.: `CHAT_WEBHOOK_URL`). **Não** comite em lugar
   nenhum nem coloque no código do front.

---

## Passo 2 — Tokens de design GoGroup (CSS)

Cole este bloco no CSS global do site (ele é autossuficiente — funciona mesmo num site que ainda não
tem o design system GoGroup). Já inclui foco visível, `prefers-reduced-motion` e a fonte Poppins.

```css
/* Fonte da marca */
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');

:root {
  /* Paleta GoGroup */
  --go-blue: #0059A9;
  --go-lime: #D7DB00;
  --go-cream: #FBF4EE;
  --go-light-blue: #C7E9FD;
  --go-white: #FFFFFF;
  --go-text-primary: #333333;
  --go-muted: #8b8b9a;

  /* Raio e sombras */
  --go-radius-sm: 8px;
  --go-shadow-lg: 0 8px 32px rgba(0, 89, 169, 0.10);
  --go-shadow-lime-glow: 0 4px 20px rgba(215, 219, 0, 0.3);
}

/* Foco de teclado visível (acessibilidade) */
.ajuda-scope :focus-visible {
  outline: 2px solid var(--go-blue);
  outline-offset: 2px;
}

/* O painel "cresce" a partir do botão */
@keyframes go-pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}

/* Respeita "reduzir movimento" do sistema */
@media (prefers-reduced-motion: reduce) {
  .ajuda-scope *, .ajuda-scope *::before, .ajuda-scope *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}

/* Campo de texto e botão primário no padrão GoGroup */
.go-textarea {
  width: 100%; padding: 11px 14px; background: var(--go-white);
  border: 1.5px solid rgba(0, 89, 169, 0.18); border-radius: var(--go-radius-sm);
  color: var(--go-text-primary); font-size: 14px; font-family: 'Poppins', sans-serif;
  transition: border-color .2s, box-shadow .2s; outline: none; resize: vertical;
}
.go-textarea:focus { border-color: var(--go-blue); box-shadow: 0 0 0 3px rgba(0,89,169,.08); }
.go-textarea::placeholder { color: #b0b0b8; }

.go-btn-submit {
  width: 100%; padding: 13px 28px; background: var(--go-lime); border: none;
  border-radius: 9999px; color: var(--go-blue); font-size: 15px; font-weight: 700;
  font-family: 'Poppins', sans-serif; cursor: pointer; display: flex; align-items: center;
  justify-content: center; gap: 8px; transition: transform .2s, box-shadow .2s;
}
.go-btn-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: var(--go-shadow-lime-glow); }
.go-btn-submit:disabled { opacity: .5; cursor: not-allowed; }
```

> O componente abaixo usa a classe `ajuda-scope` no contêiner raiz para limitar o foco/motion ao
> widget, sem afetar o resto do site.

---

## Passo 3 — Componente do widget (React, autossuficiente)

Crie `AjudaWidget.tsx`. Depende só de **React** + **lucide-react**. O feedback de envio é mostrado
**dentro do painel** (sem precisar de lib de toast). Ajuste `ENDPOINT` se sua rota for diferente.

```tsx
import { useEffect, useRef, useState } from "react";
import {
  HelpCircle, MessageCircleQuestion, Bug, Lightbulb,
  Paperclip, Send, Loader2, Check, X,
} from "lucide-react";

const ENDPOINT = "/api/ajuda";              // ← rota do SEU backend (Passo 5)
const MAX_IMG_BYTES = 5 * 1024 * 1024;      // 5 MB

type Tipo = "duvida" | "problema" | "sugestao";
type Print = { base64: string; filename: string; previewUrl: string };

const TIPOS: {
  id: Tipo; rotulo: string; descricao: string; placeholder: string;
  Icone: typeof HelpCircle; chipBg: string; chipFg: string;
}[] = [
  { id: "duvida",   rotulo: "Dúvida",   descricao: "Não sei como fazer algo",
    placeholder: "Descreva sua dúvida com o máximo de detalhe…",
    Icone: MessageCircleQuestion, chipBg: "rgba(0,89,169,0.10)", chipFg: "var(--go-blue)" },
  { id: "problema", rotulo: "Problema", descricao: "Algo deu errado ou travou",
    placeholder: "O que aconteceu? Em que momento? O que você esperava?",
    Icone: Bug, chipBg: "rgba(220,38,38,0.10)", chipFg: "#dc2626" },
  { id: "sugestao", rotulo: "Sugestão", descricao: "Uma ideia pra melhorar",
    placeholder: "Qual a sua ideia? O que ela melhoraria no dia a dia?",
    Icone: Lightbulb, chipBg: "rgba(215,219,0,0.22)", chipFg: "#6b6d00" },
];

// Lê um File como base64 puro (sem o prefixo data:...).
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function AjudaWidget() {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("duvida");
  const [mensagem, setMensagem] = useState("");
  const [print, setPrint] = useState<Print | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const fabRef = useRef<HTMLButtonElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const printRef = useRef<Print | null>(null);
  printRef.current = print;

  useEffect(() => { if (aberto) { const id = requestAnimationFrame(() => taRef.current?.focus()); return () => cancelAnimationFrame(id); } }, [aberto]);
  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto]);
  useEffect(() => () => { if (printRef.current?.previewUrl) URL.revokeObjectURL(printRef.current.previewUrl); }, []);

  function fechar() { setAberto(false); fabRef.current?.focus(); }
  function limparPrint() { if (print?.previewUrl) URL.revokeObjectURL(print.previewUrl); setPrint(null); }

  async function adicionarArquivo(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErro("Anexe uma imagem (print da tela).");
    if (file.size > MAX_IMG_BYTES) return setErro("Imagem muito grande (máximo 5 MB).");
    try {
      const base64 = await readFileAsBase64(file);
      if (print?.previewUrl) URL.revokeObjectURL(print.previewUrl);
      setPrint({ base64, filename: file.name || "print.png", previewUrl: URL.createObjectURL(file) });
      setErro(null);
    } catch { setErro("Não consegui ler a imagem."); }
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) { e.preventDefault(); void adicionarArquivo(f); }
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setArrastando(false);
    void adicionarArquivo(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/")));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const texto = mensagem.trim();
    if (!texto || enviando) return;
    setEnviando(true); setErro(null);
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo, mensagem: texto,
          pagina_url: window.location.pathname + window.location.search,
          user_agent: navigator.userAgent,
          print: print ? { base64: print.base64, filename: print.filename } : undefined,
        }),
      });
      if (!resp.ok) throw new Error("Falha ao enviar.");
      limparPrint(); setMensagem(""); setTipo("duvida"); fechar();
      // opcional: troque por seu toast de sucesso
      alert("Enviado! A equipe vai dar uma olhada e responde direto pelo Google Chat.");
    } catch {
      setErro("Não consegui enviar. Tente de novo em instantes.");
    } finally { setEnviando(false); }
  }

  const podeEnviar = mensagem.trim().length > 0 && !enviando;

  return (
    <div className="ajuda-scope" style={{ fontFamily: "'Poppins', sans-serif" }}>
      {aberto && <div onClick={fechar} aria-hidden="true"
        style={{ position: "fixed", inset: 0, zIndex: 40 }} />}

      <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
        {aberto && (
          <section role="dialog" aria-label="Ajuda e suporte"
            onDragOver={(e) => { e.preventDefault(); if (!arrastando) setArrastando(true); }}
            onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
            onDrop={onDrop}
            style={{
              width: "min(380px, calc(100vw - 2.5rem))", maxHeight: "min(560px, 80vh)",
              display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: 16,
              background: "var(--go-white)", boxShadow: "0 24px 64px rgba(8,20,40,0.30)",
              animation: "go-pop-in 0.22s ease both", transformOrigin: "bottom right",
            }}>
            {/* Cabeçalho azul */}
            <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: "16px 20px", background: "var(--go-blue)", color: "var(--go-white)" }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2, margin: 0 }}>Precisa de ajuda?</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, lineHeight: 1.35, color: "rgba(255,255,255,0.85)" }}>
                  Tire uma dúvida, relate um problema ou mande uma sugestão. A equipe responde direto pelo Google Chat.
                </p>
              </div>
              <button type="button" onClick={fechar} aria-label="Fechar ajuda"
                style={{ display: "flex", height: 32, width: 32, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 9999, border: "none", background: "transparent", color: "var(--go-white)", cursor: "pointer" }}>
                <X width={18} height={18} />
              </button>
            </header>

            <form onSubmit={enviar} style={{ display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", padding: 20, minHeight: 0, flex: 1 }}>
              {/* Seletor de tipo (lista vertical) */}
              <div role="group" aria-label="Tipo do chamado" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {TIPOS.map(({ id, rotulo, descricao, Icone, chipBg, chipFg }) => {
                  const sel = tipo === id;
                  return (
                    <button key={id} type="button" aria-pressed={sel} onClick={() => setTipo(id)}
                      style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 12, padding: 10, textAlign: "left", cursor: "pointer",
                        border: sel ? "1.5px solid var(--go-blue)" : "1.5px solid rgba(0,89,169,0.18)",
                        background: sel ? "rgba(0,89,169,0.05)" : "transparent" }}>
                      <span style={{ display: "flex", height: 36, width: 36, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: chipBg, color: chipFg }}>
                        <Icone width={18} height={18} />
                      </span>
                      <span style={{ display: "flex", minWidth: 0, flex: 1, flexDirection: "column" }}>
                        <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2, color: sel ? "var(--go-blue)" : "var(--go-text-primary)" }}>{rotulo}</span>
                        <span style={{ fontSize: 11, lineHeight: 1.35, color: "var(--go-muted)" }}>{descricao}</span>
                      </span>
                      <span style={sel
                        ? { display: "flex", height: 18, width: 18, flexShrink: 0, alignItems: "center", justifyContent: "center", borderRadius: 9999, background: "var(--go-blue)", color: "var(--go-white)" }
                        : { display: "flex", height: 18, width: 18, flexShrink: 0, borderRadius: 9999, border: "1.5px solid rgba(0,89,169,0.30)" }}>
                        {sel && <Check width={11} height={11} strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Mensagem */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label htmlFor="ajuda-msg" style={{ fontSize: 12, fontWeight: 600, color: "var(--go-text-primary)" }}>Sua mensagem</label>
                <textarea id="ajuda-msg" ref={taRef} className="go-textarea" style={{ minHeight: 96 }} maxLength={4000}
                  placeholder={TIPOS.find((t) => t.id === tipo)?.placeholder}
                  value={mensagem} onChange={(e) => setMensagem(e.target.value)} onPaste={onPaste}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && podeEnviar) { e.preventDefault(); void enviar(e as unknown as React.FormEvent); } }} />
              </div>

              {/* Anexo */}
              <input id="ajuda-print" type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { void adicionarArquivo(e.target.files?.[0]); e.target.value = ""; }} />
              {print ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12, borderRadius: 12, padding: 10, border: "1.5px solid rgba(0,89,169,0.18)", background: "rgba(0,89,169,0.03)" }}>
                  <img src={print.previewUrl} alt="Pré-visualização do print" width={44} height={44} style={{ borderRadius: 8, objectFit: "cover", border: "1px solid rgba(0,89,169,0.15)" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--go-text-primary)" }}>{print.filename}</span>
                  <button type="button" onClick={limparPrint} aria-label="Remover print" style={{ height: 28, width: 28, borderRadius: 9999, border: "none", background: "transparent", color: "var(--go-muted)", cursor: "pointer" }}><X width={15} height={15} /></button>
                </div>
              ) : (
                <label htmlFor="ajuda-print" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, padding: "10px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--go-blue)",
                  border: arrastando ? "1.5px dashed var(--go-blue)" : "1.5px dashed rgba(0,89,169,0.30)",
                  background: arrastando ? "rgba(0,89,169,0.06)" : "transparent" }}>
                  <Paperclip width={15} height={15} /> Anexar print — ou cole / arraste uma imagem
                </label>
              )}

              {erro && <p role="alert" style={{ margin: 0, fontSize: 12, color: "#dc2626" }}>{erro}</p>}

              <button type="submit" disabled={!podeEnviar} className="go-btn-submit">
                {enviando ? <><Loader2 width={17} height={17} style={{ animation: "go-spin 0.8s linear infinite" }} /> Enviando…</> : <><Send width={16} height={16} /> Enviar</>}
              </button>
            </form>
          </section>
        )}

        {/* Botão flutuante (FAB) */}
        <button ref={fabRef} type="button" onClick={() => (aberto ? fechar() : setAberto(true))}
          aria-haspopup="dialog" aria-expanded={aberto} aria-label={aberto ? "Fechar ajuda" : "Abrir ajuda e suporte"}
          style={{ height: 56, width: 56, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 9999, border: "none", cursor: "pointer", background: "var(--go-blue)", color: "var(--go-white)", boxShadow: "var(--go-shadow-lg)" }}>
          {aberto ? <X width={24} height={24} /> : <HelpCircle width={26} height={26} />}
        </button>
      </div>
    </div>
  );
}
```

> Precisa do keyframe `go-spin` (spinner). Se o seu CSS ainda não tiver, adicione:
> `@keyframes go-spin { to { transform: rotate(360deg); } }`.
> Se usa uma lib de toast (ex.: `sonner`), troque o `alert(...)` pelo seu `toast.success(...)`.

---

## Passo 4 — Montar na aplicação

Monte **uma única vez**, no componente raiz/layout, para aparecer em todas as páginas:

```tsx
// App raiz / layout
import { AjudaWidget } from "./AjudaWidget";

export function RootLayout({ children }) {
  return (
    <>
      {children}
      <AjudaWidget />
    </>
  );
}
```

---

## Passo 5 — Endpoint no backend (`/api/ajuda`)

O backend recebe o JSON, **monta a mensagem com o cabeçalho do tipo** e faz o POST ao webhook
(guardado em variável de ambiente). Exemplo genérico (Node / worker estilo Cloudflare):

```ts
// Monta a mensagem com cabeçalho BEM distinto por tipo.
function buildAjudaMessage(p: {
  tipo: "duvida" | "problema" | "sugestao";
  nome?: string; email?: string; mensagem: string;
  pagina?: string | null; printLink?: string | null; data: string;
}): string {
  const SEP = "──────────────────────";
  const CABECALHO = {
    duvida:   "❓ *DÚVIDA*",
    problema: "🐞 *PROBLEMA / ERRO*",
    sugestao: "💡 *SUGESTÃO DE MELHORIA*",
  } as const;
  const linhas = [
    SEP, "", CABECALHO[p.tipo], "",
    `👤 *De:* ${p.nome ?? p.email ?? "—"}`,
    `📄 *Página:* ${p.pagina || "—"}`,
    `🕒 *Quando:* ${p.data}`,
    "", "📝 *Mensagem:*", p.mensagem,
  ];
  if (p.printLink) linhas.push("", `🖼️ *Print:* ${p.printLink}`);
  linhas.push("", SEP);
  return linhas.join("\n");
}

// Handler da rota POST /api/ajuda
export async function handleAjuda(request: Request): Promise<Response> {
  const body = await request.json();

  // 1) Validação mínima
  const tipos = ["duvida", "problema", "sugestao"];
  if (!tipos.includes(body.tipo) || !body.mensagem?.trim()) {
    return new Response(JSON.stringify({ error: "Dados inválidos." }), { status: 400 });
  }

  // 2) (Opcional) print → suba no seu storage e gere um LINK. Veja o Passo 6.
  const printLink: string | null = null;

  // 3) Monta e dispara para o Google Chat (webhook é SECRET do servidor)
  const webhook = process.env.CHAT_WEBHOOK_URL; // ← nunca no front!
  if (webhook) {
    const msg = buildAjudaMessage({
      tipo: body.tipo,
      // se o seu site tem sessão, pegue nome/email do usuário logado aqui:
      email: request.headers.get("x-user-email") ?? undefined,
      mensagem: body.mensagem.trim(),
      pagina: body.pagina_url ?? null,
      printLink,
      data: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
    // fire-and-forget; não derruba a resposta se o Chat falhar
    fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: msg }),
    }).catch((e) => console.error("[ajuda] falha ao notificar o Chat:", e));
  } else {
    console.warn("[ajuda] CHAT_WEBHOOK_URL não configurado — chamado recebido, Chat não notificado");
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
```

**Adaptações por stack:**
- **Next.js (App Router):** coloque em `app/api/ajuda/route.ts` exportando `POST`.
- **Express:** `app.post("/api/ajuda", async (req, res) => { ... })` lendo `req.body`.
- **Worker (Godeploy/Cloudflare):** registre `pathname === "/api/ajuda" && method === "POST"`.

> ⚠️ Se já existe um webhook de **outras** notificações no site, **não reaproveite o fallback dele**:
> use uma variável dedicada (`CHAT_WEBHOOK_URL`) e, se ela faltar, **pule o envio** — senão os
> chamados vão parar no espaço errado.

---

## Passo 6 — (Opcional) Print no Google Drive ou storage

Para a v1 dá pra começar **sem print** (remova o bloco de anexo do componente) ou enviar só o texto.
Se quiser anexar a imagem:

1. No backend, ao receber `print: { base64, filename }`, **suba o arquivo** no seu storage
   (Google Drive, S3, R2…) e gere um **link visível**.
2. Passe esse link em `printLink` para o `buildAjudaMessage` — ele vira a linha `🖼️ *Print:*`.
3. Faça o upload em **try/catch não-fatal**: se falhar, grave/treine o chamado mesmo assim, só sem o
   link (o print é opcional, nunca pode derrubar o envio).

> No GoDocs o upload usa o Google Drive via OAuth de um usuário real (Service Account não tem cota
> de storage no "Meu Drive"). Se for usar Drive, compartilhe a pasta com a conta que faz o upload.

---

## Checklist de qualidade (não pule)

- [ ] **Segurança:** webhook só no backend (secret); nunca no front nem no git.
- [ ] **Acessibilidade:** `Esc` fecha; foco volta ao botão; `role="dialog"` + `aria-label`;
      estado dos tipos por **ícone + indicador (forma)**, não só cor; foco de teclado visível;
      `prefers-reduced-motion` respeitado.
- [ ] **Identidade GoGroup:** azul `#0059A9` no FAB/cabeçalho, lime `#D7DB00` no botão Enviar,
      fonte **Poppins**.
- [ ] **PT-BR com acento** em todo texto visível.
- [ ] **3 tipos distintos no Chat:** ❓ Dúvida · 🐞 Problema/Erro · 💡 Sugestão.
- [ ] **Mão única:** a copy deixa claro que a resposta vem por fora (Chat/e-mail), não no app.

---

## Versão mínima × completa

| Recurso | Mínima (rápida) | Completa (GoDocs) |
|---|---|---|
| FAB + painel + 3 tipos | ✅ | ✅ |
| Enviar texto pro Google Chat | ✅ | ✅ |
| Cabeçalho/emoji por tipo | ✅ | ✅ |
| Anexar print | ➖ (pule no início) | ✅ (link do Drive) |
| Persistir os chamados (banco) | ➖ | ✅ (tabela `ajuda_chamados`) |
| Derivar nome do usuário logado | ➖ (usa e-mail/anônimo) | ✅ |

Comece pela **mínima** (Passos 1–5 sem print) e evolua conforme a necessidade.
