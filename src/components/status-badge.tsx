import {
  Clock,
  CheckCircle2,
  RotateCcw,
  XCircle,
  FileText,
} from "lucide-react";

const STATUS_CONFIG: Record<
  string,
  { label: string; bg: string; border: string; color: string; icon: React.ReactNode }
> = {
  rascunho: {
    label: "Rascunho",
    bg: "rgba(0,0,0,0.03)",
    border: "rgba(0,0,0,0.1)",
    color: "#6b7280",
    icon: <FileText className="h-3.5 w-3.5" />,
  },
  em_validacao: {
    label: "Em análise",
    bg: "rgba(0,89,169,0.06)",
    border: "rgba(0,89,169,0.15)",
    color: "var(--go-blue)",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  aprovado: {
    label: "Aprovado",
    bg: "rgba(34,197,94,0.06)",
    border: "rgba(34,197,94,0.18)",
    color: "#16a34a",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  validado: {
    label: "Validado",
    bg: "rgba(34,197,94,0.06)",
    border: "rgba(34,197,94,0.18)",
    color: "#16a34a",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  rejeitado: {
    label: "Reenvio Pendente",
    bg: "rgba(215,219,0,0.08)",
    border: "rgba(215,219,0,0.25)",
    color: "#8a7d00",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
  },
};

export function StatusBadge({ status }: { status: string | null }) {
  const cfg = STATUS_CONFIG[status ?? ""] ?? {
    label: status ?? "—",
    bg: "rgba(0,0,0,0.03)",
    border: "rgba(0,0,0,0.1)",
    color: "#6b7280",
    icon: <XCircle className="h-3.5 w-3.5" />,
  };
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}
