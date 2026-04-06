import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useDocumentStore } from "../stores/documentStore";
import { useAnnotationStore } from "../stores/annotationStore";
import { useAgentStore } from "../stores/agentStore";
import { useUIStore } from "../stores/uiStore";
import BlockRenderer from "./BlockRenderer";
import CheckToggle from "./CheckToggle";
import VerificationProgress from "./VerificationProgress";
import AnnotationPanel from "./AnnotationPanel";
import BotWizard from "./BotWizard";
import BotStatusBar from "./BotStatusBar";
import BotSummary from "./BotSummary";
import type { Annotation, Block } from "../types/models";
import "./DocumentView.css";

/** Group blocks under section headings for the sidebar */
interface SidebarSection {
    heading: Block | null;
    children: Block[];
}

function buildSections(topLevelBlocks: Block[]): SidebarSection[] {
    const sections: SidebarSection[] = [];
    let current: SidebarSection = { heading: null, children: [] };

    for (const b of topLevelBlocks) {
        if (b.block_type === "section_heading") {
            if (current.heading || current.children.length > 0) {
                sections.push(current);
            }
            current = { heading: b, children: [] };
        } else {
            current.children.push(b);
        }
    }
    if (current.heading || current.children.length > 0) {
        sections.push(current);
    }
    return sections;
}

/** Count annotations per block_id, bucketed by max severity */
function sectionAnnotationCounts(
    blocks: Block[],
    annotationsByBlock: Map<string, Annotation[]>
) {
    let info = 0,
        warning = 0,
        error = 0;
    for (const b of blocks) {
        const anns = annotationsByBlock.get(b.block_id) ?? [];
        for (const a of anns) {
            if (a.resolved || a.category === "check") continue;
            if (a.severity === "error") error++;
            else if (a.severity === "warning") warning++;
            else info++;
        }
    }
    return { info, warning, error };
}

