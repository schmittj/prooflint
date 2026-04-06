import { create } from "zustand";
import axios from "axios";
import { getLocalAdminHeaders } from "../api/localAdmin";

function withoutKey(record: Record<string, string | boolean>, key: string) {
    const rest = { ...record };
    delete rest[key];
    return rest;
}

function describeError(error: unknown): string {
    const maybeAxios = error as {
        response?: { data?: { error?: string; detail?: string } };
        message?: string;
    };
    return (
        maybeAxios.response?.data?.error ||
        maybeAxios.response?.data?.detail ||
        maybeAxios.message ||
        String(error)
    );
}

interface SettingsState {
    /** Values as returned by the server (masked for secrets). */
    serverValues: Record<string, string>;
    /** Local edits the user has made (unmasked, real values). */
    localEdits: Record<string, string>;
    /** Which keys the user has touched (so we know not to show the mask). */
    dirty: Record<string, boolean>;
    /** Per-key save status. */
    saving: Record<string, boolean>;
    /** Per-key last-save result. */
    saved: Record<string, boolean>;
    /** Global loading flag for initial fetch. */
    loading: boolean;
    error: string | null;

    fetchSettings: () => Promise<void>;
    setField: (key: string, value: string) => void;
    saveField: (key: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    serverValues: {},
    localEdits: {},
    dirty: {},
    saving: {},
    saved: {},
    loading: false,
    error: null,

    fetchSettings: async () => {
        set({ loading: true, error: null });
        try {
            const res = await axios.get("/api/v1/settings/");
            set({
                serverValues: res.data.settings,
                loading: false,
            });
        } catch (error) {
            set({ error: describeError(error), loading: false });
        }
    },

    setField: (key, value) => {
        set((s) => ({
            localEdits: { ...s.localEdits, [key]: value },
            dirty: { ...s.dirty, [key]: true },
            saved: { ...s.saved, [key]: false },
        }));
    },

    saveField: async (key) => {
        const { localEdits, dirty } = get();
        if (!dirty[key]) return;
        const value = localEdits[key] ?? "";

        set((s) => ({
            saving: { ...s.saving, [key]: true },
            error: null,
            saved: { ...s.saved, [key]: false },
        }));
        try {
            const headers = await getLocalAdminHeaders();
            await axios.post("/api/v1/settings/", { [key]: value }, { headers });
            const res = await axios.get("/api/v1/settings/");
            set((s) => ({
                saving: { ...s.saving, [key]: false },
                saved: { ...s.saved, [key]: true },
                dirty: withoutKey(s.dirty, key) as Record<string, boolean>,
                localEdits: withoutKey(s.localEdits, key) as Record<string, string>,
                serverValues: {
                    ...s.serverValues,
                    ...res.data.settings,
                },
                error: null,
            }));
        } catch (error) {
            set((s) => ({
                saving: { ...s.saving, [key]: false },
                saved: { ...s.saved, [key]: false },
                error: describeError(error),
            }));
        }
    },
}));
