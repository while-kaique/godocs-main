import * as React from "react";
import { toast } from "sonner";
import { Paperclip, X } from "lucide-react";
import { FieldError } from "./form-components";
import { readFileAsBase64 } from "./constants";
import { EVIDENCIA_MIN, type AnexoEvidencia } from "./evidencia";

/**
 * CAMPO DE EVIDÊNCIA — texto obrigatório + anexo opcional + **colar imagem**.
 *
 * D1/RF-208: o saving efetivado é o único ganho comprovável (a linha de custo existia e
 * parou), e é por isso que ele pede prova. Mas **anexo sem texto é recusado**: o print
 * sozinho não diz por que aquele número é DESTA automação, e é essa amarração que a
 * triagem lê. A régua (as duas mensagens distintas) vive em `evidencia.ts`, testada.
 *
 * O mesmo componente serve ao racional do **ganho imensurável**, onde não há número e o
 * texto é a evidência inteira — daí `rotuloAnexo`/`ajuda` serem props.
 *
 * ⚠️ O `onPaste` de imagem existia em UM lugar do repo (`ajuda-widget.tsx:142`) e não
 * estava extraído. Aqui ele é reescrito junto do `onDrop` irmão, reusando o único helper
 * que era reusável: `readFileAsBase64` (`constants.ts:791`).
 *
 * ⚠️ Arquivo de 0 byte é descartado no cliente: `base64` vazio faz o zod do backend
 * estourar e derruba a submissão inteira (bug real, registrado no `addFiles` da Etapa 2).
 */
const MAX_ANEXO_MB = 5;
const MAX_ANEXOS = 5;
const EXT_IMAGEM = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const EXT_ACEITAS = [...EXT_IMAGEM, ".pdf"];

function extensaoDe(nome: string): string {
  const i = nome.lastIndexOf(".");
  return i === -1 ? "" : nome.slice(i).toLowerCase();
}

/** `data:` URL para a miniatura. Só imagem tem preview; PDF mostra o nome. */
function previewDe(anexo: AnexoEvidencia): string | null {
  const ext = extensaoDe(anexo.filename);
  if (!EXT_IMAGEM.includes(ext)) return null;
  const mime = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
  return `data:${mime};base64,${anexo.base64}`;
}

export function CampoEvidencia({
  texto,
  anexos,
  onChangeTexto,
  onChangeAnexos,
  erro,
  placeholder,
  rotuloAnexo = "Anexar ou colar print",
  ajuda,
}: {
  texto: string;
  anexos: AnexoEvidencia[];
  onChangeTexto: (v: string) => void;
  onChangeAnexos: (v: AnexoEvidencia[]) => void;
  erro?: string;
  placeholder?: string;
  rotuloAnexo?: string;
  ajuda?: React.ReactNode;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = React.useState(false);

  async function adicionar(entrada: FileList | File[] | null | undefined) {
    const lista = Array.from(entrada ?? []);
    if (lista.length === 0) return;
    const aceitos: AnexoEvidencia[] = [];
    for (const file of lista) {
      if (anexos.length + aceitos.length >= MAX_ANEXOS) {
        toast.warning(`Máximo de ${MAX_ANEXOS} anexos.`);
        break;
      }
      const ext = extensaoDe(file.name);
      if (!EXT_ACEITAS.includes(ext)) {
        toast.error(`"${file.name}": aceito imagem (PNG, JPG, GIF, WEBP) ou PDF.`);
        continue;
      }
      if (file.size === 0) {
        toast.error(`"${file.name}" está vazio (0 bytes).`);
        continue;
      }
      if (file.size > MAX_ANEXO_MB * 1024 * 1024) {
        toast.error(`"${file.name}" passa de ${MAX_ANEXO_MB} MB.`);
        continue;
      }
      try {
        const base64 = await readFileAsBase64(file);
        if (base64) aceitos.push({ base64, filename: file.name || "print.png" });
      } catch {
        toast.error(`Não consegui ler "${file.name}".`);
      }
    }
    if (aceitos.length > 0) onChangeAnexos([...anexos, ...aceitos]);
  }

  function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) =>
      i.type.startsWith("image/"),
    );
    if (!item) return; // colar texto normal continua funcionando
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    // O clipboard costuma vir sem nome de arquivo — damos um, senão a extensão
    // (que é como decidimos o preview e o aceite) fica indeterminada.
    const nomeado =
      file.name && extensaoDe(file.name)
        ? file
        : new File([file], `print-colado-${Date.now()}.png`, { type: file.type });
    void adicionar([nomeado]);
  }

  return (
    <div>
      <textarea
        value={texto}
        onChange={(e) => onChangeTexto(e.target.value)}
        onPaste={onPaste}
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          void adicionar(e.dataTransfer.files);
        }}
        placeholder={placeholder}
        aria-invalid={erro ? true : undefined}
        rows={4}
        className="go-input w-full"
        style={{
          padding: "10px 12px",
          borderRadius: "var(--go-radius-md)",
          border: erro
            ? "1.5px solid #e53e3e"
            : arrastando
              ? "1.5px dashed var(--go-blue)"
              : "1.5px solid rgba(215,219,0,0.2)",
          background: "var(--go-white)",
          fontSize: 13,
          lineHeight: 1.6,
          resize: "vertical",
        }}
      />

      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: "#8b8b9a" }}>
          {texto.trim().length < EVIDENCIA_MIN
            ? `Mínimo de ${EVIDENCIA_MIN} caracteres · pode colar um print aqui`
            : "Pode colar um print direto no campo"}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold transition-colors"
          style={{ color: "var(--go-blue)", background: "rgba(0,89,169,0.06)" }}
        >
          <Paperclip className="h-3 w-3" aria-hidden />
          {rotuloAnexo}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={EXT_ACEITAS.join(",")}
          className="hidden"
          onChange={(e) => {
            void adicionar(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {anexos.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {anexos.map((anexo, i) => {
            const preview = previewDe(anexo);
            return (
              <li
                key={`${anexo.filename}-${i}`}
                className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5"
                style={{ background: "var(--go-cream)", border: "1px solid rgba(0,89,169,0.14)" }}
              >
                {preview ? (
                  <img
                    src={preview}
                    alt={`Miniatura de ${anexo.filename}`}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded text-[9px] font-bold"
                    style={{ background: "rgba(0,89,169,0.1)", color: "var(--go-blue)" }}
                    aria-hidden
                  >
                    PDF
                  </span>
                )}
                <span className="max-w-[140px] truncate text-[11.5px]" style={{ color: "#5b5b6a" }}>
                  {anexo.filename}
                </span>
                <button
                  type="button"
                  onClick={() => onChangeAnexos(anexos.filter((_, idx) => idx !== i))}
                  aria-label={`Remover anexo ${anexo.filename}`}
                  className="flex h-5 w-5 items-center justify-center rounded"
                  style={{ color: "#b4313b" }}
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <FieldError message={erro} />
      {ajuda ? <div className="mt-1.5">{ajuda}</div> : null}
    </div>
  );
}
