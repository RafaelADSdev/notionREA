export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      document_heads: {
        Row: {
          compacted_through: number;
          page_id: string;
          projection: NonNullable<Json>;
          revision: number;
          snapshot: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          compacted_through?: number;
          page_id: string;
          projection?: NonNullable<Json>;
          revision?: number;
          snapshot?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          compacted_through?: number;
          page_id?: string;
          projection?: NonNullable<Json>;
          revision?: number;
          snapshot?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_heads_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: true;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      document_updates: {
        Row: {
          actor_id: string;
          compacted: boolean;
          created_at: string;
          operation_id: string;
          page_id: string;
          payload: string | null;
          payload_hash: string;
          revision: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id: string;
          compacted?: boolean;
          created_at?: string;
          operation_id: string;
          page_id: string;
          payload?: string | null;
          payload_hash: string;
          revision: number;
          workspace_id: string;
        };
        Update: {
          actor_id?: string;
          compacted?: boolean;
          created_at?: string;
          operation_id?: string;
          page_id?: string;
          payload?: string | null;
          payload_hash?: string;
          revision?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_updates_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "document_heads";
            referencedColumns: ["page_id", "workspace_id"];
          },
        ];
      };
      page_favorites: {
        Row: {
          created_at: string;
          page_id: string;
          user_id: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          page_id: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          page_id?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_favorites_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "page_favorites_workspace_id_user_id_fkey";
            columns: ["workspace_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "workspace_members";
            referencedColumns: ["workspace_id", "user_id"];
          },
        ];
      };
      page_files: {
        Row: {
          actual_size: number | null;
          created_at: string;
          expected_size: number;
          finalized_at: string | null;
          id: string;
          mime_type: string;
          object_path: string;
          original_name: string;
          page_id: string;
          sha256: string | null;
          status: string;
          uploaded_by: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          actual_size?: number | null;
          created_at?: string;
          expected_size: number;
          finalized_at?: string | null;
          id?: string;
          mime_type: string;
          object_path: string;
          original_name: string;
          page_id: string;
          sha256?: string | null;
          status?: string;
          uploaded_by: string;
          workspace_id: string;
        };
        Update: {
          actual_size?: number | null;
          created_at?: string;
          expected_size?: number;
          finalized_at?: string | null;
          id?: string;
          mime_type?: string;
          object_path?: string;
          original_name?: string;
          page_id?: string;
          sha256?: string | null;
          status?: string;
          uploaded_by?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_files_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      page_grants: {
        Row: {
          page_id: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          page_id: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          page_id?: string;
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_grants_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "page_grants_workspace_id_user_id_fkey";
            columns: ["workspace_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "workspace_members";
            referencedColumns: ["workspace_id", "user_id"];
          },
        ];
      };
      pages: {
        Row: {
          cover_file_id: string | null;
          created_at: string;
          created_by: string;
          deleted_at: string | null;
          deleted_batch_id: string | null;
          deleted_by: string | null;
          deleted_parent_id: string | null;
          deleted_position: string | null;
          icon: string;
          id: string;
          owner_id: string;
          parent_id: string | null;
          position: string;
          request_hash: string;
          request_id: string;
          restricted: boolean;
          revision: number;
          search_vector: unknown;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          cover_file_id?: string | null;
          created_at?: string;
          created_by: string;
          deleted_at?: string | null;
          deleted_batch_id?: string | null;
          deleted_by?: string | null;
          deleted_parent_id?: string | null;
          deleted_position?: string | null;
          icon?: string;
          id?: string;
          owner_id: string;
          parent_id?: string | null;
          position?: string;
          request_hash?: string;
          request_id?: string;
          restricted?: boolean;
          revision?: number;
          search_vector?: unknown;
          title?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          cover_file_id?: string | null;
          created_at?: string;
          created_by?: string;
          deleted_at?: string | null;
          deleted_batch_id?: string | null;
          deleted_by?: string | null;
          deleted_parent_id?: string | null;
          deleted_position?: string | null;
          icon?: string;
          id?: string;
          owner_id?: string;
          parent_id?: string | null;
          position?: string;
          request_hash?: string;
          request_id?: string;
          restricted?: boolean;
          revision?: number;
          search_vector?: unknown;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pages_cover_file_fk";
            columns: ["cover_file_id", "workspace_id", "id"];
            isOneToOne: false;
            referencedRelation: "page_files";
            referencedColumns: ["id", "workspace_id", "page_id"];
          },
          {
            foreignKeyName: "pages_parent_id_workspace_id_fkey";
            columns: ["parent_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "pages_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          accepted_at: string | null;
          created_at: string;
          created_by: string;
          email: string;
          expires_at: string;
          id: string;
          revoked_at: string | null;
          token_hash: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          created_at?: string;
          created_by: string;
          email: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          token_hash: string;
          workspace_id: string;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string;
          created_by?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          revoked_at?: string | null;
          token_hash?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          name: string;
          request_hash: string;
          request_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          name: string;
          request_hash?: string;
          request_id?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          name?: string;
          request_hash?: string;
          request_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: string };
      clear_page_cover: { Args: { p_expected_revision: number; p_page_id: string }; Returns: number };
      commit_document: {
        Args: {
          p_actor_id: string;
          p_expected_revision: number;
          p_hash: string;
          p_operation_id: string;
          p_page_id: string;
          p_payload: string;
          p_projection: Json;
          p_snapshot: string;
        };
        Returns: number;
      };
      compact_document: {
        Args: { p_expected_revision: number; p_page_id: string; p_snapshot: string };
        Returns: number;
      };
      create_invite: {
        Args: { p_email: string; p_token_hash: string; p_workspace_id: string };
        Returns: string;
      };
      create_page: {
        Args: { p_parent_id?: string; p_request_id?: string; p_title?: string; p_workspace_id: string };
        Returns: string;
      };
      create_workspace: { Args: { p_name: string; p_request_id: string }; Returns: string };
      finalize_page_cover: {
        Args: {
          p_actor_id: string;
          p_actual_size: number;
          p_expected_revision: number;
          p_file_id: string;
          p_sha256: string;
        };
        Returns: number;
      };
      get_page_metadata: { Args: { p_page_id: string; p_workspace_id: string }; Returns: Json };
      get_page_role: { Args: { p_page_id: string }; Returns: string };
      list_page_breadcrumbs: {
        Args: { p_after_depth?: number; p_page_id: string };
        Returns: {
          depth: number;
          id: string;
          title: string;
        }[];
      };
      list_page_children: {
        Args: {
          p_after_id?: string;
          p_after_position?: string;
          p_parent_id?: string;
          p_workspace_id: string;
        };
        Returns: {
          icon: string;
          id: string;
          parent_id: string;
          position: string;
          revision: number;
          title: string;
        }[];
      };
      list_trash: {
        Args: { p_after_id?: string; p_query?: string; p_workspace_id: string };
        Returns: {
          deleted_at: string;
          id: string;
          parent_id: string;
          revision: number;
          title: string;
        }[];
      };
      list_workspace_members: {
        Args: { p_after_created_at?: string; p_after_user_id?: string; p_workspace_id: string };
        Returns: {
          created_at: string;
          email: string;
          role: string;
          user_id: string;
        }[];
      };
      move_page: {
        Args: {
          p_accept_acl_change?: boolean;
          p_before_id?: string;
          p_expected_revision?: number;
          p_keep_parent?: boolean;
          p_page_id: string;
          p_parent_id?: string;
          p_preview_hash?: string;
        };
        Returns: Json;
      };
      prepare_page_file: {
        Args: { p_mime_type: string; p_name: string; p_page_id: string; p_size: number };
        Returns: string;
      };
      remove_member: { Args: { p_user_id: string; p_workspace_id: string }; Returns: undefined };
      remove_page: { Args: { p_expected_revision: number; p_page_id: string }; Returns: string };
      restore_page: {
        Args: {
          p_accept_acl_change?: boolean;
          p_expected_revision?: number;
          p_page_id: string;
          p_parent_id?: string;
          p_preview_hash?: string;
          p_restore_original?: boolean;
        };
        Returns: Json;
      };
      search_pages: {
        Args: {
          p_after_id?: string;
          p_after_rank?: number;
          p_after_updated_at?: string;
          p_query: string;
          p_workspace_id: string;
        };
        Returns: {
          icon: string;
          id: string;
          rank: number;
          title: string;
          updated_at: string;
        }[];
      };
      set_member_role: {
        Args: { p_role: string; p_user_id: string; p_workspace_id: string };
        Returns: undefined;
      };
      toggle_page_favorite: { Args: { p_page_id: string }; Returns: boolean };
      update_page: {
        Args: { p_expected_revision: number; p_page_id: string; p_patch: Json };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
