import { create } from "zustand";
import axios from "axios";
import type { Block, Document } from "../types/models";

function describeError(error: unknown): string {
    const maybeAxios = error as {
        response?: { data?: { detail?: string; error?: string } };
        message?: string;
    };
    const detail = maybeAxios.response?.data?.detail;
    const backendError = maybeAxios.response?.data?.error;
    if (detail && backendError && detail !== backendError) {
        return `${detail} (${backendError})`;
    }
    return (
        detail ||
        backendError ||
        maybeAxios.message ||
        String(error)
    );
}

interface DocumentStore {
    documents: Document[];
    currentDocument: Document | null;
    blocks: Block[];
    loading: boolean;
    error: string | null;

    fetchDocuments: () => Promise<void>;
    fetchDocument: (id: string) => Promise<void>;
    fetchBlocks: (docId: string) => Promise<void>;
    createDocument: (
        source: string,
        sourceFormat: "latex" | "markdown",
        title: string,
        preset: "manual" | "triage"
    ) => Promise<Document>;
    deleteDocument: (id: string) => Promise<void>;
}

export const useDocumentStore = create<DocumentStore>((set) => ({
    documents: [],
    currentDocument: null,
    blocks: [],
    loading: false,
    error: null,

    fetchDocuments: async () => {
        set({ loading: true, error: null });
        try {
            const res = await axios.get("/api/v1/documents/");
            set({ documents: res.data.results ?? res.data, loading: false });
        } catch (e) {
            set({ error: describeError(e), loading: false });
        }
    },

    fetchDocument: async (id: string) => {
        set({ loading: true, error: null });
        try {
            const res = await axios.get(`/api/v1/documents/${id}/`);
            set({ currentDocument: res.data, loading: false });
        } catch (e) {
            set({ error: describeError(e), loading: false });
        }
    },

    fetchBlocks: async (docId: string) => {
        try {
            const res = await axios.get(`/api/v1/documents/${docId}/blocks/`);
            set({ blocks: res.data });
        } catch (e) {
            set({ error: describeError(e) });
        }
    },

    createDocument: async (source, sourceFormat, title, preset) => {
        set({ loading: true, error: null });
        try {
            const res = await axios.post("/api/v1/documents/", {
                source,
                source_format: sourceFormat,
                title,
                preset,
            });
            set((state) => ({
                documents: [res.data, ...state.documents],
                loading: false,
            }));
            return res.data;
        } catch (e) {
            set({ error: describeError(e), loading: false });
            throw e;
        }
    },

    deleteDocument: async (id: string) => {
        await axios.delete(`/api/v1/documents/${id}/`);
        set((state) => ({
            documents: state.documents.filter((d) => d.id !== id),
        }));
    },
}));
