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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      lessons: {
        Row: {
          avg_score: number
          captain_id: string
          captain_name: string
          created_at: string
          crew_count: number
          description: string | null
          difficulty: string
          duration: number | null
          id: string
          reference_pattern: Json | null
          status: string
          title: string
          updated_at: string
          video_url: string | null
          weight_eyes: number
          weight_motion: number
          weight_sound: number
        }
        Insert: {
          avg_score?: number
          captain_id: string
          captain_name?: string
          created_at?: string
          crew_count?: number
          description?: string | null
          difficulty?: string
          duration?: number | null
          id?: string
          reference_pattern?: Json | null
          status?: string
          title?: string
          updated_at?: string
          video_url?: string | null
          weight_eyes?: number
          weight_motion?: number
          weight_sound?: number
        }
        Update: {
          avg_score?: number
          captain_id?: string
          captain_name?: string
          created_at?: string
          crew_count?: number
          description?: string | null
          difficulty?: string
          duration?: number | null
          id?: string
          reference_pattern?: Json | null
          status?: string
          title?: string
          updated_at?: string
          video_url?: string | null
          weight_eyes?: number
          weight_motion?: number
          weight_sound?: number
        }
        Relationships: []
      }
      module_test_results: {
        Row: {
          breakdown: Json | null
          compare_file_url: string
          compare_pattern: Json | null
          created_at: string
          feedback: string[] | null
          file_name: string
          id: string
          reference_pattern: Json | null
          score: number
          test_id: string
        }
        Insert: {
          breakdown?: Json | null
          compare_file_url: string
          compare_pattern?: Json | null
          created_at?: string
          feedback?: string[] | null
          file_name?: string
          id?: string
          reference_pattern?: Json | null
          score?: number
          test_id: string
        }
        Update: {
          breakdown?: Json | null
          compare_file_url?: string
          compare_pattern?: Json | null
          created_at?: string
          feedback?: string[] | null
          file_name?: string
          id?: string
          reference_pattern?: Json | null
          score?: number
          test_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_test_results_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: false
            referencedRelation: "module_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      module_tests: {
        Row: {
          created_at: string
          id: string
          lesson_id: string | null
          method_id: string
          module_id: string
          reference_file_url: string
          reference_source: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lesson_id?: string | null
          method_id: string
          module_id: string
          reference_file_url: string
          reference_source?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lesson_id?: string | null
          method_id?: string
          module_id?: string
          reference_file_url?: string
          reference_source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "module_tests_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          email: string
          id: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          email?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      sound_advanced_analyses: {
        Row: {
          analysis_version: string
          created_at: string
          elongation: Json
          file_url: string | null
          id: string
          intonation: Json
          label: string | null
          llm_payload: Json | null
          pauses: Json
          phrasing: Json
          reference_or_attempt: string
          rhythm: Json
          summary: Json
          test_result_id: string
          visualization: Json | null
        }
        Insert: {
          analysis_version?: string
          created_at?: string
          elongation?: Json
          file_url?: string | null
          id?: string
          intonation?: Json
          label?: string | null
          llm_payload?: Json | null
          pauses?: Json
          phrasing?: Json
          reference_or_attempt: string
          rhythm?: Json
          summary?: Json
          test_result_id: string
          visualization?: Json | null
        }
        Update: {
          analysis_version?: string
          created_at?: string
          elongation?: Json
          file_url?: string | null
          id?: string
          intonation?: Json
          label?: string | null
          llm_payload?: Json | null
          pauses?: Json
          phrasing?: Json
          reference_or_attempt?: string
          rhythm?: Json
          summary?: Json
          test_result_id?: string
          visualization?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sound_advanced_analyses_test_result_id_fkey"
            columns: ["test_result_id"]
            isOneToOne: false
            referencedRelation: "module_test_results"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          captain_id: string
          consciousness_percent: number
          created_at: string
          crew_id: string
          duration: number | null
          id: string
          lesson_id: string
          level: string
          scores: Json | null
          started_at: string
        }
        Insert: {
          captain_id: string
          consciousness_percent?: number
          created_at?: string
          crew_id: string
          duration?: number | null
          id?: string
          lesson_id: string
          level?: string
          scores?: Json | null
          started_at?: string
        }
        Update: {
          captain_id?: string
          consciousness_percent?: number
          created_at?: string
          crew_id?: string
          duration?: number | null
          id?: string
          lesson_id?: string
          level?: string
          scores?: Json | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
        ]
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "captain" | "crew" | "admin"
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
      app_role: ["captain", "crew", "admin"],
    },
  },
} as const
