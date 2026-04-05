import { create } from "zustand";
import axios from "axios";
import type { Annotation } from "../types/models";

interface AnnotationStore {
    annotations: Annotation[];
    filters: { source: string[]; severity: string[] };

    fetchAnnotations: (docId: string) => Promise<void>;
    createAnnotation: (
        docId: string,
        data: Partial<Annotation>
    ) => Promise<void>;
    updateAnnotation: (
        docId: string,
        annId: string,
        data: Partial<Annotation>
    ) => Promise<void>;
    deleteAnnotation: (docId: string, annId: string) => Promise<void>;
    setFilters: (filters: Partial<AnnotationStore["filters"]>) => void;
}

export const useAnnotationStore = create<AnnotationStore>((set) => ({
    annotations: [],
    filters: { source: [], severity: [] },

    fetchAnnotations: async (docId: string) => {
        set({ annotations: [] }); // clear stale data before fetch
        const res = await axios.get(
            `/api/v1/documents/${docId}/annotations/`
        );
        set({ annotations: res.data.results ?? res.data });
    },

    createAnnotation: async (docId: string, data: Partial<Annotation>) => {
        const res = await axios.post(
            `/api/v1/documents/${docId}/annotations/`,
            data
        );
        set((state) => ({
            annotations: [...state.annotations, res.data],
        }));
    },

    updateAnnotation: async (
        docId: string,
        annId: string,
        data: Partial<Annotation>
    ) => {
        const res = await axios.patch(
            `/api/v1/documents/${docId}/annotations/${annId}/`,
            data
        );
        set((state) => ({
            annotations: state.annotations.map((a) =>
                a.id === annId ? res.data : a
            ),
        }));
    },

    deleteAnnotation: async (docId: string, annId: string) => {
        await axios.delete(
            `/api/v1/documents/${docId}/annotations/${annId}/`
        );
        set((state) => ({
            annotations: state.annotations.filter((a) => a.id !== annId),
        }));
    },

    setFilters: (filters) =>
        set((state) => ({
            filters: { ...state.filters, ...filters },
        })),
}));
