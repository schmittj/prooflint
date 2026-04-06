import { create } from "zustand";
import axios from "axios";
import type { AgentRun } from "../types/models";

const POLL_INTERVAL = 15_000; // 15 seconds

interface BotRunConfig {
    model?: string;
    reasoning_effort?: string;
    steering_prompt?: string;
    options?: Record<string, unknown>;
    block_ids?: string[];
}

interface AgentStore {
    /** All runs for the current document */
    runs: AgentRun[];
    /** The most recently launched or active run */
    activeRun: AgentRun | null;
    /** Polling timer ID */
    _pollTimer: ReturnType<typeof setInterval> | null;

    fetchRuns: (docId: string) => Promise<void>;
    launchRun: (docId: string, config?: BotRunConfig) => Promise<AgentRun>;
    cancelRun: (docId: string, runId: string) => Promise<void>;
    pollRun: (docId: string, runId: string) => Promise<AgentRun>;
    startPolling: (docId: string, runId: string) => void;
    stopPolling: () => void;
    clearActive: () => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
    runs: [],
    activeRun: null,
    _pollTimer: null,

    fetchRuns: async (docId) => {
        // Clear previous document's state before fetching
        get().stopPolling();
        set({ runs: [], activeRun: null });

        const res = await axios.get(`/api/v1/documents/${docId}/agents/runs/`);
        const runs: AgentRun[] = res.data.results ?? res.data;

        // If there's an active (pending/running) run, track it; otherwise clear
        const active = runs.find(
            (r) => r.status === "pending" || r.status === "running"
        );
        if (active) {
            set({ runs, activeRun: active });
            get().startPolling(docId, active.id);
        } else {
            set({ runs, activeRun: null });
        }
    },

    launchRun: async (docId, config = {}) => {
        const res = await axios.post(
            `/api/v1/documents/${docId}/agents/runs/`,
            {
                agent_type: "global_annotator",
                config,
            }
        );
        const run: AgentRun = res.data;
        set((s) => ({
            runs: [run, ...s.runs],
            activeRun: run,
        }));
        // Start polling for status updates
        get().startPolling(docId, run.id);
        return run;
    },

    cancelRun: async (docId, runId) => {
        const res = await axios.post(
            `/api/v1/documents/${docId}/agents/runs/${runId}/cancel/`
        );
        const run: AgentRun = res.data;
        set((s) => ({
            runs: s.runs.map((r) => (r.id === runId ? run : r)),
            activeRun: run.status === "failed" ? null : run,
        }));
        get().stopPolling();
    },

    pollRun: async (docId, runId) => {
        const res = await axios.get(
            `/api/v1/documents/${docId}/agents/runs/${runId}/`
        );
        const run: AgentRun = res.data;
        set((s) => ({
            runs: s.runs.map((r) => (r.id === runId ? run : r)),
            activeRun: run,
        }));
        return run;
    },

    startPolling: (docId, runId) => {
        const { _pollTimer } = get();
        if (_pollTimer) clearInterval(_pollTimer);

        const timer = setInterval(async () => {
            try {
                const run = await get().pollRun(docId, runId);
                if (run.status === "completed" || run.status === "failed") {
                    get().stopPolling();
                }
            } catch {
                // Silently retry on next interval
            }
        }, POLL_INTERVAL);

        set({ _pollTimer: timer });
    },

    stopPolling: () => {
        const { _pollTimer } = get();
        if (_pollTimer) {
            clearInterval(_pollTimer);
            set({ _pollTimer: null });
        }
    },

    clearActive: () => set({ activeRun: null }),
}));
