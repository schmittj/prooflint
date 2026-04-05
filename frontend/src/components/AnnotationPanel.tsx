import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax";
import type { Annotation } from "../types/models";
import { useAnnotationStore } from "../stores/annotationStore";
import { useUIStore } from "../stores/uiStore";

/* ── Constants ── */
const CARD_GAP = 8;
const EST_CARD_H = 88;
const CURVE_INDENT = 28;

/* ── Tag catalog ── */
const TAG_CATALOG: Record<string, { slug: string; label: string }[]> = {
    check: [
        { slug: "manual_review", label: "Manual Review" },
        { slug: "experiment", label: "Experiment" },
        { slug: "example_check", label: "Example" },
        { slug: "formalization", label: "Formalization" },
        { slug: "agent_review", label: "Agent Review" },
        { slug: "cross_reference", label: "Cross-reference" },
    ],
    info: [
        { slug: "summary", label: "Summary" },
        { slug: "reference", label: "Reference" },
        { slug: "remark", label: "Remark" },
    ],
    issue: [
        { slug: "typo", label: "Typo" },
        { slug: "assumption_mismatch", label: "Assumption Mismatch" },
        { slug: "incomplete_argument", label: "Incomplete Argument" },
        { slug: "gap", label: "Gap" },
        { slug: "handwaving", label: "Handwaving" },
        { slug: "notation_conflict", label: "Notation Conflict" },
        { slug: "calculation_error", label: "Calculation Error" },
        { slug: "false_citation", label: "False Citation" },
    ],
};

/* ── Display helpers ── */
const TAG_LABELS: Record<string, string> = {};
for (const tags of Object.values(TAG_CATALOG)) {
    for (const t of tags) TAG_LABELS[t.slug] = t.label;
}

function tagLabel(slug: string): string {
    return TAG_LABELS[slug] ?? slug.replace(/_/g, " ");
}

/* ── Card colors by category + severity ── */
const CATEGORY_COLORS = {
    check: { bg: "#e6f4ea", border: "#6abf69", dot: "#2e7d32" },
    info: { bg: "#eef4ff", border: "#b0c9f0", dot: "#5b9bd5" },
    issue: {
        question: { bg: "#fff8e6", border: "#e6c84a", dot: "#d4a017" },
        warning: { bg: "#fff3e0", border: "#e6994a", dot: "#e67700" },
        error: { bg: "#fff0f0", border: "#e68a8a", dot: "#d44" },
    },
} as const;

function cardColors(ann: Annotation) {
    if (ann.category === "check") return CATEGORY_COLORS.check;
    if (ann.category === "info") return CATEGORY_COLORS.info;
    const sev = ann.severity as "question" | "warning" | "error";
    return CATEGORY_COLORS.issue[sev] ?? CATEGORY_COLORS.issue.question;
}

/* ── Lifecycle action label per category ── */
function resolveLabel(category: string): string {
    if (category === "check") return "Revoke";
    if (category === "info") return "Archive";
    return "Resolve";
}

/* ── Layout: position annotation groups near their block Y ── */
interface LayoutGroup {
    blockId: string;
    /** Desired vertical CENTER of this card group (block midpoint) */
    targetMidY: number;
    height: number;
}

/**
 * Position card groups so each is vertically centered on its targetMidY,
 * then resolve collisions. The active group gets priority placement.
 */
function resolvePositions(
    groups: LayoutGroup[],
    activeBlockId: string | null
): Map<string, number> {
    if (groups.length === 0) return new Map();
    const sorted = [...groups].sort((a, b) => a.targetMidY - b.targetMidY);
    const result = new Map<string, number>();

    // Center-align: top = midY - height/2
    const idealTop = (g: LayoutGroup) => Math.max(0, g.targetMidY - g.height / 2);

    const activeIdx =
        activeBlockId != null
            ? sorted.findIndex((g) => g.blockId === activeBlockId)
            : -1;

    const anchorIdx = activeIdx >= 0 ? activeIdx : 0;
    const anchor = sorted[anchorIdx];
    result.set(anchor.blockId, idealTop(anchor));

    // Pack upward from anchor
    let ceiling = idealTop(anchor);
    for (let i = anchorIdx - 1; i >= 0; i--) {
        const g = sorted[i];
        const y = Math.max(0, Math.min(idealTop(g), ceiling - g.height - CARD_GAP));
        result.set(g.blockId, y);
        ceiling = y;
    }

    // Pack downward from anchor
    let floor = idealTop(anchor) + anchor.height + CARD_GAP;
    for (let i = anchorIdx + 1; i < sorted.length; i++) {
        const g = sorted[i];
        const y = Math.max(idealTop(g), floor);
        result.set(g.blockId, y);
        floor = y + g.height + CARD_GAP;
    }

    return result;
}

