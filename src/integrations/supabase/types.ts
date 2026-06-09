export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admins: {
        Row: {
          created_at: string | null
          email: string
          id: string
          nome: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          nome?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          nome?: string | null
        }
        Relationships: []
      }
      areas: {
        Row: {
          created_at: string | null
          id: string
          nome: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          nome: string
        }
        Update: {
          created_at?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          options: Json | null
          projeto_id: string
          role: string
          selected_option: number | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          options?: Json | null
          projeto_id: string
          role: string
          selected_option?: number | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          options?: Json | null
          projeto_id?: string
          role?: string
          selected_option?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes: {
        Row: {
          chave: string
          descricao: string | null
          id: string
          updated_at: string | null
          updated_by: string | null
          valor: Json
        }
        Insert: {
          chave: string
          descricao?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
          valor: Json
        }
        Update: {
          chave?: string
          descricao?: string | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
          valor?: Json
        }
        Relationships: []
      }
      documentacao: {
        Row: {
          conteudo: Json
          created_at: string | null
          id: string
          projeto_id: string
          updated_at: string | null
          versao: number | null
        }
        Insert: {
          conteudo: Json
          created_at?: string | null
          id?: string
          projeto_id: string
          updated_at?: string | null
          versao?: number | null
        }
        Update: {
          conteudo?: Json
          created_at?: string | null
          id?: string
          projeto_id?: string
          updated_at?: string | null
          versao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documentacao_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: true
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos: {
        Row: {
          area: string | null
          area_id: string | null
          chat_completo: boolean | null
          created_at: string | null
          custo_externo_mensal: number | null
          data_criacao_projeto: string | null
          descricao_breve: string | null
          escopo: string | null
          ferramenta: string
          id: string
          membros: Json | null
          memorial_calculo: string | null
          nome: string | null
          responsavel_email: string
          responsavel_nome: string
          saving_horas: number | null
          saving_reais: number | null
          servico_externo: string | null
          status: Database["public"]["Enums"]["projeto_status"] | null
          submitted_at: string | null
          tipo_projeto: string | null
          tipo_saving: string | null
          tipos_projeto: string[] | null
          updated_at: string | null
          validated_at: string | null
          validated_by: string | null
        }
        Insert: {
          area?: string | null
          area_id?: string | null
          chat_completo?: boolean | null
          created_at?: string | null
          custo_externo_mensal?: number | null
          data_criacao_projeto?: string | null
          descricao_breve?: string | null
          escopo?: string | null
          ferramenta: string
          id?: string
          membros?: Json | null
          memorial_calculo?: string | null
          nome?: string | null
          responsavel_email: string
          responsavel_nome: string
          saving_horas?: number | null
          saving_reais?: number | null
          servico_externo?: string | null
          status?: Database["public"]["Enums"]["projeto_status"] | null
          submitted_at?: string | null
          tipo_projeto?: string | null
          tipo_saving?: string | null
          tipos_projeto?: string[] | null
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Update: {
          area?: string | null
          area_id?: string | null
          chat_completo?: boolean | null
          created_at?: string | null
          custo_externo_mensal?: number | null
          data_criacao_projeto?: string | null
          descricao_breve?: string | null
          escopo?: string | null
          ferramenta?: string
          id?: string
          membros?: Json | null
          memorial_calculo?: string | null
          nome?: string | null
          responsavel_email?: string
          responsavel_nome?: string
          saving_horas?: number | null
          saving_reais?: number | null
          servico_externo?: string | null
          status?: Database["public"]["Enums"]["projeto_status"] | null
          submitted_at?: string | null
          tipo_projeto?: string | null
          tipo_saving?: string | null
          tipos_projeto?: string[] | null
          updated_at?: string | null
          validated_at?: string | null
          validated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projetos_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "areas"
            referencedColumns: ["id"]
          },
        ]
      }
      validacoes: {
        Row: {
          admin_email: string | null
          created_at: string | null
          criterios: Json | null
          email_enviado: boolean | null
          id: string
          parecer: string
          projeto_id: string
          resultado: string
        }
        Insert: {
          admin_email?: string | null
          created_at?: string | null
          criterios?: Json | null
          email_enviado?: boolean | null
          id?: string
          parecer: string
          projeto_id: string
          resultado: string
        }
        Update: {
          admin_email?: string | null
          created_at?: string | null
          criterios?: Json | null
          email_enviado?: boolean | null
          id?: string
          parecer?: string
          projeto_id?: string
          resultado?: string
        }
        Relationships: [
          {
            foreignKeyName: "validacoes_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      projeto_status: "rascunho" | "em_validacao" | "validado" | "rejeitado" | "aprovado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      projeto_status: ["rascunho", "em_validacao", "validado", "rejeitado", "aprovado"],
    },
  },
} as const
