import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeMathjax from "rehype-mathjax";
import { useDocumentStore } from "../stores/documentStore";

export default function DocumentList() {
    const { documents, loading, fetchDocuments, createDocument, deleteDocument } =
        useDocumentStore();
    const navigate = useNavigate();

    const [showUpload, setShowUpload] = useState(false);
    const [source, setSource] = useState("");
    const [title, setTitle] = useState("");
    const [sourceFormat, setSourceFormat] = useState<"markdown" | "latex">(
        "markdown"
    );
    const [preset, setPreset] = useState<"manual" | "triage">("manual");
    const [showPreview, setShowPreview] = useState(false);

    useEffect(() => {
        fetchDocuments();
    }, [fetchDocuments]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const doc = await createDocument(source, sourceFormat, title, preset);
        navigate(`/documents/${doc.id}`);
    };

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "24px",
                }}
            >
                <h2>Documents</h2>
                <button onClick={() => setShowUpload(!showUpload)}>
                    {showUpload ? "Cancel" : "Upload Document"}
                </button>
            </div>

            {showUpload && (
                <form
                    onSubmit={handleSubmit}
                    style={{
                        marginBottom: "24px",
                        padding: "16px",
                        border: "1px solid #e0e0e0",
                        borderRadius: "8px",
                    }}
                >
                    <div style={{ marginBottom: "12px" }}>
                        <label>
                            Title (optional)
                            <br />
                            <input
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                style={{ width: "100%", padding: "8px" }}
                            />
                        </label>
                    </div>
                    <div style={{ marginBottom: "12px" }}>
                        <label>
                            Format
                            <br />
                            <select
                                value={sourceFormat}
                                onChange={(e) =>
                                    setSourceFormat(
                                        e.target.value as "markdown" | "latex"
                                    )
                                }
                                style={{ padding: "8px" }}
                            >
                                <option value="markdown">Markdown + LaTeX</option>
                                <option value="latex">LaTeX</option>
                            </select>
                        </label>
                        &nbsp;&nbsp;
                        <label>
                            Preset
                            <br />
                            <select
                                value={preset}
                                onChange={(e) =>
                                    setPreset(
                                        e.target.value as "manual" | "triage"
                                    )
                                }
                                style={{ padding: "8px" }}
                            >
                                <option value="manual">Manual</option>
                                <option value="triage">Triage</option>
                            </select>
                        </label>
                    </div>
                    <div style={{ marginBottom: "12px" }}>
                        <label>
                            Source
                            <br />
                            <textarea
                                value={source}
                                onChange={(e) => setSource(e.target.value)}
                                rows={12}
                                style={{
                                    width: "100%",
                                    padding: "8px",
                                    fontFamily: "monospace",
                                }}
                                placeholder="Paste your LaTeX or Markdown+LaTeX here..."
                                required
                            />
                        </label>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button type="submit" disabled={loading}>
                            {loading ? "Uploading..." : "Upload"}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowPreview(!showPreview)}
                            disabled={!source}
                        >
                            {showPreview ? "Hide Preview" : "Preview"}
                        </button>
                    </div>
                    {showPreview && source && (
                        <div
                            style={{
                                marginTop: 12,
                                padding: 16,
                                border: "1px solid #d0d0d0",
                                borderRadius: 6,
                                background: "#fafafa",
                                maxHeight: 400,
                                overflowY: "auto",
                            }}
                        >
                            <p style={{ fontSize: "0.8rem", color: "#888", margin: "0 0 8px" }}>
                                Rendered preview — check that math and formatting look correct:
                            </p>
                            <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeMathjax]}>
                                {source}
                            </Markdown>
                        </div>
                    )}
                </form>
            )}

            {loading && !documents.length ? (
                <p>Loading...</p>
            ) : documents.length === 0 ? (
                <p>
                    No documents yet. Click &quot;Upload Document&quot; to get
                    started.
                </p>
            ) : (
                <ul style={{ listStyle: "none", padding: 0 }}>
                    {documents.map((doc) => (
                        <li
                            key={doc.id}
                            style={{
                                padding: "12px 16px",
                                border: "1px solid #e0e0e0",
                                borderRadius: "6px",
                                marginBottom: "8px",
                            }}
                        >
                            <Link to={`/documents/${doc.id}`}>
                                <strong>
                                    {doc.title || "Untitled document"}
                                </strong>
                            </Link>
                            <span
                                style={{
                                    marginLeft: "12px",
                                    color: "#888",
                                    fontSize: "0.9em",
                                }}
                            >
                                {doc.source_format} &middot; {doc.preset} &middot;{" "}
                                {new Date(doc.created_at).toLocaleDateString()}
                            </span>
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    if (window.confirm(`Delete "${doc.title || "Untitled"}"?`)) {
                                        deleteDocument(doc.id);
                                    }
                                }}
                                style={{
                                    marginLeft: 12,
                                    padding: "2px 8px",
                                    fontSize: "0.8em",
                                    border: "1px solid #e8a0a0",
                                    borderRadius: 4,
                                    background: "white",
                                    color: "#c53030",
                                    cursor: "pointer",
                                }}
                            >
                                Delete
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
