import { create } from "zustand";

interface UIStore {
    rightPanel: "annotations" | "chat";
    activeBlockId: string | null;
    activeChunkId: string | null;

    setRightPanel: (panel: "annotations" | "chat") => void;
    setActiveBlock: (blockId: string | null) => void;
    setActiveChunk: (chunkId: string | null) => void;
}

export const useUIStore = create<UIStore>((set) => ({
    rightPanel: "annotations",
    activeBlockId: null,
    activeChunkId: null,

    setRightPanel: (panel) => set({ rightPanel: panel }),
    setActiveBlock: (blockId) => set({ activeBlockId: blockId }),
    setActiveChunk: (chunkId) => set({ activeChunkId: chunkId }),
}));
