import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import DocumentList from "./components/DocumentList";
import DocumentView from "./components/DocumentView";

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<App />}>
                    <Route index element={<DocumentList />} />
                    <Route path="documents/:id" element={<DocumentView />} />
                </Route>
            </Routes>
        </BrowserRouter>
    </React.StrictMode>
);
