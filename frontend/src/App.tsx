import { Link, Outlet } from "react-router-dom";

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
            </header>
            <main style={{ flex: 1, padding: "24px" }}>
                <Outlet />
            </main>
        </div>
    );
}
