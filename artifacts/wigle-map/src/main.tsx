import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import {
	applyUserApiSettings,
	loadUserApiSettings,
} from "@/lib/user-api-settings";

applyUserApiSettings(
	loadUserApiSettings(),
	typeof import.meta.env.VITE_API_BASE_URL === "string"
		? import.meta.env.VITE_API_BASE_URL
		: null,
);

createRoot(document.getElementById("root")!).render(<App />);
