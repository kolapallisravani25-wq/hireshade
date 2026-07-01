import "@/lib/disableDebugLogs";
import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./launcher.css";

const LauncherApp = () => {
  const handleClick = async () => {
    await invoke("handle_launcher_click");
  };

  return (
    <div className="launcher-container" onClick={handleClick}>
      <img src="/src-tauri/icons/icon.png" alt="Launcher" className="launcher-icon" />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("launcher-root") as HTMLElement).render(
  <React.StrictMode>
    <LauncherApp />
  </React.StrictMode>
);
