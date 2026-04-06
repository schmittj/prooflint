import { create } from "zustand";

interface UIStore {
    rightPanel: "annotations" | "chat";
    activeBlockIds: string[];
    /** The block that was originally clicked (anchor for shift-extend) */
    anchorBlockId: string | null;
    activeChunkId: string | null;
    sidebarCollapsed: boolean;
    /** Bumped when content layout changes and annotation positions need recalculating */
    layoutVersion: number;

    setRightPanel: (panel: "annotations" | "chat") => void;
    setActiveBlock: (blockId: string | null) => void;
    setBlockRange: (fromId: string, toId: string, orderedIds: string[]) => void;
    setActiveChunk: (chunkId: string | null) => void;
    toggleSidebar: () => void;
    bumpLayout: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
    rightPanel: "annotations",
    activeBlockIds: [],
    anchorBlockId: null,
    activeChunkId: null,
    sidebarCollapsed: false,
    layoutVersion: 0,

    setRightPanel: (panel) => set({ rightPanel: panel }),
    setActiveBlock: (blockId) =>
        set({ activeBlockIds: blockId ? [blockId] : [], anchorBlockId: blockId }),
    setBlockRange: (fromId, toId, orderedIds) => {
        const i = orderedIds.indexOf(fromId);
        const j = orderedIds.indexOf(toId);
        if (i < 0 || j < 0) return;
        const lo = Math.min(i, j);
        const hi = Math.max(i, j);
        set((state) => ({
            activeBlockIds: orderedIds.slice(lo, hi + 1),
            // Preserve existing anchor; seed it if missing
            anchorBlockId: state.anchorBlockId ?? fromId,
        }));
    },
    setActiveChunk: (chunkId) => set({ activeChunkId: chunkId }),
    toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    bumpLayout: () =>
        set((state) => ({ layoutVersion: state.layoutVersion + 1 })),
}));
