import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useDocumentStore } from "../stores/documentStore";

export default function DocumentView() {
    const { id } = useParams<{ id: string }>();
    const { currentDocument, blocks, loading, fetchDocument, fetchBlocks } =
        useDocumentStore();

    useEffect(() => {
        if (id) {
            fetchDocument(id);
            fetchBlocks(id);
        }
    }, [id, fetchDocument, fetchBlocks]);

    if (loading || !currentDocument) {
        return <p>Loading document...</p>;
    }

    return (
        <div style={{ display: "flex", gap: "16px" }}>
            {/* Summary Sidebar — placeholder */}
            <aside
                style={{
                    width: "200px",
                    flexShrink: 0,
                    borderRight: "1px solid #e0e0e0",
                    paddingRight: "16px",
                }}
            >
                <h3>Summary</h3>
                <p style={{ color: "#888", fontSize: "0.9em" }}>
                    Run Triage analysis to generate a structural summary.
                </p>
            </aside>

            {/* Document Reader */}
            <section style={{ flex: 1, minWidth: 0 }}>
                <h2>{currentDocument.title || "Untitled document"}</h2>
                <p style={{ color: "#888", fontSize: "0.9em" }}>
                    {currentDocument.source_format} &middot;{" "}
                    {currentDocument.preset} &middot;{" "}
                    {blocks.length} blocks
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
                        {currentDocument.structure?.raw_source ??
                            "Ingestion pipeline not yet implemented. Raw source stored."}
                    </div>
                ) : (
                    blocks.map((block) => (
                        <div
                            key={block.id}
                            data-block-id={block.block_id}
                            style={{
                                padding: "8px 12px",
                                marginBottom: "4px",
                                borderRadius: "4px",
                                cursor: "pointer",
                            }}
                        >
                            <span
                                style={{
                                    color: "#aaa",
                                    fontSize: "0.8em",
                                    marginRight: "8px",
                                }}
                            >
                                {block.block_id}
                            </span>
                            {block.content_original}
                        </div>
                    ))
                )}
            </section>

            {/* Right Panel — placeholder */}
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
