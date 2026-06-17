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
      advances: {
        Row: {
          advance_date: string
          amount: number
          client_id: string
          created_at: string
          id: string
          invoice_id: string | null
          notes: string | null
          purchase_invoice_id: string | null
          purchase_order_id: string | null
          reference: string | null
          side: string
          status: string
          updated_at: string
        }
        Insert: {
          advance_date?: string
          amount: number
          client_id: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          purchase_invoice_id?: string | null
          purchase_order_id?: string | null
          reference?: string | null
          side: string
          status?: string
          updated_at?: string
        }
        Update: {
          advance_date?: string
          amount?: number
          client_id?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          notes?: string | null
          purchase_invoice_id?: string | null
          purchase_order_id?: string | null
          reference?: string | null
          side?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "advances_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "advances_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          client_id: string | null
          created_at: string
          debtor_id: string | null
          id: string
          invoice_id: string | null
          is_read: boolean
          message: string
          severity: Database["public"]["Enums"]["alert_severity"]
          type: Database["public"]["Enums"]["alert_type"]
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          debtor_id?: string | null
          id?: string
          invoice_id?: string | null
          is_read?: boolean
          message: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          type: Database["public"]["Enums"]["alert_type"]
        }
        Update: {
          client_id?: string | null
          created_at?: string
          debtor_id?: string | null
          id?: string
          invoice_id?: string | null
          is_read?: boolean
          message?: string
          severity?: Database["public"]["Enums"]["alert_severity"]
          type?: Database["public"]["Enums"]["alert_type"]
        }
        Relationships: [
          {
            foreignKeyName: "alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_debtor_id_fkey"
            columns: ["debtor_id"]
            isOneToOne: false
            referencedRelation: "debtors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      debtors: {
        Row: {
          address_line: string | null
          city: string | null
          contact_designation: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          credit_limit: number
          id: string
          industry: string | null
          name: string
          notes: string | null
          payment_terms_days: number
          phone: string | null
          postal_code: string | null
          risk_score: number
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          contact_designation?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          credit_limit?: number
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          postal_code?: string | null
          risk_score?: number
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line?: string | null
          city?: string | null
          contact_designation?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          credit_limit?: number
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          postal_code?: string | null
          risk_score?: number
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          client_id: string
          created_at: string
          description: string | null
          documents: Json
          expense_date: string
          id: string
          invoice_id: string | null
          purchase_invoice_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          category: string
          client_id: string
          created_at?: string
          description?: string | null
          documents?: Json
          expense_date?: string
          id?: string
          invoice_id?: string | null
          purchase_invoice_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          client_id?: string
          created_at?: string
          description?: string | null
          documents?: Json
          expense_date?: string
          id?: string
          invoice_id?: string | null
          purchase_invoice_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          advance_rate: number
          advance_received_date: string | null
          amount: number
          amount_received: number | null
          client_id: string
          created_at: string
          debtor_id: string
          documents: Json
          due_date: string
          fee_rate: number
          id: string
          invoice_number: string
          issue_date: string
          late_days: number | null
          noa_comments: string | null
          noa_responded_at: string | null
          noa_sent_at: string | null
          noa_status: Database["public"]["Enums"]["noa_status"]
          noa_token: string | null
          paid_date: string | null
          po_amount: number | null
          po_date: string | null
          po_number: string | null
          purchase_invoice_id: string | null
          purchase_order_id: string | null
          receipt_date: string | null
          short_payment: number | null
          status: Database["public"]["Enums"]["invoice_status"]
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          advance_rate?: number
          advance_received_date?: string | null
          amount: number
          amount_received?: number | null
          client_id: string
          created_at?: string
          debtor_id: string
          documents?: Json
          due_date: string
          fee_rate?: number
          id?: string
          invoice_number: string
          issue_date?: string
          late_days?: number | null
          noa_comments?: string | null
          noa_responded_at?: string | null
          noa_sent_at?: string | null
          noa_status?: Database["public"]["Enums"]["noa_status"]
          noa_token?: string | null
          paid_date?: string | null
          po_amount?: number | null
          po_date?: string | null
          po_number?: string | null
          purchase_invoice_id?: string | null
          purchase_order_id?: string | null
          receipt_date?: string | null
          short_payment?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          advance_rate?: number
          advance_received_date?: string | null
          amount?: number
          amount_received?: number | null
          client_id?: string
          created_at?: string
          debtor_id?: string
          documents?: Json
          due_date?: string
          fee_rate?: number
          id?: string
          invoice_number?: string
          issue_date?: string
          late_days?: number | null
          noa_comments?: string | null
          noa_responded_at?: string | null
          noa_sent_at?: string | null
          noa_status?: Database["public"]["Enums"]["noa_status"]
          noa_token?: string | null
          paid_date?: string | null
          po_amount?: number | null
          po_date?: string | null
          po_number?: string | null
          purchase_invoice_id?: string | null
          purchase_order_id?: string | null
          receipt_date?: string | null
          short_payment?: number | null
          status?: Database["public"]["Enums"]["invoice_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_debtor_id_fkey"
            columns: ["debtor_id"]
            isOneToOne: false
            referencedRelation: "debtors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          company_name: string
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          company_name?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          company_name?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_invoices: {
        Row: {
          advance_paid_date: string | null
          advance_rate: number
          amount: number
          client_id: string
          created_at: string
          documents: Json
          due_date: string | null
          funded_date: string | null
          id: string
          invoice_number: string
          issue_date: string
          notes: string | null
          paid_date: string | null
          po_amount: number | null
          po_date: string | null
          po_number: string | null
          purchase_order_id: string | null
          status: Database["public"]["Enums"]["purchase_invoice_status"]
          updated_at: string
          vendor_id: string
        }
        Insert: {
          advance_paid_date?: string | null
          advance_rate?: number
          amount: number
          client_id: string
          created_at?: string
          documents?: Json
          due_date?: string | null
          funded_date?: string | null
          id?: string
          invoice_number: string
          issue_date?: string
          notes?: string | null
          paid_date?: string | null
          po_amount?: number | null
          po_date?: string | null
          po_number?: string | null
          purchase_order_id?: string | null
          status?: Database["public"]["Enums"]["purchase_invoice_status"]
          updated_at?: string
          vendor_id: string
        }
        Update: {
          advance_paid_date?: string | null
          advance_rate?: number
          amount?: number
          client_id?: string
          created_at?: string
          documents?: Json
          due_date?: string | null
          funded_date?: string | null
          id?: string
          invoice_number?: string
          issue_date?: string
          notes?: string | null
          paid_date?: string | null
          po_amount?: number | null
          po_date?: string | null
          po_number?: string | null
          purchase_order_id?: string | null
          status?: Database["public"]["Enums"]["purchase_invoice_status"]
          updated_at?: string
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_invoices_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_invoices_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount: number
          client_id: string
          created_at: string
          currency: string
          debtor_id: string | null
          expected_date: string | null
          id: string
          issue_date: string
          notes: string | null
          po_number: string
          proforma_date: string | null
          proforma_funded_amount: number | null
          proforma_funded_at: string | null
          proforma_funded_by: string | null
          proforma_funding_reference: string | null
          proforma_number: string | null
          proforma_review_comments: string | null
          proforma_reviewed_at: string | null
          proforma_reviewed_by: string | null
          proforma_status: string
          side: string
          status: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          amount?: number
          client_id: string
          created_at?: string
          currency?: string
          debtor_id?: string | null
          expected_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          po_number: string
          proforma_date?: string | null
          proforma_funded_amount?: number | null
          proforma_funded_at?: string | null
          proforma_funded_by?: string | null
          proforma_funding_reference?: string | null
          proforma_number?: string | null
          proforma_review_comments?: string | null
          proforma_reviewed_at?: string | null
          proforma_reviewed_by?: string | null
          proforma_status?: string
          side: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string
          currency?: string
          debtor_id?: string | null
          expected_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          po_number?: string
          proforma_date?: string | null
          proforma_funded_amount?: number | null
          proforma_funded_at?: string | null
          proforma_funded_by?: string | null
          proforma_funding_reference?: string | null
          proforma_number?: string | null
          proforma_review_comments?: string | null
          proforma_reviewed_at?: string | null
          proforma_reviewed_by?: string | null
          proforma_status?: string
          side?: string
          status?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_debtor_id_fkey"
            columns: ["debtor_id"]
            isOneToOne: false
            referencedRelation: "debtors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          client_id: string
          created_at: string
          direction: string
          id: string
          invoice_id: string | null
          item_name: string
          movement_date: string
          notes: string | null
          purchase_invoice_id: string | null
          quantity: number
          sku: string | null
          unit: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          direction: string
          id?: string
          invoice_id?: string | null
          item_name: string
          movement_date?: string
          notes?: string | null
          purchase_invoice_id?: string | null
          quantity: number
          sku?: string | null
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          direction?: string
          id?: string
          invoice_id?: string | null
          item_name?: string
          movement_date?: string
          notes?: string | null
          purchase_invoice_id?: string | null
          quantity?: number
          sku?: string | null
          unit?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_purchase_invoice_id_fkey"
            columns: ["purchase_invoice_id"]
            isOneToOne: false
            referencedRelation: "purchase_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          advance_rate: number
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          credit_limit: number
          fee_rate: number
          id: string
          industry: string | null
          notes: string | null
          status: Database["public"]["Enums"]["supplier_status"]
          updated_at: string
          address_line: string | null
          address_line2: string | null
          city: string | null
          contact_designation: string | null
          country: string | null
          payment_terms_days: number
          phone: string | null
          postal_code: string | null
          website: string | null
        }
        Insert: {
          advance_rate?: number
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          fee_rate?: number
          id?: string
          industry?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["supplier_status"]
          updated_at?: string
          address_line?: string | null
          address_line2?: string | null
          city?: string | null
          contact_designation?: string | null
          country?: string | null
          payment_terms_days?: number
          phone?: string | null
          postal_code?: string | null
          website?: string | null
        }
        Update: {
          advance_rate?: number
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit?: number
          fee_rate?: number
          id?: string
          industry?: string | null
          notes?: string | null
          status?: Database["public"]["Enums"]["supplier_status"]
          updated_at?: string
          address_line?: string | null
          address_line2?: string | null
          city?: string | null
          contact_designation?: string | null
          country?: string | null
          payment_terms_days?: number
          phone?: string | null
          postal_code?: string | null
          website?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vendors: {
        Row: {
          address_line: string | null
          city: string | null
          client_id: string
          contact_designation: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country: string | null
          created_at: string
          id: string
          industry: string | null
          name: string
          notes: string | null
          payment_terms_days: number
          phone: string | null
          postal_code: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          client_id: string
          contact_designation?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          name: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address_line?: string | null
          city?: string | null
          client_id?: string
          contact_designation?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country?: string | null
          created_at?: string
          id?: string
          industry?: string | null
          name?: string
          notes?: string | null
          payment_terms_days?: number
          phone?: string | null
          postal_code?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_noa_invoice: {
        Args: { _token: string }
        Returns: {
          amount: number
          client_company: string
          debtor_contact_email: string
          debtor_contact_name: string
          debtor_name: string
          due_date: string
          id: string
          invoice_number: string
          issue_date: string
          noa_comments: string
          noa_status: Database["public"]["Enums"]["noa_status"]
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      respond_noa: {
        Args: { _comments?: string; _decision: string; _token: string }
        Returns: boolean
      }
    }
    Enums: {
      alert_severity: "info" | "warning" | "critical"
      alert_type:
        | "overdue"
        | "credit_limit"
        | "risk_change"
        | "large_invoice"
        | "payment_received"
      app_role: "client" | "factor_admin" | "treasury" | "checker"
      invoice_status:
        | "pending"
        | "approved"
        | "advanced"
        | "paid"
        | "overdue"
        | "rejected"
        | "funded"
      noa_status: "not_sent" | "sent" | "accepted" | "rejected" | "commented"
      purchase_invoice_status:
        | "pending"
        | "approved"
        | "paid"
        | "overdue"
        | "disputed"
        | "advanced"
        | "funded"
      supplier_status: "prospect" | "active" | "suspended" | "offboarded"
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
      alert_severity: ["info", "warning", "critical"],
      alert_type: [
        "overdue",
        "credit_limit",
        "risk_change",
        "large_invoice",
        "payment_received",
      ],
      app_role: ["client", "factor_admin", "treasury", "checker"],
      invoice_status: [
        "pending",
        "approved",
        "advanced",
        "paid",
        "overdue",
        "rejected",
        "funded",
      ],
      noa_status: ["not_sent", "sent", "accepted", "rejected", "commented"],
      purchase_invoice_status: [
        "pending",
        "approved",
        "paid",
        "overdue",
        "disputed",
        "advanced",
        "funded",
      ],
      supplier_status: ["prospect", "active", "suspended", "offboarded"],
    },
  },
} as const