/* ── S-curve SVG path (explicit Y endpoints) ── */
/** Single-block: starts at dot (x=4) */
function sCurve(leftY: number, rightY: number): string {
    const mx = CURVE_INDENT / 2;
    return `M 4,${leftY} C ${mx},${leftY} ${mx},${rightY} ${CURVE_INDENT},${rightY}`;
}
/** Bracket: starts at bracket bar (x=7) */
function sCurveBracket(leftY: number, rightY: number): string {
    const mx = CURVE_INDENT / 2;
    return `M 7,${leftY} C ${mx},${leftY} ${mx},${rightY} ${CURVE_INDENT},${rightY}`;
}

/* ── Inline Markdown renderer ── */
function AnnotationMessage({ text }: { text: string }) {
    return (
        <Markdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeMathjax]}
            components={{ p: ({ children }) => <span>{children}</span> }}
        >
            {text}
        </Markdown>
    );
}

/* ── Editable message ── */
function EditableMessage({
    annotation,
    docId,
}: {
    annotation: Annotation;
    docId: string;
}) {
    const { updateAnnotation } = useAnnotationStore();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(annotation.body);

    const save = async () => {
        const trimmed = draft.trim();
        if (trimmed !== annotation.body) {
            await updateAnnotation(docId, annotation.id, { body: trimmed });
        }
        setEditing(false);
    };

    if (editing) {
        return (
            <textarea
                className="annotation-edit-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        save();
                    }
                    if (e.key === "Escape") {
                        setDraft(annotation.body);
                        setEditing(false);
                    }
                }}
                rows={2}
                autoFocus
            />
        );
    }

    return (
        <div
            className="annotation-card-message annotation-card-message-clickable"
            onClick={(e) => {
                e.stopPropagation();
                setDraft(annotation.body);
                setEditing(true);
            }}
            title="Click to edit"
        >
            {annotation.body ? (
                <AnnotationMessage text={annotation.body} />
            ) : (
                <span style={{ color: "#aaa", fontStyle: "italic" }}>Add comment...</span>
            )}
        </div>
    );
}

/* ── Main component ── */
interface Props {
    readerRef: React.RefObject<HTMLElement | null>;
    orderedBlockIds: string[];
}

