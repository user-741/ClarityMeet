export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      app_config: {
        Row: {
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          ip_address: unknown
          payload: Json | null
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          payload?: Json | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          ip_address?: unknown
          payload?: Json | null
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bots: {
        Row: {
          bot_instance_id: string | null
          created_at: string
          ended_at: string | null
          error_message: string | null
          id: string
          meeting_id: string | null
          meeting_url: string
          platform: Database["public"]["Enums"]["meeting_platform"]
          started_at: string
          status: Database["public"]["Enums"]["bot_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          bot_instance_id?: string | null
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          id?: string
          meeting_id?: string | null
          meeting_url: string
          platform?: Database["public"]["Enums"]["meeting_platform"]
          started_at?: string
          status?: Database["public"]["Enums"]["bot_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          bot_instance_id?: string | null
          created_at?: string
          ended_at?: string | null
          error_message?: string | null
          id?: string
          meeting_id?: string | null
          meeting_url?: string
          platform?: Database["public"]["Enums"]["meeting_platform"]
          started_at?: string
          status?: Database["public"]["Enums"]["bot_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bots_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bots_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "bots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_feeds: {
        Row: {
          created_at: string | null
          event_count: number | null
          feed_url: string
          id: string
          last_synced: string | null
          name: string
          provider: string
          updated_at: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          event_count?: number | null
          feed_url: string
          id?: string
          last_synced?: string | null
          name: string
          provider: string
          updated_at?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          event_count?: number | null
          feed_url?: string
          id?: string
          last_synced?: string | null
          name?: string
          provider?: string
          updated_at?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_feeds_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "calendar_feeds_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_highlights: {
        Row: {
          content: string
          created_at: string
          id: string
          meeting_id: string
          sort_order: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          meeting_id: string
          sort_order?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          meeting_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_highlights_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_highlights_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings_summary"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_participants: {
        Row: {
          created_at: string
          display_name: string
          email: string | null
          id: string
          meeting_id: string
          speaker_label: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          email?: string | null
          id?: string
          meeting_id: string
          speaker_label?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string | null
          id?: string
          meeting_id?: string
          speaker_label?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          audio_path: string | null
          created_at: string
          duration_secs: number | null
          ended_at: string | null
          external_id: string | null
          external_uid: string | null
          id: string
          meeting_url: string | null
          owner_id: string | null
          participant_count: number | null
          platform: string
          processed_at: string | null
          scheduled_at: string | null
          started_at: string | null
          status: string | null
          summary: string | null
          task_count: number | null
          title: string | null
          transcribed_at: string | null
          transcript: string | null
          updated_at: string
          workspace_id: string | null
          zoom_link: string | null
        }
        Insert: {
          audio_path?: string | null
          created_at?: string
          duration_secs?: number | null
          ended_at?: string | null
          external_id?: string | null
          external_uid?: string | null
          id?: string
          meeting_url?: string | null
          owner_id?: string | null
          participant_count?: number | null
          platform?: string
          processed_at?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string | null
          summary?: string | null
          task_count?: number | null
          title?: string | null
          transcribed_at?: string | null
          transcript?: string | null
          updated_at?: string
          workspace_id?: string | null
          zoom_link?: string | null
        }
        Update: {
          audio_path?: string | null
          created_at?: string
          duration_secs?: number | null
          ended_at?: string | null
          external_id?: string | null
          external_uid?: string | null
          id?: string
          meeting_url?: string | null
          owner_id?: string | null
          participant_count?: number | null
          platform?: string
          processed_at?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string | null
          summary?: string | null
          task_count?: number | null
          title?: string | null
          transcribed_at?: string | null
          transcript?: string | null
          updated_at?: string
          workspace_id?: string | null
          zoom_link?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "meetings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          link: string | null
          read: boolean
          title: string
          type: Database["public"]["Enums"]["notification_type"]
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          link?: string | null
          read?: boolean
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          level: Database["public"]["Enums"]["log_level"]
          message: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          level?: Database["public"]["Enums"]["log_level"]
          message?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "system_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "system_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          ai_extracted: boolean
          assignee_id: string | null
          assignee_name: string | null
          completed_at: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          meeting_id: string | null
          participant: string | null
          priority: string | null
          status: string
          title: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          ai_extracted?: boolean
          assignee_id?: string | null
          assignee_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          participant?: string | null
          priority?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          ai_extracted?: boolean
          assignee_id?: string | null
          assignee_name?: string | null
          completed_at?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          meeting_id?: string | null
          participant?: string | null
          priority?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      uploads: {
        Row: {
          created_at: string
          error_message: string | null
          file_name: string
          file_path: string
          id: string
          meeting_id: string | null
          mime_type: string
          size_bytes: number
          status: Database["public"]["Enums"]["upload_status"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          file_name: string
          file_path: string
          id?: string
          meeting_id?: string | null
          mime_type: string
          size_bytes: number
          status?: Database["public"]["Enums"]["upload_status"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          file_name?: string
          file_path?: string
          id?: string
          meeting_id?: string | null
          mime_type?: string
          size_bytes?: number
          status?: Database["public"]["Enums"]["upload_status"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "uploads_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uploads_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uploads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "uploads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          bot_auto_join: boolean
          bot_auto_summarise: boolean
          bot_email_participants: boolean
          created_at: string
          email_bot_status: boolean
          email_mentions: boolean
          email_summaries: boolean
          email_task_reminders: boolean
          email_weekly_digest: boolean
          id: string
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bot_auto_join?: boolean
          bot_auto_summarise?: boolean
          bot_email_participants?: boolean
          created_at?: string
          email_bot_status?: boolean
          email_mentions?: boolean
          email_summaries?: boolean
          email_task_reminders?: boolean
          email_weekly_digest?: boolean
          id?: string
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bot_auto_join?: boolean
          bot_auto_summarise?: boolean
          bot_email_participants?: boolean
          created_at?: string
          email_bot_status?: boolean
          email_mentions?: boolean
          email_summaries?: boolean
          email_task_reminders?: boolean
          email_weekly_digest?: boolean
          id?: string
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          first_name: string | null
          id: string
          last_name: string | null
          name: string | null
          organisation: string | null
          role: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          name?: string | null
          organisation?: string | null
          role?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string | null
          id?: string
          last_name?: string | null
          name?: string | null
          organisation?: string | null
          role?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          token: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          token?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          token?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          id: string
          joined_at: string
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id: string
          workspace_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          role?: Database["public"]["Enums"]["user_role"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          plan?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      meetings_summary: {
        Row: {
          created_at: string | null
          duration_secs: number | null
          ended_at: string | null
          id: string | null
          owner_name: string | null
          participant_count: number | null
          platform: string | null
          started_at: string | null
          status: string | null
          task_count: number | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "meetings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks_detail: {
        Row: {
          ai_extracted: boolean | null
          assignee_display: string | null
          assignee_id: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          id: string | null
          meeting_id: string | null
          meeting_title: string | null
          priority: string | null
          status: string | null
          title: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspace_stats"
            referencedColumns: ["workspace_id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_stats: {
        Row: {
          completed_tasks: number | null
          completion_rate_pct: number | null
          in_progress_tasks: number | null
          meetings_this_month: number | null
          member_count: number | null
          open_tasks: number | null
          total_meetings: number | null
          total_tasks: number | null
          workspace_id: string | null
          workspace_name: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_workspace_invite: {
        Args: { p_workspace_id: string }
        Returns: {
          role: Database["public"]["Enums"]["user_role"]
          workspace_id: string
          workspace_name: string
        }[]
      }
      create_workspace_invite: {
        Args: {
          p_email: string
          p_role?: Database["public"]["Enums"]["user_role"]
          p_workspace_id: string
        }
        Returns: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["user_role"]
          token: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "workspace_invites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_my_workspace_ids: { Args: never; Returns: string[] }
      is_workspace_admin:
        | {
            Args: { _user_id: string; _workspace_id: string }
            Returns: boolean
          }
        | { Args: { ws_id: string }; Returns: boolean }
      is_workspace_member:
        | {
            Args: { _user_id: string; _workspace_id: string }
            Returns: boolean
          }
        | { Args: { ws_id: string }; Returns: boolean }
      is_workspace_owner: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      search_workspace: {
        Args: { p_limit?: number; p_query: string; p_workspace_id: string }
        Returns: {
          created_at: string
          id: string
          rank: number
          result_type: string
          snippet: string
          title: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      unaccent: { Args: { "": string }; Returns: string }
    }
    Enums: {
      bot_status:
        | "idle"
        | "joining"
        | "recording"
        | "processing"
        | "complete"
        | "failed"
      log_level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL"
      meeting_platform:
        | "zoom"
        | "google_meet"
        | "teams"
        | "webex"
        | "upload"
        | "other"
      meeting_status:
        | "scheduled"
        | "joining"
        | "recording"
        | "processing"
        | "transcribing"
        | "summarising"
        | "complete"
        | "failed"
        | "partial"
      notification_type: "success" | "warning" | "error" | "info"
      task_priority: "High" | "Medium" | "Low"
      task_status: "Open" | "In Progress" | "Completed" | "Cancelled"
      upload_status:
        | "queued"
        | "uploading"
        | "processing"
        | "complete"
        | "failed"
      user_role: "admin" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type WorkspaceStats = Database["public"]["Views"]["workspace_stats"]["Row"];
export type Meeting = Database["public"]["Tables"]["meetings"]["Row"];
export type MeetingParticipant = Database["public"]["Tables"]["meeting_participants"]["Row"];
export type MeetingHighlight = Database["public"]["Tables"]["meeting_highlights"]["Row"];
export type MeetingsSummary = Database["public"]["Views"]["meetings_summary"]["Row"];
export type TasksDetail = Database["public"]["Views"]["tasks_detail"]["Row"];
export type TaskStatus = Database["public"]["Enums"]["task_status"];

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
      bot_status: [
        "idle",
        "joining",
        "recording",
        "processing",
        "complete",
        "failed",
      ],
      log_level: ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"],
      meeting_platform: [
        "zoom",
        "google_meet",
        "teams",
        "webex",
        "upload",
        "other",
      ],
      meeting_status: [
        "scheduled",
        "joining",
        "recording",
        "processing",
        "transcribing",
        "summarising",
        "complete",
        "failed",
        "partial",
      ],
      notification_type: ["success", "warning", "error", "info"],
      task_priority: ["High", "Medium", "Low"],
      task_status: ["Open", "In Progress", "Completed", "Cancelled"],
      upload_status: [
        "queued",
        "uploading",
        "processing",
        "complete",
        "failed",
      ],
      user_role: ["admin", "member", "viewer"],
    },
  },
} as const