export default function DocumentView() {
    const { id } = useParams<{ id: string }>();
    const { currentDocument, blocks, loading, fetchDocument, fetchBlocks } =
        useDocumentStore();
    const { annotations, fetchAnnotations } = useAnnotationStore();
    const { activeBlockIds, sidebarCollapsed, toggleSidebar, setActiveBlock } = useUIStore();
    const { fetchRuns, activeRun } = useAgentStore();
    const [showWizard, setShowWizard] = useState(false);

    useEffect(() => {
        if (id) {
            fetchDocument(id);
            fetchBlocks(id);
            fetchAnnotations(id);
            fetchRuns(id);
        }
    }, [id, fetchDocument, fetchBlocks, fetchAnnotations, fetchRuns]);

    // Derived data
    const topLevelBlocks = useMemo(
        () => blocks.filter((b) => !b.parent),
        [blocks]
    );

    const childrenOf = useMemo(() => {
        const map = new Map<string, Block[]>();
        for (const b of blocks) {
            if (b.parent) {
                const arr = map.get(b.parent) ?? [];
                arr.push(b);
                map.set(b.parent, arr);
            }
        }
        return (parentId: string) => map.get(parentId) ?? [];
    }, [blocks]);

    // Flat ordered list of all block IDs (for shift+click range selection)
    const orderedBlockIds = useMemo(() => {
        const ids: string[] = [];
        for (const b of topLevelBlocks) {
            ids.push(b.block_id);
            for (const c of childrenOf(b.id)) ids.push(c.block_id);
        }
        return ids;
    }, [topLevelBlocks, childrenOf]);

    // TODO: once multi-block spans exist, index each annotation under every
    // block it covers (start_block through end_block), not just start_block.
    const annotationsByBlock = useMemo(() => {
        const map = new Map<string, Annotation[]>();
        for (const a of annotations) {
            const arr = map.get(a.start_block) ?? [];
            arr.push(a);
            map.set(a.start_block, arr);
        }
        return map;
    }, [annotations]);

    const sections = useMemo(
        () => buildSections(topLevelBlocks),
        [topLevelBlocks]
    );

    const readerRef = useRef<HTMLElement>(null);

    if (loading || !currentDocument) {
        return <p>Loading document...</p>;
    }

    const scrollToBlock = (blockId: string, alsoSelect = false) => {
        if (alsoSelect) setActiveBlock(blockId);
        const el = document.querySelector(`[data-block-id="${blockId}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
    };

    return (
        <div className="doc-layout">
            {/* ── Left sidebar: structural summary ── */}
            <aside className={`doc-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
                <h3 style={{ margin: "0 0 8px", fontSize: "1rem" }}>
                    Structure
                </h3>
                <p style={{ color: "#888", fontSize: "0.8rem", margin: "0 0 12px" }}>
                    {blocks.length} blocks
                </p>

                {sections.map((section, i) => {
                    // Include top-level blocks AND their descendants
                    const topLevel = section.heading
                        ? [section.heading, ...section.children]
                        : section.children;
                    const allBlocks = topLevel.flatMap((b) => [
                        b,
                        ...childrenOf(b.id),
                    ]);
                    const counts = sectionAnnotationCounts(
                        allBlocks,
                        annotationsByBlock
                    );
                    const headingLabel = section.heading
                        ? section.heading.content_original
                        : "Preamble";

                    return (
                        <div key={i} className="sidebar-section">
                            <div
                                className="sidebar-section-heading"
                                style={{ cursor: "pointer" }}
                                onClick={() =>
                                    section.heading &&
                                    scrollToBlock(section.heading.block_id)
                                }
                            >
                                <span>{headingLabel}</span>
                                <span>
                                    {counts.error > 0 && (
                                        <span className="badge badge-error">
                                            {counts.error}
                                        </span>
                                    )}
                                    {counts.warning > 0 && (
                                        <span className="badge badge-warning">
                                            {counts.warning}
                                        </span>
                                    )}
                                    {counts.info > 0 && (
                                        <span className="badge badge-info">
                                            {counts.info}
                                        </span>
                                    )}
                                </span>
                            </div>
                            {section.children.map((b) => (
                                <div
                                    key={b.block_id}
                                    className={`sidebar-item ${activeBlockIds.includes(b.block_id) ? "active" : ""}`}
                                    onClick={() => scrollToBlock(b.block_id, true)}
                                >
                                    <span className="sidebar-item-label">
                                        {b.block_type === "paragraph"
                                            ? "para"
                                            : b.block_type}
                                        {b.label ? ` (${b.label})` : ""}
                                    </span>
                                    {(annotationsByBlock.get(b.block_id)?.filter(
                                        (a) => !a.resolved && a.category === "issue"
                                    ).length ?? 0) > 0 && (
                                        <span className="badge badge-warning">
                                            {annotationsByBlock
                                                .get(b.block_id)!
                                                .filter((a) => !a.resolved && a.category === "issue")
                                                .length}
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </aside>

            {/* ── Center: document reader ── */}
            <section className="doc-reader" ref={readerRef} onClick={(e) => {
                // Deselect when clicking whitespace — but not on blocks (they stopPropagation)
                // or interactive elements like the sidebar toggle
                const el = e.target as HTMLElement;
                if (!el.closest("button, [data-block-id], .check-toggle")) {
                    setActiveBlock(null);
                }
            }}>
                <button className="sidebar-toggle" onClick={toggleSidebar}>
                    {sidebarCollapsed ? "\u25b6" : "\u25c0"}
                </button>

                <h2 style={{ marginTop: 0 }}>
                    {currentDocument.title || "Untitled document"}
                </h2>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "8px" }}>
                    <p style={{ color: "#888", fontSize: "0.9em", margin: 0 }}>
                        {currentDocument.source_format} &middot;{" "}
                        {currentDocument.preset} &middot; {blocks.length} blocks
                        {annotations.filter((a) => !a.resolved && a.category === "issue").length > 0 &&
                            ` \u00b7 ${annotations.filter((a) => !a.resolved && a.category === "issue").length} open flags`}
                    </p>
                    <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setShowWizard(true)}
                        disabled={activeRun?.status === "running" || activeRun?.status === "pending"}
                    >
                        Run Bot
                    </button>
                </div>

                <BotStatusBar docId={id!} />

                {showWizard && (
                    <BotWizard docId={id!} onClose={() => setShowWizard(false)} />
                )}

                <VerificationProgress
                    blocks={blocks}
                    annotationsByBlock={annotationsByBlock}
                />

                <BotSummary />

                {blocks.length === 0 ? (
                    <div
                        style={{
                            padding: "16px",
                            background: "#f9f9f9",
                            borderRadius: "8px",
                            fontFamily: "monospace",
                            whiteSpace: "pre-wrap",
                            fontSize: "0.9em",
                        }}
                    >
                        No blocks yet. Upload a document to see it parsed.
                    </div>
                ) : (
                    topLevelBlocks.map((block) => {
                        const children = childrenOf(block.id);
                        const hasChildren = children.length > 0;
                        const blockAnns =
                            annotationsByBlock.get(block.block_id) ?? [];
                        return (
                            <div key={block.id} style={{ position: "relative" }}>
                                {block.block_type !== "section_heading" && (
                                    <CheckToggle
                                        blockId={block.block_id}
                                        docId={id!}
                                        annotations={blockAnns}
                                    />
                                )}
                                <BlockRenderer
                                    block={block}
                                    isContainer={hasChildren}
                                    annotations={blockAnns}
                                    orderedBlockIds={orderedBlockIds}
                                />
                                {children.map((child) => {
                                    const childAnns =
                                        annotationsByBlock.get(
                                            child.block_id
                                        ) ?? [];
                                    return (
                                        <div
                                            key={child.id}
                                            style={{
                                                position: "relative",
                                                marginLeft: hasChildren
                                                    ? "16px"
                                                    : "0",
                                            }}
                                        >
                                            <CheckToggle
                                                blockId={child.block_id}
                                                docId={id!}
                                                annotations={childAnns}
                                            />
                                            <BlockRenderer
                                                block={child}
                                                annotations={childAnns}
                                                orderedBlockIds={orderedBlockIds}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })
                )}
            </section>

            {/* ── Right panel: annotations ── */}
            <aside className="doc-right-panel">
                <AnnotationPanel readerRef={readerRef} orderedBlockIds={orderedBlockIds} />
            </aside>
        </div>
    );
}
