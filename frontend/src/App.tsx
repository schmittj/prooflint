import { Link, Outlet } from "react-router-dom";

function StopButton() {
    const handleStop = async () => {
        if (!window.confirm("Stop ProofLint server?")) return;
        try {
            await fetch("/api/v1/shutdown/", { method: "POST" });
        } catch {
            // Connection will drop as the server shuts down
        }
        document.title = "ProofLint (stopped)";
    };

    return (
        <button
            onClick={handleStop}
            title="Stop ProofLint server"
            style={{
                background: "none",
                border: "1px solid #ccc",
                borderRadius: 4,
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "0.85rem",
                color: "#666",
            }}
        >
            Stop Server
        </button>
    );
}

export default function App() {
    return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
            <header
                style={{
                    padding: "12px 24px",
                    borderBottom: "1px solid #e0e0e0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
                    <h1 style={{ margin: 0, fontSize: "1.4rem" }}>ProofLint</h1>
                </Link>
                <StopButton />
            </header>
            <main style={{ flex: 1, padding: "24px" }}>
                <Outlet />
            </main>
        </div>
    );
}
