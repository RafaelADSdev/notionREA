export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      comment_threads: {
        Row: {
          anchor: Json | null;
          author_id: string | null;
          block_id: string | null;
          created_at: string;
          id: string;
          page_id: string;
          request_hash: string;
          resolved: boolean;
          revision: number;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          anchor?: Json | null;
          author_id?: string | null;
          block_id?: string | null;
          created_at?: string;
          id: string;
          page_id: string;
          request_hash: string;
          resolved?: boolean;
          revision?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          anchor?: Json | null;
          author_id?: string | null;
          block_id?: string | null;
          created_at?: string;
          id?: string;
          page_id?: string;
          request_hash?: string;
          resolved?: boolean;
          revision?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comment_threads_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      comments: {
        Row: {
          author_id: string | null;
          body: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          page_id: string;
          request_hash: string;
          revision: number;
          thread_id: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          body: string;
          created_at?: string;
          deleted_at?: string | null;
          id: string;
          page_id: string;
          request_hash: string;
          revision?: number;
          thread_id: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          page_id?: string;
          request_hash?: string;
          revision?: number;
          thread_id?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comments_thread_id_page_id_workspace_id_fkey";
            columns: ["thread_id", "page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "comment_threads";
            referencedColumns: ["id", "page_id", "workspace_id"];
          },
        ];
      };
      database_cells: {
        Row: {
          database_id: string;
          page_id: string;
          property_id: string;
          revision: number;
          value: NonNullable<Json>;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          database_id: string;
          page_id: string;
          property_id: string;
          revision?: number;
          value: NonNullable<Json>;
          workspace_id: string;
        };
        Update: {
          database_id?: string;
          page_id?: string;
          property_id?: string;
          revision?: number;
          value?: NonNullable<Json>;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "database_cells_database_id_page_id_workspace_id_fkey";
            columns: ["database_id", "page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "database_records";
            referencedColumns: ["database_id", "page_id", "workspace_id"];
          },
          {
            foreignKeyName: "database_cells_property_id_database_id_workspace_id_fkey";
            columns: ["property_id", "database_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "database_properties";
            referencedColumns: ["id", "database_id", "workspace_id"];
          },
        ];
      };
      database_properties: {
        Row: {
          config: NonNullable<Json>;
          database_id: string;
          id: string;
          name: string;
          position: string;
          revision: number;
          type: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          database_id: string;
          id?: string;
          name: string;
          position: string;
          revision?: number;
          type: string;
          workspace_id: string;
        };
        Update: {
          config?: NonNullable<Json>;
          database_id?: string;
          id?: string;
          name?: string;
          position?: string;
          revision?: number;
          type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "database_properties_database_id_workspace_id_fkey";
            columns: ["database_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "databases";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      database_records: {
        Row: {
          database_id: string;
          is_template: boolean;
          page_id: string;
          position: string;
          revision: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          database_id: string;
          is_template?: boolean;
          page_id: string;
          position: string;
          revision?: number;
          workspace_id: string;
        };
        Update: {
          database_id?: string;
          is_template?: boolean;
          page_id?: string;
          position?: string;
          revision?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "database_records_database_id_workspace_id_fkey";
            columns: ["database_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "databases";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "database_records_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      database_templates: {
        Row: {
          database_id: string;
          id: string;
          page_id: string;
          revision: number;
          title: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          database_id: string;
          id?: string;
          page_id: string;
          revision?: number;
          title: string;
          workspace_id: string;
        };
        Update: {
          database_id?: string;
          id?: string;
          page_id?: string;
          revision?: number;
          title?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "database_templates_database_id_page_id_workspace_id_fkey";
            columns: ["database_id", "page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "database_records";
            referencedColumns: ["database_id", "page_id", "workspace_id"];
          },
        ];
      };
      database_views: {
        Row: {
          config: NonNullable<Json>;
          database_id: string;
          id: string;
          name: string;
          position: string;
          revision: number;
          type: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          config: NonNullable<Json>;
          database_id: string;
          id?: string;
          name: string;
          position: string;
          revision?: number;
          type: string;
          workspace_id: string;
        };
        Update: {
          config?: NonNullable<Json>;
          database_id?: string;
          id?: string;
          name?: string;
          position?: string;
          revision?: number;
          type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "database_views_database_id_workspace_id_fkey";
            columns: ["database_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "databases";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      databases: {
        Row: {
          id: string;
          page_id: string;
          revision: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          id?: string;
          page_id: string;
          revision?: number;
          workspace_id: string;
        };
        Update: {
          id?: string;
          page_id?: string;
          revision?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "databases_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
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
      page_backlinks: {
        Row: {
          source_page_id: string;
          source_revision: number;
          target_page_id: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          source_page_id: string;
          source_revision: number;
          target_page_id: string;
          workspace_id: string;
        };
        Update: {
          source_page_id?: string;
          source_revision?: number;
          target_page_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_backlinks_source_page_id_workspace_id_fkey";
            columns: ["source_page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
          {
            foreignKeyName: "page_backlinks_target_page_id_workspace_id_fkey";
            columns: ["target_page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
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
          image_height: number | null;
          image_width: number | null;
          mime_type: string;
          object_path: string;
          original_name: string;
          page_id: string;
          purpose: string;
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
          image_height?: number | null;
          image_width?: number | null;
          mime_type: string;
          object_path: string;
          original_name: string;
          page_id: string;
          purpose?: string;
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
          image_height?: number | null;
          image_width?: number | null;
          mime_type?: string;
          object_path?: string;
          original_name?: string;
          page_id?: string;
          purpose?: string;
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
      page_publications: {
        Row: {
          created_at: string;
          created_by: string;
          fields: string[];
          page_id: string;
          revision: number;
          revoked_at: string | null;
          token: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          fields?: string[];
          page_id: string;
          revision?: number;
          revoked_at?: string | null;
          token: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          fields?: string[];
          page_id?: string;
          revision?: number;
          revoked_at?: string | null;
          token?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_publications_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
          },
        ];
      };
      page_search_chunks: {
        Row: {
          chunk_index: number;
          page_id: string;
          search_vector: unknown;
          source_revision: number;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          chunk_index: number;
          page_id: string;
          search_vector: unknown;
          source_revision: number;
          workspace_id: string;
        };
        Update: {
          chunk_index?: number;
          page_id?: string;
          search_vector?: unknown;
          source_revision?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "page_search_chunks_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
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
          workspace_role: string | null;
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
          workspace_role?: string | null;
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
          workspace_role?: string | null;
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
      sharing_audit: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          id: string;
          page_id: string;
          result: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_id: string;
          created_at?: string;
          id?: string;
          page_id: string;
          result: string;
          workspace_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          created_at?: string;
          id?: string;
          page_id?: string;
          result?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sharing_audit_page_id_workspace_id_fkey";
            columns: ["page_id", "workspace_id"];
            isOneToOne: false;
            referencedRelation: "pages";
            referencedColumns: ["id", "workspace_id"];
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
      add_comment: { Args: { p_body: string; p_request_id?: string; p_thread_id: string }; Returns: string };
      add_database_record: {
        Args: { p_database_id: string; p_is_template?: boolean; p_request_id: string; p_title: string };
        Returns: Json;
      };
      clear_page_cover: { Args: { p_expected_revision: number; p_page_id: string }; Returns: number };
      commit_content_document: {
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
      configure_page_publication: {
        Args: {
          p_enabled: boolean;
          p_expected_revision: number;
          p_fields?: string[];
          p_page_id: string;
          p_rotate?: boolean;
        };
        Returns: Json;
      };
      configure_page_sharing: {
        Args: {
          p_confirm?: boolean;
          p_expected_revision: number;
          p_grants?: Json;
          p_owner_id?: string;
          p_page_id: string;
          p_preview_token?: string;
          p_restricted?: boolean;
          p_workspace_role?: string;
        };
        Returns: Json;
      };
      create_comment_thread: {
        Args: {
          p_anchor?: Json;
          p_block_id?: string;
          p_body: string;
          p_page_id: string;
          p_request_id?: string;
        };
        Returns: string;
      };
      create_database: {
        Args: { p_parent_page_id: string; p_request_id: string; p_title: string; p_workspace_id: string };
        Returns: Json;
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
      database_people: {
        Args: { p_after_id?: string; p_database_id: string; p_user_ids?: string[] };
        Returns: {
          id: string;
          label: string;
        }[];
      };
      delete_comment: { Args: { p_comment_id: string; p_expected_revision: number }; Returns: undefined };
      delete_database_property: {
        Args: {
          p_confirm?: boolean;
          p_database_id: string;
          p_expected_revision: number;
          p_preview_token?: string;
          p_property_id: string;
        };
        Returns: Json;
      };
      delete_database_template: {
        Args: { p_database_id: string; p_expected_revision: number; p_template_id: string };
        Returns: undefined;
      };
      delete_database_view: {
        Args: { p_database_id: string; p_expected_revision: number; p_view_id: string };
        Returns: undefined;
      };
      edit_comment: {
        Args: { p_body: string; p_comment_id: string; p_expected_revision: number };
        Returns: number;
      };
      finalize_page_block_file: {
        Args: {
          p_actor_id: string;
          p_actual_size: number;
          p_file_id: string;
          p_height?: number;
          p_sha256: string;
          p_width?: number;
        };
        Returns: string;
      };
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
      find_database_references: {
        Args: { p_after_id?: string; p_database_id: string; p_query?: string };
        Returns: {
          databaseId: string;
          id: string;
          label: string;
        }[];
      };
      get_database_metadata: { Args: { p_database_id: string }; Returns: Json };
      get_document_manifest: {
        Args: { p_page_id: string };
        Returns: {
          byte_length: number;
          revision: number;
          schema_version: number;
        }[];
      };
      get_page_database: { Args: { p_page_id: string }; Returns: Json };
      get_page_metadata: { Args: { p_page_id: string; p_workspace_id: string }; Returns: Json };
      get_page_role: { Args: { p_page_id: string }; Returns: string };
      get_page_sharing: { Args: { p_page_id: string }; Returns: Json };
      list_comment_threads: {
        Args: { p_after_created_at?: string; p_after_id?: string; p_page_id: string };
        Returns: Json;
      };
      list_databases: {
        Args: { p_after_id?: string; p_query?: string; p_workspace_id: string };
        Returns: {
          id: string;
          pageId: string;
          title: string;
        }[];
      };
      list_page_backlinks: {
        Args: { p_after_id?: string; p_page_id: string };
        Returns: {
          icon: string;
          id: string;
          title: string;
        }[];
      };
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
      list_page_sharing_targets: { Args: { p_after_id?: string; p_page_id: string }; Returns: Json };
      list_thread_comments: {
        Args: { p_after_created_at?: string; p_after_id?: string; p_thread_id: string };
        Returns: Json;
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
      move_database_record: {
        Args: { p_before_id: string; p_database_id: string; p_expected_revision: number; p_page_id: string };
        Returns: number;
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
      prepare_block_file: {
        Args: { p_kind: string; p_mime_type: string; p_name: string; p_page_id: string; p_size: number };
        Returns: string;
      };
      prepare_page_file: {
        Args: { p_mime_type: string; p_name: string; p_page_id: string; p_size: number };
        Returns: string;
      };
      put_database_cell: {
        Args: {
          p_database_id: string;
          p_expected_revision: number;
          p_page_id: string;
          p_property_id: string;
          p_value: Json;
        };
        Returns: number;
      };
      put_database_property: {
        Args: {
          p_config: Json;
          p_confirm?: boolean;
          p_database_id: string;
          p_expected_revision: number;
          p_id: string;
          p_name: string;
          p_preview_token?: string;
          p_type: string;
        };
        Returns: Json;
      };
      put_database_template: {
        Args: {
          p_database_id: string;
          p_expected_revision: number;
          p_id: string;
          p_page_id: string;
          p_title: string;
        };
        Returns: Json;
      };
      put_database_view: {
        Args: {
          p_config: Json;
          p_database_id: string;
          p_expected_revision: number;
          p_id: string;
          p_name: string;
          p_type: string;
        };
        Returns: Json;
      };
      query_database_records: {
        Args: {
          p_cursor?: Json;
          p_database_id: string;
          p_filter?: Json;
          p_group_by?: string;
          p_month?: string;
          p_sorts?: Json;
          p_use_filter?: boolean;
          p_use_group?: boolean;
          p_view_id: string;
        };
        Returns: Json;
      };
      read_document_chunk: {
        Args: { p_offset?: number; p_page_id: string; p_revision: number };
        Returns: string;
      };
      read_page_publication: { Args: { p_after_id?: string; p_token: string }; Returns: Json };
      remove_member: { Args: { p_user_id: string; p_workspace_id: string }; Returns: undefined };
      remove_page: { Args: { p_expected_revision: number; p_page_id: string }; Returns: string };
      renew_page_presence: { Args: { p_page_id: string; p_participant_id: string }; Returns: Json };
      reserve_document_validation: { Args: { p_actor_id: string; p_page_id: string }; Returns: undefined };
      reserve_page_file_validation: { Args: { p_actor_id: string; p_file_id: string }; Returns: undefined };
      resolve_comment_thread: {
        Args: { p_expected_revision: number; p_resolved: boolean; p_thread_id: string };
        Returns: number;
      };
      resolve_database_references: {
        Args: { p_database_id: string; p_record_ids: string[] };
        Returns: {
          databaseId: string;
          id: string;
          label: string;
        }[];
      };
      resolve_page_mentions: {
        Args: { p_page_ids: string[]; p_workspace_id: string };
        Returns: {
          icon: string;
          id: string;
          title: string;
        }[];
      };
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
      verify_public_file: { Args: { p_file_id: string; p_token: string }; Returns: boolean };
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
