import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Plus,
  Send,
  Trash2,
  Upload,
  AlertTriangle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

const WEBHOOK_URL = "https://n8n-study.gogroupgl.com/webhook/submit_workflows";

const FERRAMENTAS = [
  "n8n",
  "Make",
  "Zapier",
  "Power Automate",
  "Python",
  "Apps Script",
  "Outros",
] as const;

const STATUS_PRODUCAO = [
  { value: "sim", label: "Sim, em produção" },
  { value: "desenvolvimento", label: "Em desenvolvimento" },
  { value: "pronto_sem_uso", label: "Pronto, sem uso" },
] as const;

const ACCEPTED_DOC_EXT = [".pdf", ".docx", ".doc", ".txt", ".md"];
const MAX_FILE_MB = 15;

const emailSchema = z.string().trim().email("E-mail inválido").max(255);

const step1Schema = z
  .object({
    statusProducao: z.enum(["sim", "desenvolvimento", "pronto_sem_uso"], {
      required_error: "Selecione uma opção",
    }),
    nomeCompleto: z
      .string()
      .trim()
      .min(2, "Informe seu nome completo")
      .max(120),
    email: emailSchema,
    area: z.string().trim().min(2, "Informe a área").max(80),
    ferramenta: z.enum(FERRAMENTAS, { required_error: "Selecione a ferramenta" }),
    outraFerramenta: z.string().trim().max(80).optional(),
    emEquipe: z.enum(["sim", "nao"], { required_error: "Selecione uma opção" }),
    participantes: z.array(emailSchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.ferramenta === "Outros" && !data.outraFerramenta?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outraFerramenta"],
        message: "Informe a ferramenta utilizada",
      });
    }
    if (data.emEquipe === "sim" && (!data.participantes || data.participantes.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participantes"],
        message: "Adicione pelo menos um participante",
      });
    }
  });

const step2Schema = z.object({
  nomeProjeto: z.string().trim().min(2, "Nome obrigatório").max(160),
  dataCriacao: z
    .string()
    .min(1, "Data obrigatória")
    .refine((v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return d <= today;
    }, "Data não pode ser futura"),
  descricao: z.string().trim().min(10, "Descrição mínima de 10 caracteres").max(4000),
});

const step3Schema = z
  .object({
    solucaoSimilarPaga: z.enum(["sim", "nao", "nao_sei"], {
      required_error: "Selecione uma opção",
    }),
    savingHoras: z.coerce.number({ invalid_type_error: "Informe um número" })
      .positive("Deve ser maior que zero"),
    savingReais: z.coerce.number({ invalid_type_error: "Informe um número" })
      .positive("Deve ser maior que zero"),
    tipoSaving: z.enum(["mensal", "pontual"], { required_error: "Selecione o tipo" }),
  })
  .superRefine((data, ctx) => {
    const valorHora = data.savingReais / data.savingHoras;
    if (valorHora < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["savingReais"],
        message: `Valor/hora calculado (R$ ${valorHora.toFixed(2)}) está abaixo de R$ 8 — envio bloqueado.`,
      });
    }
  });

const step4Schema = z.object({
  memorial: z.string().trim().min(20, "Memorial mínimo de 20 caracteres").max(6000),
});

type Step1 = z.infer<typeof step1Schema>;
type Step2 = z.infer<typeof step2Schema>;
type Step3 = z.infer<typeof step3Schema>;
type Step4 = z.infer<typeof step4Schema>;

export const Route = createFileRoute("/submeter")({
  head: () => ({
    meta: [
      { title: "Submeter Projeto · Hub de Projetos" },
      {
        name: "description",
        content: "Formulário interno para submissão de projetos de RPA e IA.",
      },
    ],
  }),
  component: SubmeterPage,
});

const STEPS = [
  { id: 1, label: "Responsável" },
  { id: 2, label: "Projeto" },
  { id: 3, label: "Impacto" },
  { id: 4, label: "Memorial" },
];

function SubmeterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arquivoErro, setArquivoErro] = useState<string | null>(null);

  const [data1, setData1] = useState<Step1 | null>(null);
  const [data2, setData2] = useState<Step2 | null>(null);
  const [data3, setData3] = useState<Step3 | null>(null);

  async function handleFinalSubmit(data4: Step4) {
    if (!data1 || !data2 || !data3) return;
    if (!arquivo) {
      setArquivoErro("Documentação obrigatória");
      setStep(2);
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      const payload = {
        etapa1: data1,
        etapa2: { ...data2 },
        etapa3: {
          ...data3,
          valorPorHora: Number((data3.savingReais / data3.savingHoras).toFixed(2)),
        },
        etapa4: data4,
        submittedAt: new Date().toISOString(),
      };
      fd.append("payload", JSON.stringify(payload));
      // Flatten top-level for n8n convenience
      Object.entries(data1).forEach(([k, v]) => {
        if (Array.isArray(v)) fd.append(k, v.join(","));
        else if (v !== undefined) fd.append(k, String(v));
      });
      Object.entries(data2).forEach(([k, v]) => fd.append(k, String(v)));
      Object.entries(data3).forEach(([k, v]) => fd.append(k, String(v)));
      fd.append("memorial", data4.memorial);
      fd.append(
        "valorPorHora",
        (data3.savingReais / data3.savingHoras).toFixed(2),
      );
      fd.append("documentacao", arquivo, arquivo.name);

      const res = await fetch(WEBHOOK_URL, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Erro ${res.status}`);

      setSubmitted(true);
      toast.success("Projeto submetido com sucesso!");
    } catch (err) {
      console.error(err);
      toast.error("Falha ao enviar o projeto. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto flex max-w-2xl flex-col items-center px-6 py-20 text-center">
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Projeto enviado!</h1>
          <p className="mt-3 text-muted-foreground">
            Recebemos sua submissão. Você será notificado por e-mail conforme o
            status mudar para <strong>Aprovado</strong> ou{" "}
            <strong>Reenvio Pendente</strong>.
          </p>
          <div className="mt-8 flex gap-3">
            <Button variant="outline" onClick={() => navigate({ to: "/" })}>
              Voltar à Home
            </Button>
            <Button onClick={() => window.location.reload()}>
              Submeter outro
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Voltar
          </Link>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Submeter projeto</h1>
        <p className="mt-2 text-muted-foreground">
          Triagem de fluxos · RPA & IA — preencha as 4 etapas abaixo.
        </p>

        <Stepper current={step} />

        <div className="mt-8 rounded-xl border border-border bg-card p-6 shadow-sm">
          {step === 1 && (
            <Step1Form
              defaultValues={data1 ?? undefined}
              onNext={(v) => {
                setData1(v);
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <Step2Form
              defaultValues={data2 ?? undefined}
              arquivo={arquivo}
              setArquivo={(f) => {
                setArquivo(f);
                setArquivoErro(null);
              }}
              arquivoErro={arquivoErro}
              setArquivoErro={setArquivoErro}
              onBack={() => setStep(1)}
              onNext={(v) => {
                if (!arquivo) {
                  setArquivoErro("Documentação obrigatória");
                  return;
                }
                setData2(v);
                setStep(3);
              }}
            />
          )}
          {step === 3 && (
            <Step3Form
              defaultValues={data3 ?? undefined}
              onBack={() => setStep(2)}
              onNext={(v) => {
                setData3(v);
                setStep(4);
              }}
            />
          )}
          {step === 4 && data3 && (
            <Step4Form
              valorHora={data3.savingReais / data3.savingHoras}
              submitting={submitting}
              onBack={() => setStep(3)}
              onSubmit={handleFinalSubmit}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold">
            H
          </div>
          <span className="font-semibold tracking-tight">Hub de Projetos</span>
        </Link>
      </div>
    </header>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mt-8 flex items-center gap-2">
      {STEPS.map((s, idx) => {
        const done = current > s.id;
        const active = current === s.id;
        return (
          <li key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium",
                active && "border-primary bg-primary text-primary-foreground",
                done && "border-primary bg-primary/10 text-primary",
                !active && !done && "border-border bg-background text-muted-foreground",
              )}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : s.id}
            </div>
            <span
              className={cn(
                "hidden text-sm sm:inline",
                active ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {s.label}
            </span>
            {idx < STEPS.length - 1 && (
              <div
                className={cn(
                  "ml-1 h-px flex-1",
                  done ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- Step 1 ---------- */

function Step1Form({
  defaultValues,
  onNext,
}: {
  defaultValues?: Step1;
  onNext: (v: Step1) => void;
}) {
  const form = useForm<Step1>({
    resolver: zodResolver(step1Schema),
    defaultValues: defaultValues ?? {
      statusProducao: undefined as unknown as Step1["statusProducao"],
      nomeCompleto: "",
      email: "",
      area: "",
      ferramenta: undefined as unknown as Step1["ferramenta"],
      outraFerramenta: "",
      emEquipe: undefined as unknown as Step1["emEquipe"],
      participantes: [],
    },
  });

  const statusProducao = form.watch("statusProducao");
  const ferramenta = form.watch("ferramenta");
  const emEquipe = form.watch("emEquipe");
  const participantes = form.watch("participantes") ?? [];
  const [novoParticipante, setNovoParticipante] = useState("");

  const blocked = statusProducao === "desenvolvimento" || statusProducao === "pronto_sem_uso";

  function adicionarParticipante() {
    const trimmed = novoParticipante.trim();
    const parsed = emailSchema.safeParse(trimmed);
    if (!parsed.success) {
      toast.error("E-mail inválido");
      return;
    }
    if (participantes.includes(trimmed)) {
      toast.error("E-mail já adicionado");
      return;
    }
    form.setValue("participantes", [...participantes, trimmed], {
      shouldValidate: true,
    });
    setNovoParticipante("");
  }

  function removerParticipante(email: string) {
    form.setValue(
      "participantes",
      participantes.filter((e) => e !== email),
      { shouldValidate: true },
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => onNext(v))}
        className="space-y-6"
      >
        <h2 className="text-lg font-semibold">Etapa 1 — Responsável</h2>

        <FormField
          control={form.control}
          name="statusProducao"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Projeto já está em produção? *</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                >
                  {STATUS_PRODUCAO.map((opt) => (
                    <label
                      key={opt.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm",
                        field.value === opt.value && "border-primary bg-primary/5",
                      )}
                    >
                      <RadioGroupItem value={opt.value} />
                      {opt.label}
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {blocked && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Submissão bloqueada</AlertTitle>
            <AlertDescription>
              Apenas projetos que já estão em produção podem ser submetidos.
              Volte quando o fluxo estiver operando.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="nomeCompleto"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome completo *</FormLabel>
                <FormControl>
                  <Input placeholder="Seu nome" maxLength={120} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail *</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="voce@empresa.com" maxLength={255} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="area"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Área *</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: TI, RH, Operações" maxLength={80} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="ferramenta"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ferramenta utilizada *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {FERRAMENTAS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {ferramenta === "Outros" && (
          <FormField
            control={form.control}
            name="outraFerramenta"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Qual ferramenta? *</FormLabel>
                <FormControl>
                  <Input placeholder="Nome da ferramenta" maxLength={80} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="emEquipe"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Projeto desenvolvido em equipe? *</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="flex gap-3"
                >
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm",
                      field.value === "sim" && "border-primary bg-primary/5",
                    )}
                  >
                    <RadioGroupItem value="sim" /> Sim
                  </label>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm",
                      field.value === "nao" && "border-primary bg-primary/5",
                    )}
                  >
                    <RadioGroupItem value="nao" /> Não
                  </label>
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {emEquipe === "sim" && (
          <div className="space-y-2">
            <Label>Participantes (e-mails) *</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="participante@empresa.com"
                value={novoParticipante}
                onChange={(e) => setNovoParticipante(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    adicionarParticipante();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={adicionarParticipante}>
                <Plus className="h-4 w-4" /> Adicionar
              </Button>
            </div>
            {participantes.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {participantes.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1 text-xs"
                  >
                    {p}
                    <button
                      type="button"
                      onClick={() => removerParticipante(p)}
                      className="ml-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {form.formState.errors.participantes && (
              <p className="text-[0.8rem] font-medium text-destructive">
                {form.formState.errors.participantes.message as string}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={blocked}>
            Próximo <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

/* ---------- Step 2 ---------- */

function Step2Form({
  defaultValues,
  arquivo,
  setArquivo,
  arquivoErro,
  setArquivoErro,
  onBack,
  onNext,
}: {
  defaultValues?: Step2;
  arquivo: File | null;
  setArquivo: (f: File | null) => void;
  arquivoErro: string | null;
  setArquivoErro: (e: string | null) => void;
  onBack: () => void;
  onNext: (v: Step2) => void;
}) {
  const form = useForm<Step2>({
    resolver: zodResolver(step2Schema),
    defaultValues: defaultValues ?? {
      nomeProjeto: "",
      dataCriacao: "",
      descricao: "",
    },
  });

  const todayStr = new Date().toISOString().split("T")[0];

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
    if (!ACCEPTED_DOC_EXT.includes(ext)) {
      setArquivoErro(`Formato não permitido. Use: ${ACCEPTED_DOC_EXT.join(", ")}`);
      return;
    }
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setArquivoErro(`Arquivo excede ${MAX_FILE_MB}MB`);
      return;
    }
    setArquivo(f);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)} className="space-y-6">
        <h2 className="text-lg font-semibold">Etapa 2 — Projeto</h2>

        <FormField
          control={form.control}
          name="nomeProjeto"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do projeto *</FormLabel>
              <FormControl>
                <Input placeholder="Nome exato do fluxo (se n8n)" maxLength={160} {...field} />
              </FormControl>
              <FormDescription>
                Para projetos em n8n, use o nome exato do fluxo principal.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="dataCriacao"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Data de criação *</FormLabel>
              <FormControl>
                <Input type="date" max={todayStr} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="descricao"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descrição do projeto *</FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  placeholder="Descreva o objetivo, o problema resolvido e o fluxo geral."
                  maxLength={4000}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-2">
          <Label>Documentação do projeto *</Label>
          <label
            htmlFor="doc-upload"
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input px-4 py-8 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent/30"
          >
            <Upload className="mb-2 h-6 w-6" />
            {arquivo ? (
              <>
                <span className="font-medium text-foreground">{arquivo.name}</span>
                <span className="text-xs">
                  {(arquivo.size / 1024).toFixed(0)} KB · clique para trocar
                </span>
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  Clique para selecionar
                </span>
                <span className="text-xs">
                  PDF, DOCX, DOC, TXT ou MD (máx. {MAX_FILE_MB}MB)
                </span>
              </>
            )}
          </label>
          <input
            id="doc-upload"
            type="file"
            accept={ACCEPTED_DOC_EXT.join(",")}
            className="hidden"
            onChange={onFile}
          />
          {arquivoErro && (
            <p className="text-[0.8rem] font-medium text-destructive">{arquivoErro}</p>
          )}
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <Button type="submit">
            Próximo <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

/* ---------- Step 3 ---------- */

function Step3Form({
  defaultValues,
  onBack,
  onNext,
}: {
  defaultValues?: Step3;
  onBack: () => void;
  onNext: (v: Step3) => void;
}) {
  const form = useForm<Step3>({
    resolver: zodResolver(step3Schema),
    defaultValues: defaultValues ?? {
      solucaoSimilarPaga: undefined as unknown as Step3["solucaoSimilarPaga"],
      savingHoras: undefined as unknown as number,
      savingReais: undefined as unknown as number,
      tipoSaving: undefined as unknown as Step3["tipoSaving"],
    },
  });

  const horas = Number(form.watch("savingHoras")) || 0;
  const reais = Number(form.watch("savingReais")) || 0;
  const valorHora = useMemo(() => (horas > 0 ? reais / horas : 0), [horas, reais]);
  const aviso = valorHora > 60;
  const bloqueio = horas > 0 && reais > 0 && valorHora < 8;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)} className="space-y-6">
        <h2 className="text-lg font-semibold">Etapa 3 — Impacto</h2>

        <FormField
          control={form.control}
          name="solucaoSimilarPaga"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Existe solução similar paga no mercado? *</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="flex flex-wrap gap-3"
                >
                  {[
                    { v: "sim", l: "Sim" },
                    { v: "nao", l: "Não" },
                    { v: "nao_sei", l: "Não sei" },
                  ].map((o) => (
                    <label
                      key={o.v}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm",
                        field.value === o.v && "border-primary bg-primary/5",
                      )}
                    >
                      <RadioGroupItem value={o.v} /> {o.l}
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="savingHoras"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Saving mensal (horas) *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ex: 20"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="savingReais"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Saving mensal (R$) *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Ex: 800"
                    {...field}
                    value={field.value ?? ""}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="tipoSaving"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tipo de saving *</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="flex gap-3"
                >
                  {[
                    { v: "mensal", l: "Mensal (recorrente)" },
                    { v: "pontual", l: "Pontual" },
                  ].map((o) => (
                    <label
                      key={o.v}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm",
                        field.value === o.v && "border-primary bg-primary/5",
                      )}
                    >
                      <RadioGroupItem value={o.v} /> {o.l}
                    </label>
                  ))}
                </RadioGroup>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Valor por hora calculado
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {valorHora > 0
              ? valorHora.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })
              : "—"}
          </div>
          {bloqueio && (
            <Alert variant="destructive" className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Valor/hora abaixo de R$ 8 — envio bloqueado. Revise os dados.
              </AlertDescription>
            </Alert>
          )}
          {aviso && !bloqueio && (
            <Alert className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Valor/hora acima de R$ 60 — verifique se os números estão corretos.
                O envio segue permitido.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <Button type="submit" disabled={bloqueio}>
            Próximo <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}

/* ---------- Step 4 ---------- */

function Step4Form({
  valorHora,
  submitting,
  onBack,
  onSubmit,
}: {
  valorHora: number;
  submitting: boolean;
  onBack: () => void;
  onSubmit: (v: Step4) => void;
}) {
  const form = useForm<Step4>({
    resolver: zodResolver(step4Schema),
    defaultValues: { memorial: "" },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <h2 className="text-lg font-semibold">Etapa 4 — Memorial de cálculo</h2>
        <p className="text-sm text-muted-foreground">
          Descreva como o saving foi calculado: frequência da atividade, tempo
          gasto por execução e premissas. Valor/hora atual:{" "}
          <strong>
            {valorHora.toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            })}
          </strong>
          .
        </p>

        <FormField
          control={form.control}
          name="memorial"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Memorial de cálculo *</FormLabel>
              <FormControl>
                <Textarea
                  rows={8}
                  placeholder="Ex: A atividade era executada 4x ao dia, 22 dias úteis, levando ~15min cada. Custo médio/hora do colaborador: R$ 35..."
                  maxLength={6000}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={submitting}
          >
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Enviando...
              </>
            ) : (
              <>
                <Send className="mr-1 h-4 w-4" /> Enviar projeto
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
