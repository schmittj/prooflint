import { create } from "zustand";

interface UIStore {
    rightPanel: "annotations" | "chat";
    activeBlockIds: string[];
    activeChunkId: string | null;
    sidebarCollapsed: boolean;

    setRightPanel: (panel: "annotations" | "chat") => void;
    setActiveBlock: (blockId: string | null) => void;
    /** Shift+click: extend selection to cover range from current anchor to blockId */
    setBlockRange: (fromId: string, toId: string, orderedIds: string[]) => void;
    setActiveChunk: (chunkId: string | null) => void;
    toggleSidebar: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
    rightPanel: "annotations",
    activeBlockIds: [],
    activeChunkId: null,
    sidebarCollapsed: false,

    setRightPanel: (panel) => set({ rightPanel: panel }),
    setActiveBlock: (blockId) =>
        set({ activeBlockIds: blockId ? [blockId] : [] }),
    setBlockRange: (fromId, toId, orderedIds) => {
        const i = orderedIds.indexOf(fromId);
        const j = orderedIds.indexOf(toId);
        if (i < 0 || j < 0) return;
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        set({ activeBlockIds: orderedIds.slice(lo, hi + 1) });
    },
    setActiveChunk: (chunkId) => set({ activeChunkId: chunkId }),
    toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
