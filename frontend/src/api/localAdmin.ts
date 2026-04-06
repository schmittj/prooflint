import axios from "axios";

type LocalSessionResponse = {
    admin_token: string;
};

let adminTokenPromise: Promise<string> | null = null;

export function getLocalAdminToken(): Promise<string> {
    if (!adminTokenPromise) {
        adminTokenPromise = axios
            .get<LocalSessionResponse>("/api/v1/local-session/")
            .then((response) => {
                const token = response.data.admin_token;
                if (!token) {
                    throw new Error("Missing local admin token.");
                }
                return token;
            })
            .catch((error) => {
                adminTokenPromise = null;
                throw error;
            });
    }
    return adminTokenPromise;
}

export async function getLocalAdminHeaders() {
    const token = await getLocalAdminToken();
    return {
        "X-ProofLint-Admin-Token": token,
    };
}
