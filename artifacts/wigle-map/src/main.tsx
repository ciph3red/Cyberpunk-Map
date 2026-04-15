import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL;
const normalizedApiBaseUrl =
	typeof rawApiBaseUrl === "string"
		? rawApiBaseUrl.trim().replace(/\/+$/, "").replace(/\/api$/, "")
		: "";

if (normalizedApiBaseUrl) {
	setBaseUrl(normalizedApiBaseUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
