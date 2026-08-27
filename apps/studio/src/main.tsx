import ReactDOM from "react-dom/client";

import "@astryxdesign/core/reset.css";
import "@astryxdesign/theme-gothic/theme.css";
import "@xterm/xterm/css/xterm.css";
import "./studio.css";

import { Studio } from "./Studio.js";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <Studio />,
);