export default function AnnotationPanel({ readerRef, orderedBlockIds }: Props) {
    const { id: docId } = useParams<{ id: string }>();
    const { annotations, createAnnotation, updateAnnotation, deleteAnnotation } =
        useAnnotationStore();
    const { activeBlockIds, setActiveBlock, setBlockRange } = useUIStore();
    const activeBlockId = activeBlockIds[0] ?? null;
    const panelRef = useRef<HTMLDivElement>(null);

    const [blockYMap, setBlockYMap] = useState<Map<string, number>>(new Map());
    const [blockBottomMap, setBlockBottomMap] = useState<Map<string, number>>(new Map());
    const [contentHeight, setContentHeight] = useState(1000);

    const [showCheck, setShowCheck] = useState(true);
    const [showInfo, setShowInfo] = useState(true);
    const [showIssue, setShowIssue] = useState(true);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const formRef = useRef<HTMLDivElement>(null);
    const [toolbarH, setToolbarH] = useState(0);

    // Form state
    const [addingForBlock, setAddingForBlock] = useState<string | null>(null);
    const [formCategory, setFormCategory] = useState<"check" | "info" | "issue">("issue");
    const [formTags, setFormTags] = useState<string[]>([]);
    const [formSev, setFormSev] = useState<"question" | "warning" | "error">("warning");
    const [formBody, setFormBody] = useState("");
    const [saving, setSaving] = useState(false);

    const measureBlocks = useCallback(() => {
        const reader = readerRef.current;
        if (!reader) return;
        setContentHeight(reader.scrollHeight);
        const rTop = reader.getBoundingClientRect().top - reader.scrollTop;
        const topMap = new Map<string, number>();
        const botMap = new Map<string, number>();
        reader.querySelectorAll<HTMLElement>("[data-block-id]").forEach((el) => {
            const top = el.getBoundingClientRect().top - rTop;
            topMap.set(el.dataset.blockId!, top);
            botMap.set(el.dataset.blockId!, top + el.offsetHeight);
        });
        setBlockYMap(topMap);
        setBlockBottomMap(botMap);
    }, [readerRef]);

    useEffect(() => {
        const reader = readerRef.current;
        const panel = panelRef.current;
        if (!reader || !panel) return;

        const sync = () => {
            panel.scrollTop = reader.scrollTop;
            measureBlocks();
        };

        const preventScroll = (e: WheelEvent) => {
            e.preventDefault();
            reader.scrollTop += e.deltaY;
        };

        measureBlocks();
        reader.addEventListener("scroll", sync, { passive: true });
        panel.addEventListener("wheel", preventScroll, { passive: false });
        window.addEventListener("resize", measureBlocks);
        const ro = new ResizeObserver(measureBlocks);
        ro.observe(reader);

        return () => {
            reader.removeEventListener("scroll", sync);
            panel.removeEventListener("wheel", preventScroll);
            window.removeEventListener("resize", measureBlocks);
            ro.disconnect();
        };
    }, [readerRef, measureBlocks]);

    // Measure toolbar height for Y offset correction
    useEffect(() => {
        const el = toolbarRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setToolbarH(el.offsetHeight));
        ro.observe(el);
        setToolbarH(el.offsetHeight);
        return () => ro.disconnect();
    }, []);

    useEffect(() => {
        setAddingForBlock(null);
    }, [activeBlockId]);

    // Reset tags when category changes
    useEffect(() => {
        setFormTags([]);
    }, [formCategory]);

    // Scroll the reader to ensure the active block is visible (panel syncs via scroll listener)
    useEffect(() => {
        if (addingForBlock) {
            const el = readerRef.current?.querySelector(`[data-block-id="${addingForBlock}"]`);
            el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
    }, [addingForBlock, readerRef]);

    // Group annotations by start_block, applying category visibility filters
    const grouped = useMemo(() => {
        const visible = { check: showCheck, info: showInfo, issue: showIssue };
        const map = new Map<string, Annotation[]>();
        for (const a of annotations) {
            if (!visible[a.category] && !activeBlockIds.includes(a.start_block)) continue;
            const arr = map.get(a.start_block) ?? [];
            arr.push(a);
            map.set(a.start_block, arr);
        }
        return map;
    }, [annotations, showCheck, showInfo, showIssue, activeBlockIds]);

    const slotBlockIds = useMemo(() => {
        const ids = new Set(grouped.keys());
        // Only add the primary selected block as a card slot (not all selected)
        if (activeBlockIds.length > 0) ids.add(activeBlockIds[0]);
        return ids;
    }, [grouped, activeBlockIds]);

    const layoutGroups = useMemo(
        () =>
            Array.from(slotBlockIds).map((blockId) => {
                const anns = grouped.get(blockId) ?? [];
                let items = anns.length;
                // Only add form height when the form is actually open
                if (blockId === activeBlockId && addingForBlock === blockId) {
                    items += 3;
                }
                // Compute block midpoint as target center
                const blockTop = blockYMap.get(blockId) ?? 0;
                const blockBot = blockBottomMap.get(blockId) ?? blockTop + 28;
                let midY = (blockTop + blockBot) / 2;
                // For multi-block selection, use the selection midpoint
                if (blockId === activeBlockId && activeBlockIds.length > 1) {
                    const firstTop = blockYMap.get(activeBlockIds[0]);
                    const lastBot = blockBottomMap.get(activeBlockIds[activeBlockIds.length - 1]);
                    if (firstTop != null && lastBot != null) {
                        midY = (firstTop + lastBot) / 2;
                    }
                }
                return {
                    blockId,
                    targetMidY: midY,
                    height: Math.max(items, 1) * EST_CARD_H,
                };
            }),
        [slotBlockIds, grouped, activeBlockId, activeBlockIds, addingForBlock, blockYMap, blockBottomMap]
    );

    const positions = useMemo(
        () => resolvePositions(layoutGroups, activeBlockId),
        [layoutGroups, activeBlockId]
    );

    // Map blockId → estimated group height (for S-curve midpoint)
    const groupHeightMap = useMemo(() => {
        const m = new Map<string, number>();
        for (const g of layoutGroups) m.set(g.blockId, g.height);
        return m;
    }, [layoutGroups]);

    const panelHeight = useMemo(() => {
        let max = contentHeight;
        for (const [blockId, y] of positions) {
            const g = layoutGroups.find((g) => g.blockId === blockId);
            if (g) max = Math.max(max, y + g.height + 200);
        }
        return max;
    }, [positions, layoutGroups, contentHeight]);

    const toggleTag = (slug: string) => {
        setFormTags((prev) =>
            prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug]
        );
    };

    const handleCreate = async () => {
        if (!docId || !addingForBlock) return;
        setSaving(true);
        try {
            const startBlock = activeBlockIds[0] ?? addingForBlock;
            const endBlock = activeBlockIds.length > 1
                ? activeBlockIds[activeBlockIds.length - 1]
                : startBlock;
            await createAnnotation(docId, {
                start_block: startBlock,
                end_block: endBlock,
                category: formCategory,
                tags: formTags,
                ...(formCategory === "issue" ? { severity: formSev } : {}),
                body: formBody.trim(),
            });
            setFormBody("");
            setFormTags([]);
            setAddingForBlock(null);
        } catch (err: unknown) {
            const axErr = err as { response?: { data?: unknown } };
            console.error("Create failed:", axErr.response?.data ?? err);
            alert(
                `Save failed: ${JSON.stringify(axErr.response?.data ?? "unknown")}`
            );
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            ref={panelRef}
            className="annotation-panel-scroll"
        >
            {/* Category visibility toggles */}
            <div className="annotation-panel-toolbar" ref={toolbarRef}>
                <label className="category-toggle category-toggle-check">
                    <input type="checkbox" checked={showCheck} onChange={() => setShowCheck(!showCheck)} />
                    Checks
                </label>
                <label className="category-toggle category-toggle-info">
                    <input type="checkbox" checked={showInfo} onChange={() => setShowInfo(!showInfo)} />
                    Info
                </label>
                <label className="category-toggle category-toggle-issue">
                    <input type="checkbox" checked={showIssue} onChange={() => setShowIssue(!showIssue)} />
                    Issues
                </label>
            </div>

            <div
                style={{
                    position: "relative",
                    minHeight: panelHeight,
                    paddingLeft: CURVE_INDENT + 4,
                    top: -toolbarH,
                    marginBottom: -toolbarH,
                }}
            >
                {/* SVG connector lines */}
                <svg
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: CURVE_INDENT,
                        height: panelHeight,
                        pointerEvents: "none",
                    }}
                >
                    {/* Multi-block selection bracket (] shape) */}
                    {activeBlockIds.length > 1 && (() => {
                        const firstTop = blockYMap.get(activeBlockIds[0]);
                        const lastBot = blockBottomMap.get(activeBlockIds[activeBlockIds.length - 1]);
                        if (firstTop == null || lastBot == null) return null;
                        const midY = (firstTop + lastBot) / 2;
                        const cardY = positions.get(activeBlockIds[0]);
                        const cardH = groupHeightMap.get(activeBlockIds[0]) ?? EST_CARD_H;
                        const cardMid = cardY != null ? cardY + cardH / 2 : null;
                        return (
                            <g>
                                {/* ] bracket: ticks left, bar right */}
                                <line x1={1} y1={firstTop} x2={7} y2={firstTop}
                                    stroke="#4a6fa5" strokeWidth={1.5} />
                                <line x1={7} y1={firstTop} x2={7} y2={lastBot}
                                    stroke="#4a6fa5" strokeWidth={1.5} />
                                <line x1={1} y1={lastBot} x2={7} y2={lastBot}
                                    stroke="#4a6fa5" strokeWidth={1.5} />
                                {cardMid != null && (
                                    <path d={sCurveBracket(midY, cardMid)}
                                        fill="none" stroke="#4a6fa5" strokeWidth={1.5} />
                                )}
                            </g>
                        );
                    })()}
                    {/* Single-block and stored multi-block connectors */}
                    {Array.from(slotBlockIds).map((blockId) => {
                        // Skip blocks covered by the active multi-select bracket
                        if (activeBlockIds.length > 1 && activeBlockIds.includes(blockId))
                            return null;
                        const blockTop = blockYMap.get(blockId);
                        const blockBot = blockBottomMap.get(blockId);
                        const cardY = positions.get(blockId);
                        if (blockTop == null || cardY == null) return null;
                        const anns = grouped.get(blockId) ?? [];
                        if (anns.length === 0) return null;
                        const cardH = groupHeightMap.get(blockId) ?? EST_CARD_H;
                        const cardMid = cardY + cardH / 2;
                        // Multi-block stored annotation → ] bracket
                        const multiSpan = anns.find((a) => a.start_block !== a.end_block);
                        if (multiSpan) {
                            const endBot = blockBottomMap.get(multiSpan.end_block);
                            if (endBot != null) {
                                const midY = (blockTop + endBot) / 2;
                                return (
                                    <g key={blockId}>
                                        <line x1={1} y1={blockTop} x2={7} y2={blockTop}
                                            stroke="#ccc" strokeWidth={1} />
                                        <line x1={7} y1={blockTop} x2={7} y2={endBot}
                                            stroke="#ccc" strokeWidth={1} />
                                        <line x1={1} y1={endBot} x2={7} y2={endBot}
                                            stroke="#ccc" strokeWidth={1} />
                                        <path d={sCurveBracket(midY, cardMid)}
                                            fill="none" stroke="#ddd" strokeWidth={1} />
                                    </g>
                                );
                            }
                        }
                        // Single-block → dot + S-curve
                        const blockMid = (blockTop + (blockBot ?? blockTop + 28)) / 2;
                        return (
                            <g key={blockId}>
                                <circle cx={4} cy={blockMid} r={3} fill="#ccc" />
                                <path d={sCurve(blockMid, cardMid)}
                                    fill="none" stroke="#ddd" strokeWidth={1} />
                            </g>
                        );
                    })}
                </svg>

                {/* Positioned annotation groups */}
                {Array.from(slotBlockIds).map((blockId) => {
                    const y = positions.get(blockId) ?? 0;
                    const anns = grouped.get(blockId) ?? [];
                    const isPrimary = blockId === activeBlockId;

                    return (
                        <div
                            key={blockId}
                            className="annotation-group"
                            style={{
                                position: "absolute",
                                top: y,
                                left: CURVE_INDENT + 4,
                                right: 0,
                                transition: "top 0.25s ease-out",
                            }}
                        >
                            {anns.map((ann) => {
                                const colors = cardColors(ann);
                                return (
                                    <div
                                        key={ann.id}
                                        className="annotation-card"
                                        style={{
                                            background: colors.bg,
                                            borderLeft: `3px solid ${colors.border}`,
                                            opacity: ann.resolved ? 0.5 : 1,
                                            marginBottom: CARD_GAP,
                                            cursor: "pointer",
                                        }}
                                        onClick={() => {
                                            if (ann.start_block !== ann.end_block) {
                                                setBlockRange(ann.start_block, ann.end_block, orderedBlockIds);
                                            } else {
                                                setActiveBlock(ann.start_block);
                                            }
                                        }}
                                    >
                                        <div className="annotation-card-header">
                                            <span>
                                                <span
                                                    style={{
                                                        display: "inline-block",
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: "50%",
                                                        background: colors.dot,
                                                        marginRight: 6,
                                                    }}
                                                />
                                                <strong style={{ textTransform: "capitalize" }}>
                                                    {ann.category}
                                                </strong>
                                                {ann.severity && (
                                                    <span className="annotation-severity-badge" style={{ marginLeft: 6 }}>
                                                        {ann.severity}
                                                    </span>
                                                )}
                                            </span>
                                            <span className="annotation-card-meta">
                                                {ann.source === "agent"
                                                    ? "AI"
                                                    : "Human"}
                                            </span>
                                        </div>
                                        {/* Tag chips */}
                                        {ann.tags.length > 0 && (
                                            <div className="annotation-tag-chips">
                                                {ann.tags.map((t) => (
                                                    <span key={t} className="annotation-tag-chip">
                                                        {tagLabel(t)}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        <EditableMessage
                                            annotation={ann}
                                            docId={docId!}
                                        />
                                        <div className="annotation-card-actions">
                                            <label className="annotation-resolve">
                                                <input
                                                    type="checkbox"
                                                    checked={ann.resolved}
                                                    onChange={() =>
                                                        docId &&
                                                        updateAnnotation(
                                                            docId,
                                                            ann.id,
                                                            {
                                                                resolved:
                                                                    !ann.resolved,
                                                            }
                                                        )
                                                    }
                                                />
                                                {resolveLabel(ann.category)}
                                            </label>
                                            <button
                                                className="btn btn-sm btn-danger"
                                                onClick={() =>
                                                    docId &&
                                                    deleteAnnotation(
                                                        docId,
                                                        ann.id
                                                    )
                                                }
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Inline "+ Add annotation" for the active block */}
                            {isPrimary && addingForBlock !== blockId && (
                                <button
                                    className="btn btn-sm btn-add-annotation"
                                    onClick={() => setAddingForBlock(blockId)}
                                >
                                    + Add annotation
                                </button>
                            )}

                            {/* Inline creation form */}
                            {addingForBlock === blockId && (
                                <div className="annotation-form" ref={formRef}>
                                    <label>
                                        Category
                                        <select
                                            value={formCategory}
                                            onChange={(e) =>
                                                setFormCategory(
                                                    e.target.value as "check" | "info" | "issue"
                                                )
                                            }
                                        >
                                            <option value="issue">Issue</option>
                                            <option value="check">Check</option>
                                            <option value="info">Info</option>
                                        </select>
                                    </label>

                                    {/* Tags as checkboxes */}
                                    <fieldset className="annotation-form-tags">
                                        <legend>Tags</legend>
                                        {(TAG_CATALOG[formCategory] ?? []).map((t) => (
                                            <label key={t.slug} className="annotation-tag-option">
                                                <input
                                                    type="checkbox"
                                                    checked={formTags.includes(t.slug)}
                                                    onChange={() => toggleTag(t.slug)}
                                                />
                                                {t.label}
                                            </label>
                                        ))}
                                    </fieldset>

                                    {/* Severity — only for issues */}
                                    {formCategory === "issue" && (
                                        <label>
                                            Severity
                                            <select
                                                value={formSev}
                                                onChange={(e) =>
                                                    setFormSev(
                                                        e.target.value as
                                                            | "question"
                                                            | "warning"
                                                            | "error"
                                                    )
                                                }
                                            >
                                                <option value="question">
                                                    Question
                                                </option>
                                                <option value="warning">
                                                    Warning
                                                </option>
                                                <option value="error">Error</option>
                                            </select>
                                        </label>
                                    )}

                                    <label>
                                        Comment
                                        <textarea
                                            value={formBody}
                                            onChange={(e) =>
                                                setFormBody(e.target.value)
                                            }
                                            rows={3}
                                            placeholder="Describe... (supports $\LaTeX$)"
                                        />
                                    </label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <button
                                            className="btn btn-primary"
                                            onClick={handleCreate}
                                            disabled={saving}
                                        >
                                            {saving ? "Saving..." : "Save"}
                                        </button>
                                        <button
                                            className="btn btn-sm"
                                            onClick={() => {
                                                setAddingForBlock(null);
                                                setFormBody("");
                                                setFormTags([]);
                                            }}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Empty state */}
                {slotBlockIds.size === 0 && (
                    <p className="annotation-panel-hint" style={{ padding: 16 }}>
                        No annotations yet. Click a block to add one.
                    </p>
                )}
            </div>
        </div>
    );
}
