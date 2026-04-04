import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useDocumentStore } from "../stores/documentStore";
import { useUIStore } from "../stores/uiStore";
import BlockRenderer from "./BlockRenderer";

export default function DocumentView() {
    const { id } = useParams<{ id: string }>();
    const { currentDocument, blocks, loading, fetchDocument, fetchBlocks } =
        useDocumentStore();
    const { activeBlockId } = useUIStore();

    useEffect(() => {
        if (id) {
            fetchDocument(id);
            fetchBlocks(id);
        }
    }, [id, fetchDocument, fetchBlocks]);

    if (loading || !currentDocument) {
        return <p>Loading document...</p>;
    }

    // Filter to top-level blocks only (no parent)
    const topLevelBlocks = blocks.filter((b) => !b.parent);
    // Group children by parent
    const childrenOf = (parentId: string) =>
        blocks.filter((b) => b.parent === parentId);

    return (
        <div style={{ display: "flex", gap: "16px" }}>
                {/* Summary Sidebar */}
                <aside
                    style={{
                        width: "200px",
                        flexShrink: 0,
                        borderRight: "1px solid #e0e0e0",
                        paddingRight: "16px",
                    }}
                >
                    <h3>Summary</h3>
                    {blocks.length > 0 ? (
                        <div style={{ fontSize: "0.85em" }}>
                            <p style={{ color: "#666" }}>
                                {blocks.length} blocks parsed
                            </p>
                            <ul
                                style={{
                                    listStyle: "none",
                                    padding: 0,
                                    margin: 0,
                                }}
                            >
                                {topLevelBlocks.map((b) => (
                                    <li
                                        key={b.block_id}
                                        style={{
                                            padding: "4px 8px",
                                            marginBottom: "2px",
                                            borderRadius: "4px",
                                            cursor: "pointer",
                                            fontSize: "0.9em",
                                            background:
                                                activeBlockId === b.block_id
                                                    ? "#e8f0fe"
                                                    : "transparent",
                                        }}
                                        onClick={() => {
                                            const el =
                                                document.querySelector(
                                                    `[data-block-id="${b.block_id}"]`
                                                );
                                            el?.scrollIntoView({
                                                behavior: "smooth",
                                                block: "center",
                                            });
                                        }}
                                    >
                                        <span style={{ color: "#aaa" }}>
                                            {b.block_id}
                                        </span>{" "}
                                        <span>
                                            {b.block_type === "section_heading"
                                                ? b.content_original
                                                : b.block_type}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <p style={{ color: "#888", fontSize: "0.9em" }}>
                            Run Triage analysis to generate a structural
                            summary.
                        </p>
                    )}
                </aside>

                {/* Document Reader */}
                <section style={{ flex: 1, minWidth: 0 }}>
                    <h2>{currentDocument.title || "Untitled document"}</h2>
                    <p style={{ color: "#888", fontSize: "0.9em" }}>
                        {currentDocument.source_format} &middot;{" "}
                        {currentDocument.preset} &middot; {blocks.length} blocks
                    </p>

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
                            return (
                                <div key={block.id}>
                                    <BlockRenderer
                                        block={block}
                                        isContainer={hasChildren}
                                    />
                                    {children.map((child) => (
                                        <div
                                            key={child.id}
                                            style={{
                                                marginLeft: hasChildren
                                                    ? "16px"
                                                    : "0",
                                            }}
                                        >
                                            <BlockRenderer block={child} />
                                        </div>
                                    ))}
                                </div>
                            );
                        })
                    )}
                </section>

                {/* Right Panel */}
                <aside
                    style={{
                        width: "350px",
                        flexShrink: 0,
                        borderLeft: "1px solid #e0e0e0",
                        paddingLeft: "16px",
                    }}
                >
                    <h3>Annotations</h3>
                    <p style={{ color: "#888", fontSize: "0.9em" }}>
                        No annotations yet.
                    </p>
                </aside>
        </div>
    );
}
