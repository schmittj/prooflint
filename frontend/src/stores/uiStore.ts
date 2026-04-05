import { create } from "zustand";

interface UIStore {
    rightPanel: "annotations" | "chat";
    activeBlockId: string | null;
    activeChunkId: string | null;
    sidebarCollapsed: boolean;

    setRightPanel: (panel: "annotations" | "chat") => void;
    setActiveBlock: (blockId: string | null) => void;
    setActiveChunk: (chunkId: string | null) => void;
    toggleSidebar: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
    rightPanel: "annotations",
    activeBlockId: null,
    activeChunkId: null,
    sidebarCollapsed: false,

    setRightPanel: (panel) => set({ rightPanel: panel }),
    setActiveBlock: (blockId) => set({ activeBlockId: blockId }),
    setActiveChunk: (chunkId) => set({ activeChunkId: chunkId }),
    toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
