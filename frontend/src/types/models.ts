export interface Document {
    id: string;
    title: string;
    source_format: "latex" | "markdown";
    preset: "manual" | "triage" | "audit";
    agent_status: "idle" | "running" | "completed" | "failed";
    structure: Record<string, unknown>;
    macro_table: Record<string, unknown>;
    block_count?: number;
    blocks?: Block[];
    created_at: string;
    updated_at: string;
}

export interface Sentence {
    id: string;
    text: string;
    offset_start: number;
    offset_end: number;
}

export interface Block {
    id: string;
    block_id: string;
    block_type: string;
    content_original: string;
    content_expanded: string;
    order: number;
    parent: string | null;
    sentences: Sentence[];
    label: string;
}

export interface Annotation {
    id: string;
    block_id: string;
    sentence_id: string;
    anchor_offset_start: number | null;
    anchor_offset_end: number | null;
    anchor_quote: string;
    source: "human" | "agent";
    agent_run: string | null;
    chunk: string | null;
    annotation_type: string;
    severity: "info" | "warning" | "error";
    message: string;
    confidence: number | null;
    resolved: boolean;
    created_at: string;
    updated_at: string;
}

export interface Chunk {
    id: string;
    chunk_id: string;
    source_block_ids: string[];
    summary: string;
    expanded_argument: string;
    confidence: number;
    order: number;
}

export interface AgentRun {
    id: string;
    agent_type: string;
    status: "pending" | "running" | "completed" | "failed";
    model: string;
    preset: string;
    chunks?: Chunk[];
    input_tokens: number | null;
    output_tokens: number | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
}

export interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    selected_block_id: string;
    selected_text: string;
    model: string;
    created_at: string;
}
