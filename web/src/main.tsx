import { render } from "preact";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/archivo-narrow/latin-500.css";
import "@fontsource/archivo-narrow/latin-600.css";
import "@fontsource/archivo-narrow/latin-700.css";
import "@fontsource/jetbrains-mono/latin-300.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "@fontsource/share-tech-mono/latin-400.css";
import { App } from "./app";
import "./styles.css";
import "./panel/themes.css";

registerSW({ immediate: true });
render(<App />, document.getElementById("app")!);
