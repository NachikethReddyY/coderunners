import ReactDOM from "react-dom/client";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/theme-gothic/theme.css";
import "@vscode/codicons/dist/codicon.css";
import "@xterm/xterm/css/xterm.css";
import "./studio.css";
import "./app.css";

import { CodeRunnersApp } from "./App.js";
import { StudioApiClient, takeLaunchSession } from "./studio-api.js";

const sessionToken = takeLaunchSession(window.location.href, (...args) => {
  window.history.replaceState(...args);
});
if (sessionToken !== undefined) {
  try {
    window.sessionStorage.setItem("coderunners-session", sessionToken);
  } catch {
    // Storage may be unavailable in a restricted browser context.
  }
}
const api = sessionToken === undefined
  ? (() => {
      try {
        const stored = window.sessionStorage.getItem("coderunners-session");
        return stored === null || stored.length === 0
          ? undefined
          : new StudioApiClient(window.location.origin, stored);
      } catch {
        return undefined;
      }
    })()
  : new StudioApiClient(window.location.origin, sessionToken);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <CodeRunnersApp {...(api === undefined ? {} : { api })} />,
);
