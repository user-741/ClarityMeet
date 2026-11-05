"use client";
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/current-user";

type Workspace = { workspace_id: string; name: string; role: string };

type WorkspaceCtx = {
  activeWorkspace: Workspace | null;
  workspaces:      Workspace[];
  setActiveWorkspace: (ws: Workspace) => void;
  reload: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceCtx>({
  activeWorkspace: null,
  workspaces:      [],
  setActiveWorkspace: () => {},
  reload: async () => {},
});

export function useWorkspace() { return useContext(WorkspaceContext); }

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces,      setWorkspaces]      = useState<Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspaceState] = useState<Workspace | null>(null);

  const reload = useCallback(async () => {
    const user = await getCurrentUser();
    if (!user) return;

    const { data: wms } = await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(name)")
      .eq("user_id", user.id) as {
        data: { workspace_id: string; role: string; workspaces: { name: string } | null }[] | null
      };

    if (!wms?.length) return;

    const mapped: Workspace[] = wms.map(w => ({
      workspace_id: w.workspace_id,
      name:         w.workspaces?.name ?? "Workspace",
      role:         w.role,
    }));

    setWorkspaces(mapped);

    // Keep existing active if still valid, otherwise pick admin/first
    setActiveWorkspaceState(prev => {
      if (prev && mapped.find(w => w.workspace_id === prev.workspace_id)) return prev;
      return mapped.find(w => w.role === "admin") ?? mapped[0];
    });
  }, []);

  const setActiveWorkspace = useCallback((ws: Workspace) => {
    setActiveWorkspaceState(ws);
    // Persist choice so it survives page navigation
    try { localStorage.setItem("claritymeet_active_ws", ws.workspace_id); } catch {}
  }, []);

  useEffect(() => {
    const restoreSaved = () => {
      // Restore the workspace the user picked last time, if still a member
      try {
        const saved = localStorage.getItem("claritymeet_active_ws");
        if (saved) {
          setWorkspaces(prev => {
            const match = prev.find(w => w.workspace_id === saved);
            if (match) setActiveWorkspaceState(match);
            return prev;
          });
        }
      } catch {}
    };

    reload().then(restoreSaved);

    // This provider lives in the root layout, so it is mounted while the user
    // is still on /login. Reload when they sign in (otherwise the workspace
    // list stays empty and the switcher never shows) and clear on sign-out.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        reload().then(restoreSaved);
      } else if (event === "SIGNED_OUT") {
        setWorkspaces([]);
        setActiveWorkspaceState(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [reload]);

  return (
    <WorkspaceContext.Provider value={{ activeWorkspace, workspaces, setActiveWorkspace, reload }}>
      {children}
    </WorkspaceContext.Provider>
  );
}